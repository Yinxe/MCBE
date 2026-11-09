# Proposal

## Why

当前打包工具允许包目录使用缩写 `BP` / `RP` 或全名 `behavior_packs` / `resource_packs` 两种写法,并可通过 `packing.behavior_packs` / `packing.resource_packs` 任意自定义路径。但 `mct`(Minecraft Creator Tools)自身只认官方全名:实测 `mct create` 的 `addonStarter` 与 `tsStarter` 两个模板都生成 `behavior_packs/` 与 `resource_packs/`,模板的 `tsconfig.json` 用 `"baseUrl":"behavior_packs/"`、`just.config.ts` 用 `./behavior_packs/${projectName}`。

允许两种写法意味着本项目的模组布局随时可能与 `mct` 的预期分叉,而 `mct` 是官方校验与内容生成的唯一来源。收紧为单一目录名后,项目结构、`mct` 工具链与打包逻辑三者指向同一套约定,不再需要「兼容缩写」的探测分支。

## What Changes

- **BREAKING**: 包目录的顶层目录名固定为 `behavior_packs` / `resource_packs`,不再接受 `BP` / `RP` 缩写。检测到缩写目录时报错并提示改名。
- **BREAKING**: 删除 `packing.behavior_packs` 与 `packing.resource_packs` 两个配置项。配置中出现这两个字段时,按既有的「未知配置项」检查报错。
- 把 `mods/keepinventory/BP/keepinventory/` 迁移到 `mods/keepinventory/behavior_packs/keepinventory/`,并同步 `tsconfig.json` 的 `baseUrl`、`just.config.ts` 的拷贝路径与监听 glob、README 中的路径与对照表。
- 在项目文档中记录 `mct` 工具在 monorepo 下的正确用法:`mct add` 必须限定在单个模组目录内(指向 `mods/` 父目录会把内容写进所有模组)、`mct validate -i mods` 才能逐模组产出报告。
- 明确生成内容的命名空间修正与校验口径:命名空间由输出目录名派生(形如 `contoso_<dir>`)需显式改正;校验必须检查 `UNLINK` 未链接纹理警告,仅看 ERROR 计数不足。

## Capabilities

### New Capabilities

- `mct-toolchain-usage`: 约束本项目在 monorepo 布局下如何调用 `mct`(create / add / validate),使内容能落到既有包目录、不产生重复包结构、不破坏 UUID 与清单引用,并明确生成内容的命名空间与校验口径。

### Modified Capabilities

- `addon-packaging`: 包目录的探测与解析规则收紧为只认官方全名目录,并移除两个自定义路径配置项。
- `mod-workspace`: 模组布局的目录命名约定从「缩写或全名二选一」收紧为「仅全名」,并新增脚手架产物对齐包名、monorepo 下每模组自带完整工具链目录的约束。
- `pack-icon`: 图标路径从 `BP/<name>/` 更新为 `behavior_packs/<name>/`。

## Impact

**代码**
- `mods/keepinventory/tools/packaging.ts`:删除 `PackingConfiguration.behaviorPacks` / `resourcePacks`、`resolveExplicitPackDirectory`、`SUPPORTED_PACKING_KEYS` 中的两项;`resolvePackDirectories` 简化为只走探测;新增缩写目录检测与报错。
- `mods/keepinventory/tsconfig.json`:`baseUrl` 由 `BP/` 改为 `behavior_packs/`。
- `mods/keepinventory/just.config.ts`:`copyToBehaviorPacks` 路径与 `local-deploy` 的监听 glob 改为 `behavior_packs`。
- `mods/keepinventory/README.md`:目录结构、路径示例、缩写/全名对照表。

**文件移动**
- `mods/keepinventory/BP/keepinventory/` → `mods/keepinventory/behavior_packs/keepinventory/`(含 `manifest.json` 与 `pack_icon.png`)。

**兼容性**
- 这是破坏性变更:任何仍使用 `BP/` 或依赖 `packing.behavior_packs` 的模组配置都会在 `pack` 时报错。当前仓库只有 `mods/keepinventory` 一个模组,已在本变更内一并迁移。

**风险**
- `mct create` 生成的包目录名是 `PROJECT_NAME` 派生缩写(形如 `mctoolch_keepinv_bp`),不等于包名。新建模组需手工改名为 `<name>` 并同步 `.env`,否则 `just.config.ts` 的 `${projectName}` 路径会指向不存在的目录。
- 已实测确认:包目录改名为 `<name>` 后,`mct add -i . -o .` 仍能正确写入该目录,多次 `add` 稳定复用,且 `manifest.json` 的 UUID 保持不变、清单文件按条目合并。
- 已实测确认:`mct add` 生成的内容命名空间为 `contoso_<输出目录名>`(截断至 16 字符),无法得到干净的 `<name>:` 命名空间,移入后需显式改正。
- 已实测确认:`mct validate` 的 ERROR 计数不包含未链接资源。忽略 `blocks.json` / `terrain_texture.json` 时仍报 0 ERROR,但会产出 `UNLINK` 纹理未被引用警告,因此校验口径必须包含该项。
- 已实测确认:在 monorepo 根执行 `mct add -i mods -o mods` 会把内容写进 `mods/` 下的所有模组;不带 `-i` 的 `mct validate` 会把整个仓库当成单个项目。两者都需要在规范中明确禁止。
