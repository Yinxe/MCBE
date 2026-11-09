# 合成配方扩展(craftablerarities)

用工作台配方合成各种稀有、不可再生、只能靠作弊获取的物品与隐藏方块。

纯内容模组:**没有脚本、没有资源包**,只包含一个行为包,内含 79 个工作台配方和一份创造物品栏补充清单。

## 合成内容

配方覆盖以下几类物品:

- **不可再生资源**:海绵、海洋之心、远古残骸、鞘翅、强化深板岩、紫水晶母岩、幽匿催发体等
- **隐藏与 legacy 方块**:基岩、屏障、结构方块、结构空位、命令方块、末地门框、末地传送门、折跃门、照相机、下界反应核、发光黑曜石、隐形基岩、移动方块、旧版切石机、传送门等
- **变种方块**:五种珊瑚与珊瑚块、生物头颅(骷髅/凋灵骷髅/僵尸/末影龙)、六种虫蚀方块、四种石砖
- **特殊物品**:附魔金苹果、下界之星、凋灵生成蛋、雪球与铁锭生成的蛋类物品、静态水与静态岩浆、气泡柱、细雪等

## 产物与安装

打包产物是**单个 `.mcpack`**:

```bash
npm run pack        # 产物写到 dist/packages/craftablerarities-v<version>_bp.mcpack
```

双击 `.mcpack` 由游戏导入,或在「设置 → 存储 → 行为包」中手动导入。

> **从旧版升级注意**:旧版发布物是 `.mcaddon`(同时含行为包与一个**空**资源包)。本版只保留行为包,资源包已移除。
> 如果你之前装过旧版 `.mcaddon`,请先在「设置 → 存储」里**手动删除**旧的行为包与资源包,再导入新的 `.mcpack`;
> 否则可能出现两份同名包并存的情况。

## 目录结构

```text
craftablerarities/
├── behavior_packs/craftablerarities/
│   ├── manifest.json                  # format_version 2,min_engine_version 1.21.0
│   ├── pack_icon.png                  # 128×128 RGBA
│   ├── item_catalog/
│   │   └── crafting_item_catalog.json # 创造物品栏补充条目
│   └── recipes/                       # 79 个配方
├── tools/
│   ├── generate-pack-icon.js          # 重新生成图标
│   ├── normalize-recipes.js           # 配方规范化(迁移期一次性使用,可重跑)
│   ├── build-recipe-baseline.js       # 生成迁移前基线
│   ├── recipe-baseline.js             # 基线数据
│   └── verify-recipes.js              # 配方等价性校验
├── just.config.ts                     # 只有打包与版本同步,没有编译任务
├── package.json                       # packing.mode = auto
└── .env
```

本模组**刻意不含** `scripts/`、`tsconfig.json`、`eslint.config.mjs`:它是纯内容模组,没有 TypeScript 源码需要编译。

## 配方约定

- `description.identifier` 统一使用 `craftablerarities:<name>` 冒号形式(与原版约定一致)
- 所有 `item` 值都带 `minecraft:` 前缀
- 变种物品优先使用扁平化显式 ID(如 `minecraft:tube_coral`),不用 `(item, data)` 写法
- 少数数据值表达的不是变种、而是状态或种类的物品仍保留 `data` 字段(`bubble_column` 的推拉方向、`potion` 的药水种类)
- `format_version` 保持 `1.12`

改写依据与逐条映射见 [docs/research/bedrock-item-data-values.md](../../docs/research/bedrock-item-data-values.md)。

## 校验

```bash
npm run verify:recipes   # 与迁移前基线逐条比对,确认材料、图案、产物、数量均未变化
npx mct validate         # 项目完整性校验
```

`mct validate` 会对 79 个配方各报一条 `FORMATVER156`(建议把 `format_version` 提升到当前版本)。这是**刻意接受**的:

提升版本会把配方带入高版本语义区间,而该区间的原版配方 93%~100% 带 `unlock` 字段,配方书解锁行为可能随之变化。本模组的目标是不改变玩家已有的合成体验。
