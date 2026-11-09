# Addon Packaging Specification

## Purpose

提供一套自定义的构建与打包工具链,把一个模组的源码与行为包/资源包内容转成可分发、版本号自洽的 `.mcpack` 与 `.mcaddon` 产物。配置全部可选并默认零配置,产物形态由探测到的包自动决定;包的类型以清单文件(`manifest.json`)的模块类型为准,而非目录名。

## Requirements

### Requirement: 打包配置来自 `package.json` 且全部可选

打包 MUST 只从模组 `package.json` 读取配置:包名 `name`(去掉 npm scope 后作为模组名 `<name>`)与版本 `version` 为必需来源;可选字段 `packing.mode`、`packing.output`、`packing.minimum_engine_version` MUST 在缺失时回落到默认值(`mode` 默认 `auto`、`output` 默认 `dist/packages`、最低游戏版本按依赖版本推导),使遵循目录约定时无需任何打包配置。包目录的位置 MUST NOT 可配置。

#### Scenario: 零配置即可打包

- **WHEN** 模组的 `package.json` 没有 `packing` 字段,且包目录符合 `behavior_packs/<name>` 与 `resource_packs/<name>` 约定
- **THEN** 打包成功,使用默认 `mode: "auto"`、默认输出目录 `dist/packages`,并按依赖版本推导出最低游戏版本

#### Scenario: 显式覆盖输出目录

- **WHEN** `packing.output` 被设为某个自定义目录
- **THEN** 全部产物写入该目录,不再写入 `dist/packages`

#### Scenario: 模组名与版本取自 `package.json`

- **WHEN** `package.json#name` 为 `@mc-toolchain/keepinventory`
- **THEN** 打包使用的模组名为 `keepinventory`,产物名与 manifest 版本分别取自 `package.json#name` 与 `package.json#version`

#### Scenario: 未知配置项不被静默忽略

- **WHEN** `packing` 中出现不受支持的字段名(例如拼写错误的 `minimum_engine_verison`)
- **THEN** 打包报错指明该未知字段,避免拼写错误被当成「未配置」而静默回落到推导值

#### Scenario: 包目录配置项已被移除

- **WHEN** `packing` 中出现 `behavior_packs` 或 `resource_packs` 字段
- **THEN** 打包报错指明该字段不受支持,包目录固定为官方全名目录,不可配置

### Requirement: `packing.mode` 决定产物形态且默认自动检测

`packing.mode` MUST 支持 `auto`(默认)、`mcpack`、`mcaddon`。`auto` 时 MUST 依据探测到的包数量自动决定:恰好 1 个包时产出该包的 `.mcpack`,2 个包时产出 `.mcaddon`。`mcpack` 时 MUST 为每个探测到的包各产出一个 `.mcpack`。`mcaddon` 时 MUST 产出单个 `.mcaddon`,且探测到的包少于 2 个时 MUST 报错。探测到的包为 0 个时任何 mode MUST 报错。

#### Scenario: 自动检测到单个包

- **WHEN** `packing.mode` 为 `auto` 且只探测到行为包
- **THEN** 只产出一个行为包 `.mcpack`,不产出 `.mcaddon`

#### Scenario: 自动检测到两个包

- **WHEN** `packing.mode` 为 `auto` 且同时探测到行为包与资源包
- **THEN** 产出单个 `.mcaddon`,其中包含行为包与资源包两个 `.mcpack`

#### Scenario: 强制输出两个 mcpack

- **WHEN** `packing.mode` 为 `mcpack` 且探测到行为包与资源包
- **THEN** 分别产出行为包 `.mcpack` 与资源包 `.mcpack`,不产出 `.mcaddon`

#### Scenario: mcaddon 模式缺少第二个包

- **WHEN** `packing.mode` 为 `mcaddon` 但只探测到行为包
- **THEN** 打包报错提示单包应使用 `mcpack`,不产出产物

#### Scenario: 没有任何包

