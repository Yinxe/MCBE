# Spec Delta

## MODIFIED Requirements

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
