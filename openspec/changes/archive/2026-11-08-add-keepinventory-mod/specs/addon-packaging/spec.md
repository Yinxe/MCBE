# Spec Delta

## Purpose

提供一套自定义的构建与打包工具链,把一个模组的源码与行为包/资源包内容转成可分发、版本号自洽的 `.mcpack` 与 `.mcaddon` 产物。配置全部可选并默认零配置,产物形态由探测到的包自动决定;包的类型以清单文件(`manifest.json`)的模块类型为准,而非目录名。

## ADDED Requirements

### Requirement: 打包配置来自 `package.json` 且全部可选

打包 MUST 只从模组 `package.json` 读取配置:包名 `name`(去掉 npm scope 后作为模组名 `<name>`)与版本 `version` 为必需来源;可选字段 `packing.mode`、`packing.behavior_packs`、`packing.resource_packs`、`packing.output` MUST 在缺失时回落到默认值(`mode` 默认 `auto`、包按清单文件自动探测、`output` 默认 `dist/packages`),使遵循目录约定时无需任何打包配置。

#### Scenario: 零配置即可打包

- **WHEN** 模组的 `package.json` 没有 `packing` 字段,且包目录符合 `BP/<name>` 约定
- **THEN** 打包成功,使用默认 `mode: "auto"` 与默认输出目录 `dist/packages`

#### Scenario: 显式覆盖输出目录

- **WHEN** `packing.output` 被设为某个自定义目录
- **THEN** 全部产物写入该目录,不再写入 `dist/packages`

#### Scenario: 模组名与版本取自 `package.json`

- **WHEN** `package.json#name` 为 `@mc-toolchain/keepinventory`
- **THEN** 打包使用的模组名为 `keepinventory`,产物名与 manifest 版本分别取自 `package.json#name` 与 `package.json#version`

### Requirement: 包类型以清单文件为准

包的类型 MUST 由其目录中 `manifest.json` 的 `modules[].type` 判定:含 `data` 或 `script` 模块的包为行为包,含 `resources` 模块的包为资源包;目录名 MUST NOT 作为类型判据。未显式配置包目录时,打包 MUST 探测模组目录下含 `manifest.json` 的包目录(忽略 `node_modules`、`dist`、`out`、`.git`、`.vscode` 等非包目录)并按清单判定类型。同一类型命中多个包时 MUST 报错指出歧义;清单无法判定类型时 MUST 报错。显式配置的 `packing.behavior_packs` / `packing.resource_packs` 路径 MUST 被直接采用,且其必须存在且清单类型与配置相符,否则 MUST 报错。

#### Scenario: 目录名与类型不一致时以清单为准

- **WHEN** 一个只含 `resources` 模块的包被放在名为 `BP/<name>/` 的目录中
- **THEN** 打包把它识别为资源包,并据此产出 `_rp.mcpack` 与同步依赖，而不是按目录名当作行为包

#### Scenario: 缩写与全名目录等价

- **WHEN** 行为包分别位于 `BP/<name>/` 与 `behavior_packs/<name>/` 两种情况(各自单独存在)
- **THEN** 两种布局都被识别为行为包,产物形态与命名一致

#### Scenario: 同类型命中多个包

- **WHEN** 模组目录下探测到两个都含 `data` 或 `script` 模块的包目录
- **THEN** 打包报错指明歧义的候选路径并提示用 `packing.behavior_packs` 显式指定,不产出产物

#### Scenario: 清单无法判定类型

- **WHEN** 某包目录的 `manifest.json` 既不含行为包类型模块也不含 `resources` 模块
- **THEN** 打包报错指明该清单文件,不产出产物

#### Scenario: 显式配置的路径不存在或类型不符

- **WHEN** `packing.behavior_packs` 指向不存在的目录,或其 `manifest.json` 判定为资源包
- **THEN** 打包报错指明该路径与原因,不产出产物

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

打包 MUST 通过单一入口 `pack` 触发,产物形态由 `packing.mode` 决定;MUST NOT 要求调用方为不同产物形态选择不同脚本入口。

#### Scenario: 单个命令按 mode 产出正确形态

- **WHEN** 执行 `npm run pack -w @mc-toolchain/<mod-name>`
- **THEN** 依据 `packing.mode` 产出对应的 `.mcpack` 或 `.mcaddon`,无需调用其它打包脚本

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

产物 MUST 写入 `packing.output`(默认 `dist/packages`),文件名 MUST 同时包含模组名与 `package.json#version`,使不同版本可并存而不互相覆盖;命名规则为 `<name>-v<version>.mcaddon`、`<name>-v<version>_bp.mcpack`、`<name>-v<version>_rp.mcpack`。

#### Scenario: 产物文件名规则

- **WHEN** 打包包名为 `@mc-toolchain/keepinventory`、版本为 `0.0.1` 的模组
- **THEN** 产物命名为 `keepinventory-v0.0.1_bp.mcpack`、`keepinventory-v0.0.1_rp.mcpack`(存在时)与 `keepinventory-v0.0.1.mcaddon`(存在时)

#### Scenario: 同一模组多个版本可并存

- **WHEN** 依次以 `0.0.1` 与 `0.0.2` 打包同一模组
- **THEN** 输出目录中同时存在两个版本各自的产物

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