- **WHEN** 模组目录中既无行为包目录也无资源包目录
- **THEN** 打包报错,不产出产物

### Requirement: 打包入口唯一

打包 MUST 通过单一入口 `pack` 触发,产物形态由 `packing.mode` 决定;MUST NOT 要求调用方为不同产物形态选择不同脚本入口。打包逻辑 MUST 来自仓库内共享打包包 `@mc-toolchain/mod-packaging`,模组 MUST NOT 在自身目录内保留打包逻辑的实现文件。

#### Scenario: 单个命令按 mode 产出正确形态

- **WHEN** 执行 `npm run pack -w @mc-toolchain/<mod-name>`
- **THEN** 依据 `packing.mode` 产出对应的 `.mcpack` 或 `.mcaddon`,无需调用其它打包脚本

#### Scenario: 打包逻辑在仓库内只有一份

- **WHEN** 审查仓库中所有模组的打包实现
- **THEN** 打包逻辑只存在于共享打包包中,各模组目录下没有打包逻辑的实现文件

#### Scenario: 模组只编排任务

- **WHEN** 阅读某模组的 `just.config.ts`
- **THEN** 它只导入共享打包包并按顺序编排任务,不含打包逻辑本身

#### Scenario: 替换实现后产物不变

- **WHEN** 一个模组把自带打包实现替换为共享打包包,配置与源码均未改动
- **THEN** 产物文件名、包内文件清单与清单中的版本字段与替换前一致
### Requirement: 打包前同步 npm 版本号

`pack` MUST 在压缩之前把 `package.json#version` 解析为 `[major, minor, patch]`,写入包内所有 `manifest.json` 的 `header.version` 与 `modules[].version`,并同步资源包对行为包的依赖 `version`。当版本号无法解析为三段数字时,MUST 报错中止且不产生产物。

#### Scenario: 版本号被写入 manifest

- **WHEN** `package.json#version` 为 `0.0.1` 并执行 `pack`
- **THEN** 行为包与资源包 `manifest.json` 的 `header.version` 与 `modules[].version` 均为 `[0, 0, 1]`

#### Scenario: 资源包依赖版本同步

- **WHEN** 资源包声明了对行为包 UUID 的依赖并执行 `pack`
- **THEN** 该依赖的 `version` 与行为包 `header.version` 一致

#### Scenario: 非法版本号被拒绝

- **WHEN** `package.json#version` 不能被解析为三段数字
- **THEN** 打包中止并输出可定位的错误信息,不产生产物

### Requirement: 产物命名与位置

产物 MUST 写入 `packing.output`(默认 `dist/packages`),文件名 MUST 同时包含模组名与 `package.json#version`,使不同版本可并存而不互相覆盖;命名规则为 `<name>-v<version>.mcaddon`、`<name>-v<version>_bp.mcpack`、`<name>-v<version>_rp.mcpack`。本仓的所有模组 MUST 把 `packing.output` 显式指向仓库根 `release/`,使全部产物集中在一个目录;该目录 MUST 被 `.gitignore` 忽略。

#### Scenario: 产物文件名规则

- **WHEN** 打包包名为 `@mc-toolchain/keepinventory`、版本为 `0.0.1` 的模组
- **THEN** 产物命名为 `keepinventory-v0.0.1_bp.mcpack`、`keepinventory-v0.0.1_rp.mcpack`(存在时)与 `keepinventory-v0.0.1.mcaddon`(存在时)

#### Scenario: 同一模组多个版本可并存

- **WHEN** 依次以 `0.0.1` 与 `0.0.2` 打包同一模组
- **THEN** 输出目录中同时存在两个版本各自的产物

#### Scenario: 全部模组产物集中在仓库根

- **WHEN** 在仓库根的任一模组目录下执行 `npm run pack`
- **THEN** 产物写入仓库根的 `release/` 目录,该模组目录内不再产生 `dist/packages/`

