# shared-packaging Specification

## Purpose
定义仓库内部共享打包包 `@mc-toolchain/mod-packaging` 的定位与对外契约,使「版本同步、最低游戏版本解析、包目录探测、按模式产出产物」这套逻辑在所有模组间只有一份实现,避免逐模组复制导致漂移。

## Requirements

### Requirement: 共享打包包位于 `packages/` 工作区

仓库 MUST 提供内部共享打包包 `@mc-toolchain/mod-packaging`,位于 `packages/mod-packaging/`,并被根 `package.json` 的 `workspaces` 覆盖。该包 MUST 标记为私有,MUST NOT 发布到 npm,且 MUST 作为开发依赖被模组引用(打包期使用,不进运行时产物)。

#### Scenario: 模组以开发依赖引用共享打包

- **WHEN** 某模组的 `package.json` 在 `devDependencies` 中声明 `@mc-toolchain/mod-packaging`
- **THEN** 该模组的 `just.config.ts` 可从该包导入打包任务构造函数

#### Scenario: 共享打包不进运行时产物

- **WHEN** 检查任一使用该包的模组的 `.mcpack` 产物
- **THEN** 产物中不含该共享包的任何代码

### Requirement: 共享打包包提供与现有打包行为等价的实现

`@mc-toolchain/mod-packaging` MUST 导出足以让模组完成打包的构造函数与辅助函数,且其行为 MUST 与迁移前逐模组自带的打包脚本等价:配置只从模组 `package.json` 读取、`packing` 块全部可选并回落到默认值、包类型以 `manifest.json` 的 `modules[].type` 判定、产物命名含模组名与版本、打包前同步版本与最低游戏版本。

#### Scenario: 迁移后产物不变

- **WHEN** 一个模组把自带打包脚本替换为共享包实现并重新打包,配置与源码均未改动
- **THEN** 产物文件名、包内文件清单与清单中的版本字段与迁移前一致

#### Scenario: 单一实现被多个模组共用

- **WHEN** 仓库中存在两个以上模组并都使用共享打包包
- **THEN** 打包逻辑在仓库中只存在一份源码,各模组目录下不存在重复的打包实现文件

### Requirement: 模组只保留构建任务定义

使用共享打包包的模组 MUST 只在自身 `just.config.ts` 中定义任务编排(调用共享包的构造结果),MUST NOT 在模组目录内保留打包逻辑的实现文件。模组的 `package.json` MUST 保留单一打包入口 `pack`。

#### Scenario: 模组目录不含打包实现

- **WHEN** 检查使用共享打包包的模组目录
- **THEN** 其中不存在打包逻辑的实现文件,`just.config.ts` 仅导入共享包并按顺序编排任务

#### Scenario: 打包入口保持唯一

- **WHEN** 执行 `npm run pack -w @mc-toolchain/<mod-name>`
- **THEN** 依据 `packing.mode` 产出对应产物,无需调用其它打包脚本

### Requirement: 纯逻辑部分可脱离游戏环境测试

共享打包包中不依赖 `@minecraft/core-build-tasks` 副作用的纯逻辑(版本解析、版本号规范化、最低游戏版本查表、包目录探测与类型判定)MUST 可脱离 Minecraft 游戏环境单独编译并运行测试,且该包 MUST 自带这些测试。

#### Scenario: 纯逻辑测试可独立运行

- **WHEN** 在 `packages/mod-packaging` 目录执行其测试脚本
- **THEN** 版本解析与最低游戏版本推导等用例运行并通过,不加载任何游戏运行时

#### Scenario: 映射表未收录时明确报错

- **WHEN** 传入的脚本 API 版本高于映射表收录的最高档且未显式配置最低游戏版本
- **THEN** 解析返回「未收录」而不是钳到最高档的值
