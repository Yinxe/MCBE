# Mod Workspace Specification

## Purpose

定义 `mc-toolchain` 仓库如何用 npm workspaces 承载多个 Minecraft Bedrock 模组,统一模组的目录位置、包名、初始版本、包目录命名,以及「npm 版本号即模组版本号」这一单一版本来源,使新增模组有稳定可预期的约定。

## Requirements

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

### Requirement: 模组包名与初始版本

每个模组的包名 MUST 为 `@mc-toolchain/<mod-name>`,其中 `<mod-name>` 为其 `mods/` 下的目录名;新建模组的初始版本 MUST 为 `0.0.1`。

#### Scenario: keepinventory 模组的标识

- **WHEN** 读取 `mods/keepinventory/package.json`
- **THEN** `name` 为 `@mc-toolchain/keepinventory` 且 `version` 为 `0.0.1`

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

### Requirement: 包类型可选

模组 MUST 允许只包含行为包、只包含资源包或两者都包含;缺少某一类型的包目录 MUST NOT 被视为错误。

#### Scenario: 纯行为包模组

- **WHEN** 模组只有行为包目录、没有资源包目录
- **THEN** 该模组合法,打包流程正常运行且不产生资源包产物

### Requirement: 包目录的命名约定

模组的行为包与资源包 MUST 分别存放在包目录中,包目录名 MUST 为 `<name>`,即 `package.json#name` 去掉 npm scope 的部分;包目录的父目录 MUST 为官方全名 `behavior_packs`(行为包)与 `resource_packs`(资源包),MUST NOT 使用 `BP` / `RP` 或其它缩写。该命名是布局约定与探测线索,包的实际类型以 `manifest.json` 的模块类型为准(见 `addon-packaging`)。

#### Scenario: 使用官方全名目录名

- **WHEN** 模组把行为包放在 `behavior_packs/keepinventory/`、资源包放在 `resource_packs/keepinventory/`
- **THEN** 该布局被接受,打包与校验流程正常识别两个包

#### Scenario: 缩写目录名被拒绝

- **WHEN** 模组把行为包放在 `BP/keepinventory/` 或资源包放在 `RP/keepinventory/`
- **THEN** 该布局不被接受,打包报错并提示改用官方全名目录

#### Scenario: 包目录名由包名派生

- **WHEN** 模组 `package.json#name` 为 `@mc-toolchain/keepinventory`
- **THEN** 其包目录名为 `keepinventory`,不带 `@mc-toolchain/` 前缀

### Requirement: 脚手架产物须对齐包名

`mct create` 生成的包目录名是 `PROJECT_NAME` 的派生缩写(形如 `<creator缩写>_<名字缩写>_bp`),不等于包名。用 `mct create` 新建模组后,MUST 把两个包目录改名为 `<name>`,并把 `.env` 中的 `PROJECT_NAME` 同步为 `<name>`,使布局符合本规范。`.env` 的 `PROJECT_NAME` MUST 与包目录名一致,否则 `just.config.ts` 中基于 `${projectName}` 的拷贝路径会指向不存在的目录。

#### Scenario: 脚手架后改名为包名

- **WHEN** 执行 `mct create keepinventory tsStarter mc-toolchain -o mods/keepinventory` 生成 `behavior_packs/mctoolch_keepinv_bp`
- **THEN** 把该目录改名为 `behavior_packs/keepinventory`,资源包同样处理,并把 `.env` 的 `PROJECT_NAME` 改为 `keepinventory`

#### Scenario: PROJECT_NAME 未同步导致打包失败

- **WHEN** 包目录已改名为 `<name>` 但 `.env` 的 `PROJECT_NAME` 仍为脚手架缩写
- **THEN** `just.config.ts` 中 `./behavior_packs/${projectName}` 指向不存在的目录,打包无法取到该包

#### Scenario: 改名后 mct 命令仍可用

- **WHEN** 包目录按包名改名并同步 `.env` 后,在模组目录执行 `mct validate -i .` 或 `mct add -i . -o .`
- **THEN** 命令正常作用于改名后的包目录,不需要额外参数

### Requirement: monorepo 下每个模组自带完整工具链目录

monorepo 中的每个模组 MUST 是独立可操作的 `mct` 项目:各自包含 `behavior_packs/`、`resource_packs/`、`scripts/`、`.env`、`just.config.ts` 与 `tsconfig.json`。模组之间 MUST NOT 共享包目录或 `.env`。新增模组 MUST 在 `mods/<name>` 下独立生成,而不是在已有模组内追加。

#### Scenario: 每个模组独立成套

- **WHEN** 仓库中存在多个模组
- **THEN** 每个 `mods/<name>` 都有自己的一套 `behavior_packs/`、`resource_packs/`、`.env` 与构建配置

#### Scenario: 不共享 .env

- **WHEN** 两个模组的包目录名不同
- **THEN** 各自的 `.env` 中的 `PROJECT_NAME` 分别对应自己的包目录名,互不复用