#### Scenario: 多个模组产物同处一目录

- **WHEN** 依次打包仓库内所有模组
- **THEN** 全部产物平铺在仓库根 `release/` 下,彼此以文件名中的模组名区分,互不覆盖

#### Scenario: 产物目录不入库

- **WHEN** 检查仓库的 `.gitignore` 并在打包后查看版本控制状态
- **THEN** `release/` 被忽略,产物不会出现在待提交变更中

#### Scenario: 打包库默认值不隐含仓库布局

- **WHEN** 某个模组的 `package.json` 未声明 `packing.output`
- **THEN** 打包仍按库默认值写入相对该模组根目录的 `dist/packages`,而不是自动改写为 `release/`;集中到 `release/` 由各模组的显式配置保证

### Requirement: 压缩包内容置于根目录且不含调试文件

生成的 `.mcpack` MUST 把对应包的 `manifest.json` 放在压缩包根目录(而不是多包一层目录),行为包 `.mcpack` MUST 同时包含构建产物 `scripts/main.js`;产物 MUST NOT 包含 TypeScript 源文件与 `.map` 调试文件。

#### Scenario: 行为包 mcpack 结构

- **WHEN** 解压行为包 `.mcpack`
- **THEN** 根目录存在 `manifest.json`,且存在 `scripts/main.js`

#### Scenario: 资源包 mcpack 结构

- **WHEN** 解压资源包 `.mcpack`
- **THEN** 根目录存在资源包的 `manifest.json`

#### Scenario: 不含源码与调试文件

- **WHEN** 检查任一 `.mcpack` 的文件列表
- **THEN** 其中不存在 `.ts` 源文件与 `.map` 调试文件

### Requirement: 最低游戏版本显式优先、缺省按依赖推导

`packing.minimum_engine_version` MUST 接受三段数字数组(如 `[1, 21, 90]`)。该字段存在时 MUST 直接采用其值;缺省时 MUST 依据 `package.json` 中 `@minecraft/server` 的依赖版本,通过打包工具内置的「脚本 API 版本 → 游戏版本」映射表推导出最低游戏版本。既无显式配置、依赖版本又不在映射表中时,MUST 报错指明该依赖版本并要求显式配置,不得猜测或回落到任意默认值。

#### Scenario: 显式配置覆盖推导值

- **WHEN** `packing.minimum_engine_version` 为 `[1, 21, 80]`,而 `@minecraft/server` 依赖为 `2.0.0`
- **THEN** 打包采用 `[1, 21, 80]`,不使用映射表推导出的值

#### Scenario: 缺省时按依赖版本推导

- **WHEN** `packing` 未设置 `minimum_engine_version`,`@minecraft/server` 依赖为 `2.0.0`
- **THEN** 打包推导出最低游戏版本 `[1, 21, 90]` 并在日志中说明推导来源

#### Scenario: 依赖版本不在映射表中

- **WHEN** `@minecraft/server` 依赖为映射表未收录的版本,且未显式配置 `minimum_engine_version`
- **THEN** 打包报错指明该依赖版本与可用的解决方式,不产出产物

#### Scenario: 显式配置格式非法

- **WHEN** `packing.minimum_engine_version` 不是三段数字数组(如 `"1.21.90"` 或 `[1, 21]`)
- **THEN** 打包报错指明该字段的期望格式,不产出产物

### Requirement: 打包写入最低游戏版本声明

`pack` MUST 在压缩之前把解析出的最低游戏版本写入每个包 `manifest.json` 的 `header.min_engine_version`,使该声明与 `@minecraft/server` 依赖版本保持同源;写入 MUST 覆盖清单中原有的值。

#### Scenario: 清单被写入推导出的版本

- **WHEN** `@minecraft/server` 依赖为 `2.0.0` 且未显式配置最低版本,执行 `pack`
- **THEN** 行为包 `manifest.json` 的 `header.min_engine_version` 为 `[1, 21, 90]`

