# Spec Delta

## ADDED Requirements

### Requirement: 模组元信息在 `package.json` 单一维护

模组的显示名、简介与联系信息 MUST 只在 `mods/<mod-name>/package.json` 维护:显示名取 `productName`,简介取 `description`,联系信息取 `author`、`repository` 与 `packing.qq_group`。各包 `manifest.json` 的 `header.name` 与 `header.description` MUST 由打包从这些字段派生,维护者 MUST NOT 手工编辑这两个清单字段。

#### Scenario: 元信息改动只需改一处

- **WHEN** 维护者修改 `package.json` 的 `description` 并重新打包
- **THEN** 该模组所有包 `manifest.json` 的 `header.description` 都反映新简介,无需手工编辑清单

#### Scenario: 清单字段被手工改写后会被覆盖

- **WHEN** 某人直接编辑 `manifest.json` 的 `header.name` 并执行 `pack`
- **THEN** 该值被 `package.json` 派生的显示名覆盖,手工改动不进入产物

#### Scenario: 仓库内模组都声明元信息

- **WHEN** 检查 `mods/` 下每个模组的 `package.json`
- **THEN** 每个都声明了 `productName`、`description`、`author`、`repository` 与 `packing.qq_group`,使打包不因缺字段中止
