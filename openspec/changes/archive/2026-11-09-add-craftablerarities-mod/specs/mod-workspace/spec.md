## MODIFIED Requirements

### Requirement: 模组位于 npm workspace 的 `mods/` 目录

仓库根 `package.json` MUST 为私有包并声明 `workspaces` 覆盖 `mods/*` 与 `packages/*`;每个模组 MUST 是 `mods/<mod-name>/` 下的一个 workspace 包,可被根目录的 `npm install` 统一安装与链接。`packages/*` MUST 承载**仅供仓库内部使用**的共享包,MUST NOT 承载模组或可对外发布的工具。模组清单 MUST 同时出现在 `mods/README.md` 与根 `README.md` 的模组表中,使新增模组可被检索。

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

#### Scenario: 模组清单与目录一致

- **WHEN** 对比 `mods/` 下的实际目录与 `mods/README.md`、根 `README.md` 中的模组表
- **THEN** 两侧条目一一对应,不存在只在目录中存在而文档未列出的模组

### Requirement: 模组保留官方模板核心文件

模组目录 MUST 保留官方 `mct create` 模板的核心文件与布局(`scripts/` 源码、`just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env`),允许在不破坏该布局的前提下删减模组不需要的部分。**不含脚本的纯内容模组**(只由配方、物品目录、方块定义等声明式内容构成)MUST NOT 保留空的 `scripts/` 目录与 TypeScript 源码,也 MUST NOT 为满足布局而引入脚本模块;这类模组仍需保留 `just.config.ts` 与 `.env`,因为打包与部署依赖它们。

#### Scenario: 保留模板核心文件

- **WHEN** 检查一个含脚本的已完成模组目录
- **THEN** `just.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`.env` 存在,且 TypeScript 源码位于 `scripts/`

#### Scenario: 纯内容模组不保留脚本骨架

- **WHEN** 检查一个只含配方与物品目录清单的模组目录
- **THEN** 不存在 `scripts/` 下的 TypeScript 源码,行为包清单中也没有 `type` 为 `script` 的模块,同时 `just.config.ts` 与 `.env` 仍然存在

#### Scenario: 模组可依赖内部共享包

- **WHEN** 模组需要在运行时或打包期复用仓库内其它代码
- **THEN** 它以 workspace 依赖引用 `packages/` 下的内部共享包,而不是复制代码或在模组内新建共享目录

#### Scenario: 模组内不复制共享实现

- **WHEN** 审查某模组目录
- **THEN** 其中不存在与 `packages/` 下共享包重复的实现文件