#### Scenario: 覆盖清单中已有的不一致值

- **WHEN** 清单中 `header.min_engine_version` 为 `[1, 21, 0]`,而解析结果为 `[1, 21, 90]`,执行 `pack`
- **THEN** 清单中的值被改写为 `[1, 21, 90]`

#### Scenario: 资源包同样被写入

- **WHEN** 模组同时包含行为包与资源包并执行 `pack`
- **THEN** 两个包的 `manifest.json` 都写入了同一个最低游戏版本值

### Requirement: 包目录只认官方全名

包目录的顶层目录名 MUST 为 `behavior_packs`(行为包)与 `resource_packs`(资源包),MUST NOT 接受 `BP` / `RP` 或其它缩写,也 MUST NOT 支持自定义包目录路径。包的实际类型 MUST 由其目录中 `manifest.json` 的 `modules[].type` 判定:含 `data` 或 `script` 模块的包为行为包,含 `resources` 模块的包为资源包;目录名 MUST NOT 作为类型判据。打包 MUST 在这两个顶层目录之下探测含 `manifest.json` 的包目录(忽略 `node_modules`、`dist`、`out`、`.git`、`.vscode` 等非包目录)。同一类型命中多个包时 MUST 报错指出歧义;清单无法判定类型时 MUST 报错。

#### Scenario: 官方全名目录被接受

- **WHEN** 行为包位于 `behavior_packs/<name>/`、资源包位于 `resource_packs/<name>/`
- **THEN** 打包正确识别两个包,并按 `packing.mode` 产出对应产物

#### Scenario: 目录名与类型不一致时以清单为准

- **WHEN** 一个只含 `resources` 模块的包被放在 `behavior_packs/<name>/` 中
- **THEN** 打包把它识别为资源包,并据此产出 `_rp.mcpack`,而不是按所在目录当作行为包

#### Scenario: 缩写目录被拒绝

- **WHEN** 模组使用 `BP/<name>/` 或 `RP/<name>/` 作为包目录
- **THEN** 打包报错指明仅支持 `behavior_packs` / `resource_packs`,并提示把该目录改名,不产出产物

#### Scenario: 自定义包目录路径不再可用

- **WHEN** 模组在 `packing` 中设置 `behavior_packs` 或 `resource_packs` 指向自定义目录
- **THEN** 打包报错指明该字段不受支持,包目录固定为官方全名目录

#### Scenario: 同类型命中多个包

- **WHEN** 同一顶层目录下探测到两个都含 `data` 或 `script` 模块的包目录
- **THEN** 打包报错指明歧义的候选路径,不产出产物

#### Scenario: 清单无法判定类型

- **WHEN** 某包目录的 `manifest.json` 既不含行为包类型模块也不含 `resources` 模块
- **THEN** 打包报错指明该清单文件,不产出产物

#### Scenario: 找不到任何包

- **WHEN** 模组目录下既无 `behavior_packs` 也无 `resource_packs` 目录,或其中没有含 `manifest.json` 的包目录
- **THEN** 打包报错指明未找到包,不产出产物

### Requirement: 打包同步清单显示名

`pack` MUST 在压缩之前把每个包 `manifest.json` 的 `header.name` 写为 `package.json` 的 `productName` 加一个空格加 `v` 加 `package.json#version`,覆盖清单中原有的值。`productName` 缺失或为空字符串时 MUST 报错中止且不产生产物,不得回落到模组名。

#### Scenario: 显示名由产品名与版本组成

- **WHEN** `package.json` 的 `productName` 为 `自动替换`、`version` 为 `2.2.0` 并执行 `pack`
- **THEN** 行为包 `manifest.json` 的 `header.name` 为 `自动替换 v2.2.0`

#### Scenario: 覆盖清单中手工维护的显示名

