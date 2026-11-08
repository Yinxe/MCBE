# Spec Delta

## Purpose

定义 `mc-toolchain` 仓库如何用 npm workspaces 承载多个 Minecraft Bedrock 模组,统一模组的目录位置、包名、初始版本、包目录命名,以及「npm 版本号即模组版本号」这一单一版本来源,使新增模组有稳定可预期的约定。

## ADDED Requirements

### Requirement: 模组位于 npm workspace 的 `mods/` 目录

仓库根 `package.json` MUST 为私有包并声明 `workspaces` 覆盖 `mods/*`;每个模组 MUST 是 `mods/<mod-name>/` 下的一个 workspace 包,可被根目录的 `npm install` 统一安装与链接。

#### Scenario: 根工作区注册模组

- **WHEN** 在仓库根执行 `npm install`
- **THEN** `mods/` 下的每个模组目录都被识别为 workspace 包,并可在根目录用 `npm run <script> -w @mc-toolchain/<mod-name>` 调用

#### Scenario: 模组目录符合约定

- **WHEN** 检查 `mods/<mod-name>/package.json`
- **THEN** 该目录是一个独立 npm 包,且不是仓库根包

### Requirement: 模组包名与初始版本

每个模组的包名 MUST 为 `@mc-toolchain/<mod-name>`,其中 `<mod-name>` 为其 `mods/` 下的目录名;新建模组的初始版本 MUST 为 `0.0.1`。

#### Scenario: keepinventory 模组的标识

- **WHEN** 读取 `mods/keepinventory/package.json`
- **THEN** `name` 为 `@mc-toolchain/keepinventory` 且 `version` 为 `0.0.1`

### Requirement: npm 版本号是模组版本的唯一来源

模组版本 MUST 只在 `mods/<mod-name>/package.json` 的 `version` 字段维护;模组内其它版本声明(如 `manifest.json` 的版本)MUST 由该字段派生,不得独立编辑或出现相互不一致。

#### Scenario: 版本一致性可检查

- **WHEN** 修改 `mods/<mod-name>/package.json` 的 `version` 并重新打包
- **THEN** 产物中所有 `manifest.json` 的版本字段都与新的 `package.json#version` 一致

#### Scenario: 禁止多版本来源

- **WHEN** 审查某模组的版本声明
- **THEN** 不存在除 `package.json#version` 之外被手工维护的版本值

### Requirement: 模组保留官方模板核心文件

模组目录 MUST 保留官方 `mct create` 模板的核心文件与布局(`scripts/` 源码、`just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env`),允许在不破坏该布局的前提下删减模组不需要的部分。

#### Scenario: 保留模板核心文件

- **WHEN** 检查一个已完成的模组目录
- **THEN** `just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env` 存在,且 TypeScript 源码位于 `scripts/`

### Requirement: 包目录的命名与缩写/全名约定

模组的行为包与资源包 MUST 分别存放在包目录中,包目录名 MUST 为 `<name>`,即 `package.json#name` 去掉 npm scope 的部分;包目录的父目录 MUST 使用缩写 `BP` / `RP` 或全名 `behavior_packs` / `resource_packs` 之一。该命名是布局约定与探测线索,包的实际类型以 `manifest.json` 的模块类型为准(见 `addon-packaging`)。

#### Scenario: 使用缩写目录名

- **WHEN** 模组把行为包放在 `BP/keepinventory/`、资源包放在 `RP/keepinventory/`
- **THEN** 该布局被接受,打包与校验流程正常识别两个包

#### Scenario: 使用全名目录名

- **WHEN** 模组把行为包放在 `behavior_packs/keepinventory/`、资源包放在 `resource_packs/keepinventory/`
- **THEN** 该布局同样被接受,且行为与缩写目录名一致

#### Scenario: 包目录名由包名派生

- **WHEN** 模组 `package.json#name` 为 `@mc-toolchain/keepinventory`
- **THEN** 其包目录名为 `keepinventory`,不带 `@mc-toolchain/` 前缀

### Requirement: 包类型可选

模组 MUST 允许只包含行为包、只包含资源包或两者都包含;缺少某一类型的包目录 MUST NOT 被视为错误。

#### Scenario: 纯行为包模组

- **WHEN** 模组只有行为包目录、没有资源包目录
- **THEN** 该模组合法,打包流程正常运行且不产生资源包产物
