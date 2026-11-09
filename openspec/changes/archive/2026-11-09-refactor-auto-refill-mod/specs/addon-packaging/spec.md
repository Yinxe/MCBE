# Spec Delta

## MODIFIED Requirements

### Requirement: 打包入口唯一

打包 MUST 通过单一入口 `pack` 触发,产物形态由 `packing.mode` 决定;MUST NOT 要求调用方为不同产物形态选择不同脚本入口。打包逻辑 MUST 来自仓库内共享打包包 `@mc-toolchain/packaging`,模组 MUST NOT 在自身目录内保留打包逻辑的实现文件。

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