- **WHEN** 清单中 `header.name` 为 `§l§e《合成配方扩展》 v1.0.1`,而 `productName` 为 `合成配方扩展`、`version` 为 `1.0.2`
- **THEN** 清单中的值被改写为 `合成配方扩展 v1.0.2`

#### Scenario: 资源包同样被写入

- **WHEN** 模组同时包含行为包与资源包并执行 `pack`
- **THEN** 两个包的 `manifest.json` 的 `header.name` 都是同一个显示名

#### Scenario: 产品名缺失时中止

- **WHEN** `package.json` 没有 `productName` 字段
- **THEN** 打包报错指明该字段是清单显示名的来源,不产生产物

### Requirement: 打包同步清单描述

`pack` MUST 在压缩之前把每个包 `manifest.json` 的 `header.description` 写为由 `package.json` 派生的多行文本,覆盖清单中原有的值。首行 MUST 为 `package.json#description` 原文,其后按固定顺序逐行追加:作者、邮箱、主页、QQ群、仓库。`package.json#description` 缺失或为空字符串时 MUST 报错中止。

#### Scenario: 描述由简介与联系信息拼接

- **WHEN** `description` 为 `死亡不掉落 · 无需作弊 · 保留成就`、`author.name` 为 `Yinx`、`author.email` 为 `1423716216@qq.com`、`author.url` 为 `https://github.com/Yinxe/`、`packing.qq_group` 为 `632178498`、`repository` 指向 `github.com/Yinxe/MCBE`
- **THEN** `header.description` 为 `死亡不掉落 · 无需作弊 · 保留成就`、`作者：Yinx`、`邮箱：1423716216@qq.com`、`主页：https://github.com/Yinxe/`、`QQ群：632178498`、`仓库：https://github.com/Yinxe/MCBE` 六行以换行符连接

#### Scenario: 缺失的联系信息整行省略

- **WHEN** `package.json` 只有 `author.name`,没有 `author.email`、`author.url`、`packing.qq_group` 与 `repository`
- **THEN** `header.description` 只有简介与 `作者：Yinx` 两行,不出现空行、也不出现「未配置」之类的占位文本

#### Scenario: 简介缺失时中止

- **WHEN** `package.json` 没有 `description` 字段或其为空字符串
- **THEN** 打包报错指明该字段是清单描述的来源,不产生产物

#### Scenario: 颜色符号原样保留

- **WHEN** `description` 或 `author.name` 中含 `§` 颜色与样式符号(如 `§e《合成配方扩展》`)
- **THEN** 写入清单的文本原样保留这些符号,不被转义、剥离或截断

### Requirement: 联系信息字段来源与规范化

清单描述中的联系信息 MUST 只从 `package.json` 读取:`author`(字符串或含 `name`/`email`/`url` 的对象)、`repository`(字符串或含 `url` 的对象)、`packing.qq_group`。`repository` 的 git 形式 URL MUST 规范化为 `https://<host>/<owner>/<repo>` 可读形式,去掉 `git+` 前缀、`git@` 与 `:` 形式的 SSH 分隔符、以及 `.git` 后缀。

#### Scenario: SSH 形式的仓库地址被规范化

- **WHEN** `repository` 为 `git@github.com:Yinxe/MCBE.git`
- **THEN** 清单描述中的仓库行为 `仓库：https://github.com/Yinxe/MCBE`

#### Scenario: 已是 https 形式时保持不变

- **WHEN** `repository` 为 `https://github.com/Yinxe/MCBE.git`
- **THEN** 清单描述中的仓库行为 `仓库：https://github.com/Yinxe/MCBE`

#### Scenario: author 为字符串时按作者名处理

- **WHEN** `author` 为字符串 `Yinx` 而非对象
- **THEN** 清单描述中写入 `作者：Yinx`,且不产生邮箱与主页行

#### Scenario: qq_group 纳入配置白名单

- **WHEN** `packing.qq_group` 被设置
- **THEN** 打包不把它当作未知字段报错;而 `packing` 中出现其它不受支持的字段时仍然报错
