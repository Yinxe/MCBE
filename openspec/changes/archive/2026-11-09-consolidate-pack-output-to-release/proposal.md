# Proposal

## Why

当前 5 个模组的打包产物散落在各自的 `mods/<name>/dist/packages/` 下,收集待发布的 `.mcpack` 需要逐个目录翻找;`auto-refill` 已经改成写到仓库根(`"output": "../../dist/packages"`),其余 4 个仍是模组内目录,同一仓库里存在两种产物位置。产物统一集中到仓库根的一个目录后,「哪些包可以装、装的是哪个版本」在一处即可看清。

## What Changes

- **产物位置统一**：全部模组的 `packing.output` 改为仓库根 `release/`(从 `mods/<name>/` 出发写作 `"../../release/"`),打包后所有 `.mcpack` / `.mcaddon` 平铺在同一目录,文件名规则不变(`<name>-v<version>_bp.mcpack` 等)。
- **`auto-refill` 从 `../../dist/packages` 迁到 `../../release/`**,与其余模组对齐,消除仓库内两种产物位置并存的状态。
- **`release/` 加入 `.gitignore`**：产物不入库,与现有 `dist/` 同等对待。
- **打包库默认值保持不变**：`@mc-toolchain/mod-packaging` 的 `DEFAULT_OUTPUT_DIRECTORY` 仍是 `dist/packages`。本变更只改各模组的显式配置,不改打包库语义——避免打包库隐含「模组一定位于 `mods/<name>/`」的布局假设。
- **清理旧产物**：删除 5 个模组下已有的 `mods/<name>/dist/packages/` 目录,避免「旧位置还有包」造成误装。
- **文档同步**：`mods/README.md`、`packages/mod-packaging/README.md` 与各模组 `README.md` 中出现的产物路径示例改为 `release/`,并说明「产物统一在仓库根 `release/`,不在模组目录内」。
- **不做**：不新增根级一键打包脚本(用户明确不需要);不改产物命名规则;不改 `packing.mode` 语义;不改 `addon-packaging` 主 spec 的默认值条款(默认值本身未变)。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `addon-packaging`: 「产物命名与位置」一条补充本仓的落位约定——所有模组 MUST 把 `packing.output` 显式指向仓库根 `release/`,使产物集中;`release/` MUST 被 `.gitignore` 忽略。打包库的默认值 `dist/packages` 语义不变。

## Impact

- 修改文件:`mods/{auto-refill,craftablerarities,keepinventory,spectator-mode,teleporter}/package.json` 的 `packing.output`;根 `.gitignore`。
- 删除目录:`mods/*/dist/packages/`(旧产物,不入库)。
- 文档:`mods/README.md`、`packages/mod-packaging/README.md`、`mods/*/README.md` 的产物路径示例。
- 不改动:`packages/mod-packaging/src/**`(默认值与解析逻辑不变)、任何模组的脚本源码、包清单、产物命名与压缩包内容。
- 对使用者可见的变化:安装包时从仓库根 `release/` 取,不再进模组子目录找。
