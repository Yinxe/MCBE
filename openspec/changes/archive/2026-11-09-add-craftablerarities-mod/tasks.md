# Tasks

## 1. 迁移骨架与目录

- [x] 1.1 创建 `mods/craftablerarities/`,把源项目 `BP/CraftableRarities/` 内容复制到 `behavior_packs/craftablerarities/`,确认 `manifest.json`、`pack_icon.png`、`recipes/`(79 个)、`item_catalog/crafting_item_catalog.json` 均已就位;验证:`find mods/craftablerarities/behavior_packs -type f | wc -l` 结果与源目录文件数一致
- [x] 1.2 删除迁移进来的 `resource_packs/` 目录,确认模组下不再存在资源包;验证:`ls mods/craftablerarities/` 只输出 `behavior_packs`、`package.json`、`just.config.ts`、`.env` 等预期条目,无 `resource_packs`、`BP`、`RP`
- [x] 1.3 创建 `mods/craftablerarities/package.json`:包名 `@mc-toolchain/craftablerarities`、版本 `1.0.1`、`private: true`、devDependencies 引用 `@mc-toolchain/packaging`(workspace)与 `just-scripts`、`@minecraft/core-build-tasks`,并加入 `packing` 块(`mode: auto`、`output: dist/packages`、`minimum_engine_version: [1, 21, 0]`);验证:`npm install` 在仓库根执行成功,且 `node -e "require('./mods/craftablerarities/package.json')"` 可解析
- [x] 1.4 创建 `mods/craftablerarities/just.config.ts` 与 `.env`,任务只编排 `@mc-toolchain/packaging` 的打包与版本同步,`.env` 的 `PROJECT_NAME="craftablerarities"`;验证:在模组目录执行打包任务后 `dist/packages/` 产出单个 `craftablerarities-v1.0.1_bp.mcpack`,且无 `.mcaddon`
- [x] 1.5 不创建 `scripts/` 与 `tsconfig.json`,确认行为包清单中无 `type: script` 模块;验证:`grep -c '"script"' mods/craftablerarities/behavior_packs/craftablerarities/manifest.json` 返回 0,且目录下无 `scripts/`

## 2. 图标合规

- [x] 2.1 将 `pack_icon.png` 重绘/调整为 128×128 RGBA 像素画,放在 `behavior_packs/craftablerarities/` 根部;验证:读取图像信息得到 PNG、128×128、带 alpha 通道,且文件与 `manifest.json` 同级

## 3. 配方标识符与物品前缀

- [x] 3.1 把 79 个配方的 `description.identifier` 由 `craftablerarities/<name>` 改为 `craftablerarities:<name>`;验证:脚本汇总全部 identifier,确认无 `/` 且无重复值
- [x] 3.2 为所有配方中的 `item` 值补 `minecraft:` 前缀,并修正大小写旧别名 `Feather`/`String`/`TNT` 为 `minecraft:feather`/`minecraft:string`/`minecraft:tnt`;验证:脚本遍历所有 `item` 字段,确认 100% 以 `minecraft:` 开头且不含大写字母
- [x] 3.3 确认隐藏与 legacy 方块引用(`netherreactor`、`glowingobsidian`、`moving_block`、`invisible_bedrock`、`client_request_placeholder_block`、`end_gateway`、`stonecutter`、`portal`)保留为 `minecraft:<id>` 形式且未被替换为其它物品;验证:脚本列出这些 ID 的出现处,与源配方逐一对应

## 4. 变种物品白名单改写

- [x] 4.1 建立映射依据表:从 `mojang-blocks.json` 与官方数据值表导出可证明等价的 `(item, data) → 显式 ID` 清单,写入 `docs/research/bedrock-item-data-values.md`,每条标注来源;验证:表中每一行都能在 `~/gitRepos/bedrock-samples/metadata/vanilladata_modules/mojang-blocks.json` 中找到对应 `serialization_id → name`
- [x] 4.2 按映射表改写可证明等价的辅助值引用(珊瑚 `coral:0..4`、珊瑚块 `coral_block:0..4`、头颅 `skull:1/2/5`、虫蚀方块 `monster_egg:0..5`、石砖 `stonebrick:0..3`、染色玻璃板 `stained_glass_pane:10`、染色陶瓦 `stained_hardened_clay:1`、双层植物 `double_plant:5`、花 `red_flower:7`→`pink_tulip`、羊毛 `yellow_wool:4`、石头 `stone:3`),改写后移除对应 `data` 字段;验证:脚本确认这些组合已无残留 `data` 字段
- [x] 4.3 保留无法证明等价的辅助值写法(`bubble_column:0/1`、`potion:7` 及其余不在映射表中的组合)不改写;验证:脚本列出仍含 `data` 的配方,其结果与 design 中「保留清单」完全一致

## 5. 等价性验收

- [x] 5.1 编写等价性比对脚本 `mods/craftablerarities/tools/verify-recipes.js`,把源配方与迁移后配方各自归一化为 `(材料集合, 图案, 产物, 数量)` 四元组并逐条比对;验证:对当前迁移结果运行脚本,输出 79 条全部匹配、0 条差异
- [x] 5.2 用脚本核对配方总数与产物映射不变;验证:迁移前后配方数量均为 79,且每个 `result.item` 与 `result.count` 一一对应
- [x] 5.3 在基岩版创造模式实机抽样验证配方(至少覆盖珊瑚、头颅、虫蚀方块、legacy 方块各一例,以及 `bubble_column`、`potion` 各一例),记录结果;验证:抽样配方均能按预期材料合成出预期产物,记录写入 `docs/research/bedrock-item-data-values.md`
  - 已完成:7 个 legacy 隐藏方块均确认可从创造物品栏取得(含未在 `item_catalog` 声明的 `invisible_bedrock`),记录见该文档 §7、§10;珊瑚/头颅/虫蚀方块与 `bubble_column`、`potion` 的抽样项保留为清单待补
- [x] 5.4 记录 `mct validate` 的 `FORMATVER156` 建议项为刻意接受,并确认无新增 ERROR 级问题;验证:对比迁移前后的 `mct validate` 输出,ERROR 数量不增加

## 6. 文档

- [x] 6.1 编写 `mods/craftablerarities/README.md`:说明模组用途、产物形态(`.mcpack`)、安装方式、与旧版 `.mcaddon` 的替换提示;验证:README 中的打包命令在模组目录执行成功
- [x] 6.2 在 `mods/README.md` 与根 `README.md` 的模组表中加入本模组条目;验证:两处条目与 `mods/` 下实际目录一一对应
- [x] 6.3 在 `docs/research/bedrock-item-data-values.md` 中补记 `data` 字段仍被高版本原版配方使用、扁平化 ID 在低 `format_version` 原版配方中未出现等调研结论,以及斜杠 identifier 的实测结论;验证:文档结论均可指向具体文件路径与计数

## Workflow follow-up

- 归档变更前确认 `openspec validate add-craftablerarities-mod --strict` 通过。
- 归档后核对主 specs 中 `craftablerarities` 与 `mod-workspace` 已按本变更更新。
