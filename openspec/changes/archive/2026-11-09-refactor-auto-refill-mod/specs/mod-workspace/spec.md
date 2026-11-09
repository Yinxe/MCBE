# Spec Delta

## MODIFIED Requirements

### Requirement: 模组位于 npm workspace 的 `mods/` 目录

仓库根 `package.json` MUST 为私有包并声明 `workspaces` 覆盖 `mods/*` 与 `packages/*`;每个模组 MUST 是 `mods/<mod-name>/` 下的一个 workspace 包,可被根目录的 `npm install` 统一安装与链接。`packages/*` MUST 承载**仅供仓库内部使用**的共享包,MUST NOT 承载模组或可对外发布的工具。

#### Scenario: 根工作区注册模组

- **WHEN** 在仓库根执行 `npm install`
- **THEN** `mods/` 下的每个模组目录都被识别为 workspace 包,并可在根目录用 `npm run <script> -w @mc-toolchain/<mod-name>` 调用

#### Scenario: 模组目录符合约定

- **WHEN** 检查 `mods/<mod-name>/package.json`
- **THEN** 该目录是一个独立 npm 包,且不是仓库根包

#### Scenario: 共享包位于 packages 工作区

- **WHEN** 检查 `packages/<package-name>/package.json`
- **THEN** 该包被根 `workspaces` 覆盖,且被标记为私有、不发布到 npm

#### Scenario: 三个顶层目录职责不重叠

- **WHEN** 审查仓库顶层目录
- **THEN** `mods/` 只放模组、`packages/` 只放内部共享包、`tools/` 只放可独立发布的工具包

### Requirement: npm 版本号是模组版本的唯一来源

模组版本 MUST 只在 `mods/<mod-name>/package.json` 的 `version` 字段维护;模组内其它版本声明(如 `manifest.json` 的版本)MUST 由该字段派生,不得独立编辑或出现相互不一致。从仓库外迁移的既有模组 MUST 保留其原有版本号,不得因迁移而重置。

#### Scenario: 版本一致性可检查

- **WHEN** 修改 `mods/<mod-name>/package.json` 的 `version` 并重新打包
- **THEN** 产物中所有 `manifest.json` 的版本字段都与新的 `package.json#version` 一致

#### Scenario: 禁止多版本来源

- **WHEN** 审查某模组的版本声明
- **THEN** 不存在除 `package.json#version` 之外被手工维护的版本值

#### Scenario: 迁移模组保留原版本

- **WHEN** 把仓库外一个版本为 `2.2.0` 的模组迁移进 `mods/`
- **THEN** 该模组 `package.json#version` 仍为 `2.2.0`,包清单中的版本由该值派生为 `[2, 2, 0]`

### Requirement: 模组保留官方模板核心文件

模组目录 MUST 保留官方 `mct create` 模板的核心文件与布局(`scripts/` 源码、`just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env`),允许在不破坏该布局的前提下删减模组不需要的部分。

#### Scenario: 保留模板核心文件

- **WHEN** 检查一个已完成的模组目录
- **THEN** `just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env` 存在,且 TypeScript 源码位于 `scripts/`

#### Scenario: 模组可依赖内部共享包

- **WHEN** 模组需要在运行时或打包期复用仓库内其它代码
- **THEN** 它以 workspace 依赖引用 `packages/` 下的内部共享包,而不是复制代码或在模组内新建共享目录

#### Scenario: 模组内不复制共享实现

- **WHEN** 审查某模组目录
- **THEN** 其中不存在与 `packages/` 下共享包重复的实现文件
