## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 包类型以清单文件为准

**Reason**: 该需求把「目录名不作类型判据」与「缩写/全名两种顶层目录都接受」混在一条里,且允许通过 `packing.behavior_packs` / `packing.resource_packs` 自定义路径。目录名规则收紧后,顶层目录名成为固定约定,原需求中的缩写等价与自定义路径场景均不再成立。

**Migration**: 由「包目录只认官方全名」承接:顶层目录固定为 `behavior_packs` / `resource_packs`,包类型仍以 `manifest.json` 的模块类型为准,自定义路径配置项被移除。

## ADDED Requirements

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
