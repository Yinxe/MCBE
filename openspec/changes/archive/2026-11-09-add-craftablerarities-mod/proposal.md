# Proposal

## Why

仓库外已有一个成熟的附加内容模组 `craftablerarities`(`~/coding/MCBE/mcaddon/craftablerarities`,79 个合成配方 + 创造物品栏补充),但它仍使用 `BP/` `RP/` 缩写目录、自带 `just.config.ts` 打包实现与旧式配方写法,无法纳入本仓库的 workspace 与共享打包链路,也无法随其它模组一起版本化与校验。把它迁进 `mods/` 并顺带把配方写法对齐到当前 Bedrock 原版约定,可以让它获得与本仓库其它模组一致的构建、打包与校验能力,同时降低配方在未来版本失效的风险。

## What Changes

- 新增模组 `mods/craftablerarities/`,包名 `@mc-toolchain/craftablerarities`,版本保留 `1.0.1`(迁移不重置版本)。
- 目录从 `BP/CraftableRarities` 与 `RP/CraftableRarities` 改为官方全名 `behavior_packs/craftablerarities` 与 `resource_packs/craftablerarities`;`.env` 的 `PROJECT_NAME` 同步为 `craftablerarities`。
- 打包改为走 `@mc-toolchain/packaging`:`just.config.ts` 只编排任务,`package.json` 加 `packing` 块,删除模组自带的打包实现(`tools/init-project.mjs`、`tools/sync-version.mjs`)。
- **BREAKING**(仅限模组内部约定,不对外):**删除资源包**。源项目资源包只含 `manifest.json` 与 `pack_icon.png`,无任何内容文件;删除后 `packing.mode` 解析为单行为包,产物从 `.mcaddon` 变为单个 `.mcpack`。
- 行为包图标重绘为 128×128 RGBA 像素画,满足 `pack-icon` 规范(源图为 256×256)。
- 配方规范化(79 个文件),按「能否静态证明等价」分两层处理:
  - **可证明等价 → 改写**:`identifier` 由 `craftablerarities/bedrock` 斜杠式改为 `craftablerarities:bedrock` 冒号式;物品 ID 补 `minecraft:` 前缀;可唯一映射到扁平化显式 ID 的辅助值改为显式 ID(如 `coral`+`data:0` → `tube_coral`、`skull`+`data:1` → `wither_skeleton_skull`、`monster_egg`+`data:0` → `infested_stone`)。
  - **无法证明等价 → 保留原写法**:仅存于 legacy/隐藏方块的 ID(`netherreactor`、`glowingobsidian`、`moving_block`、`invisible_bedrock`、`client_request_placeholder_block`、`end_gateway`、旧版 `stonecutter`、`portal`)及其在 `result` 侧的使用,**不做猜测性改写**;其中依赖 `data` 的用法(`bubble_column`、`potion`)同样保留。
- 配方 `format_version` 统一提升到与 `min_engine_version` 一致的档位,消除 `mct validate` 的 `FORMATVER156` 建议项。
- 保留 `item_catalog/crafting_item_catalog.json`(创造物品栏补充)与 `metadata.product_type: "addon"`。
- 新增仓库级文档:模组 README、`mods/README.md` 与根 `README.md` 的模组清单条目,以及一份记录「辅助值 → 显式 ID」映射与等价性验证方法的调研记录。

## Capabilities

### New Capabilities

- `craftablerarities`:定义本模组对外可观察的行为——哪些配方在工作台可用、配方 ID 与物品引用的写法约定、创造物品栏补充条目、以及「配方规范化不得改变合成结果」这一等价性约束。

### Modified Capabilities

- `mod-workspace`:模组清单与目录约定需要纳入第三个模组;同时本模组是仓库内**第一个纯行为包 + 无脚本**的模组,需要在「模组保留官方模板核心文件」这条要求上明确无脚本模组的取舍(不保留 `scripts/`、`tsconfig.json` 仅作类型检查用途或一并省略)。

## Impact

- 新增代码/内容:`mods/craftablerarities/`(79 个配方、1 个物品目录清单、1 个行为包清单、1 个图标)。
- 删除:源项目自带的打包实现(`tools/*.mjs`)不再迁入;资源包整体删除。
- 依赖:`@mc-toolchain/packaging`(devDependency)、`@minecraft/core-build-tasks`、`just-scripts`。**不引入** `@minecraft/server` 与 `@mc-toolchain/shared`——本模组无脚本,不产生运行时依赖。
- 打包配置:`packing.minimum_engine_version` 需显式指定(见 design),因为无 `@minecraft/server` 依赖时无法推导。
- 受影响文档:`README.md`、`mods/README.md`、`docs/research/` 新增一篇。
- 不受影响:`@mc-toolchain/packaging` 的实现无需改动;`openspec/specs/addon-packaging` 的既有要求全部满足(单包 → 单 `.mcpack`,零配置回落到 `auto`)。
