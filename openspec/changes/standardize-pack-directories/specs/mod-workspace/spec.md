## REMOVED Requirements

### Requirement: 包目录的命名与缩写/全名约定

**Reason**: 该需求允许父目录使用缩写 `BP` / `RP` 或全名 `behavior_packs` / `resource_packs` 二选一。为与 `mct` 工具链的布局保持一致,缩写不再被接受,该需求中的缩写场景不再成立。

**Migration**: 由「包目录的命名约定」承接:父目录固定为官方全名 `behavior_packs` / `resource_packs`,包目录名仍为 `<name>`。

## ADDED Requirements

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
