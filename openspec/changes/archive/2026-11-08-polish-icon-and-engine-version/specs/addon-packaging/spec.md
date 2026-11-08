## MODIFIED Requirements

### Requirement: 打包配置来自 `package.json` 且全部可选

打包 MUST 只从模组 `package.json` 读取配置:包名 `name`(去掉 npm scope 后作为模组名 `<name>`)与版本 `version` 为必需来源;可选字段 `packing.mode`、`packing.behavior_packs`、`packing.resource_packs`、`packing.output`、`packing.minimum_engine_version` MUST 在缺失时回落到默认值(`mode` 默认 `auto`、包按清单文件自动探测、`output` 默认 `dist/packages`、最低游戏版本按依赖版本推导),使遵循目录约定时无需任何打包配置。

#### Scenario: 零配置即可打包

- **WHEN** 模组的 `package.json` 没有 `packing` 字段,且包目录符合 `BP/<name>` 约定
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

## ADDED Requirements

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
