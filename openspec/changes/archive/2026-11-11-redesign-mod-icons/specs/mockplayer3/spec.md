# Spec Delta

## MODIFIED Requirements

### Requirement: 打包形态与产物

模组 MUST 以行为包加资源包的双包形态存在，打包 MUST 产出 `.mcaddon` 到仓库根 `release/` 目录，MUST NOT 把产物留在模组目录内。包图标 MUST 为 256×256，行为包与资源包各一份。

#### Scenario: 打包产出 mcaddon

- **WHEN** 执行打包命令
- **THEN** 在 `release/` 下产出包含行为包与资源包的 `.mcaddon` 文件

#### Scenario: 产物不落在模组目录

- **WHEN** 打包完成后检查模组目录
- **THEN** 模组目录内不存在打包产物

#### Scenario: 双包各有一份 256×256 图标

- **WHEN** 检查行为包与资源包目录根部
- **THEN** 两处各存在一份 `pack_icon.png`，尺寸均为 256×256
