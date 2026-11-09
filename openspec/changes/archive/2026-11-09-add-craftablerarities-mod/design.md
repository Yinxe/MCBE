# Design

## Context

见 `proposal.md - Why`。本节只记录实现所依赖的当前状态与约束。

**源模组实测结论**(依据 `~/gitRepos/bedrock-samples` v1.26.60.5 官方原版行为包与 `@minecraft/vanilla-data` 1.26.60):

- 79 个配方全部为 `format_version 1.12` 的 `recipe_shaped` / `recipe_shapeless`,`tags` 均为 `["crafting_table"]`。
- `description.identifier` 全部为 `craftablerarities/<name>` 斜杠式;原版 1892 个配方 100% 用 `minecraft:<name>` 冒号式,无一例斜杠。
- 物品引用全部省略 `minecraft:` 前缀;其中 `Feather` / `String` / `TNT` 为大小写旧别名。
- 32 个配方文件使用 `(item, data)` 辅助值写法,共 32 种 `(item, data)` 组合。
- 资源包仅含 `manifest.json` 与 `pack_icon.png`,无任何内容文件;两个图标均为 256×256。

**已核实的关键事实**(决定「能否改写」):

| 事实 | 证据 |
| --- | --- |
| `data` 字段未被移除 | 原版 `format_version 1.26.50` 的配方仍有 17 个使用 `data`,如 `suspicious_stew_from_wither_rose` 的 `result.data` |
| legacy 方块 ID 有合法带前缀形式 | `minecraft:invisible_bedrock`、`minecraft:netherreactor`、`minecraft:glowingobsidian`、`minecraft:moving_block`、`minecraft:end_gateway`、`minecraft:client_request_placeholder_block` 均出现在官方 `mojang-commands.json` |
| legacy 方块 ID 不在物品表中 | 上述 ID 及 `minecraft:stonecutter`、`minecraft:portal` 均不在 `mojang-items.json`;`stonecutter` 与 `portal` 只在方块表 |
| 原版低版本配方从不使用扁平化 ID | `format_version` 为 1.12 / 1.16 的原版配方中,扁平化 ID(`tube_coral`、`infested_stone`、`stone_bricks` 等)出现次数为 0 |
| 高版本原版配方几乎都带 `unlock` | 1.20.10 起 `unlock` 覆盖率 93%~100%;1.12 仅 16%,1.16 为 0% |
| `mct validate` 无法判定物品 ID 有效性 | `UNLINK323` 对原版存在的 `piston`、`redstone` 同样报警,故不能作为等价性证据 |

**已纠正的映射错误**:`red_flower` 的数据值 7 是**粉郁金香**(`pink_tulip`),不是铃兰;铃兰为数据值 10。早期分析中的 `red_flower:7 → lily_of_the_valley` 结论错误,本设计以 `pink_tulip` 为准。

## Goals / Non-Goals

**Goals**

- 迁移后产物行为与源模组逐条等价,可用「配方四要素对照表」机械核对。
- 让改写范围由证据决定,而不是由「看起来应该这样」决定:每条改写都能指向一个确定的 ID 映射依据。
- 使「等价性」成为可复核的交付物,而不是一次性的人工确认。

**Non-Goals**

- 不追求把 79 个配方全部改写成现代写法。规范化覆盖率不是目标,等价性才是。
- 不改变配方的配方书解锁条件、分组、优先级等可选字段。
- 不重绘或重新设计图标美术,只做尺寸与色彩类型合规化。
- 不引入脚本,不引入 `@minecraft/server`。

## Decisions

### 决策 1:规范化采用「白名单改写 + 默认保留」,而非全量改写

只有同时满足以下三条的引用才改写为扁平化显式 ID:

1. 该 ID 在 `mojang-blocks.json` / `mojang-items.json` 中存在;
2. 官方数据值表中存在 `(item, data) → 显式 ID` 的确定映射;
3. 映射可在本地数据文件中机械核对(不依赖记忆或社区帖子)。

不满足的引用**保留 `(item, data)` 原写法**,仅补 `minecraft:` 前缀(前缀已由 `mojang-commands.json` 证实合法)。

**理由**:原版在 1.12 / 1.16 的配方中从不使用扁平化 ID,说明扁平化 ID 的使用很可能受 `format_version` 门控。在 `format_version` 保持不变的前提下把 `data` 改写成扁平化 ID,其行为等价性无法静态证明。

**备选方案**

- 全量改写(方案 1B 的字面理解):覆盖率高、写法统一,但会把无法证明的引用也一并改写,违反「不得改变行为」。
- 完全不改写(方案 1A):绝对安全,但保留了 `Feather` 这类大小写旧别名,且斜杠 identifier 与官方约定不符。

### 决策 2:`format_version` 保持 1.12,不提升

`mct validate` 的 `FORMATVER156` 是 RECOMMENDATION 而非错误。提升 `format_version` 会把配方带入「高版本语义」区间,而该区间的原版配方 93%~100% 带 `unlock` 字段,意味着配方书解锁行为可能随之变化。为守住「行为不变」,本次不提升版本,并在文档中记录该建议项为**已知且刻意接受**。

**理由**:`format_version` 同时影响字段语义与配方书行为,提升它是行为变更,不属于「结构迁移」。

**备选方案**:提升到 1.20.10 并补 `unlock`(让配方书默认可见)。这会改变玩家发现配方的路径,属于产品决策,应由用户单独决定,不混入迁移。

### 决策 3:删除资源包

源资源包不含任何内容文件,删掉它不损失任何可观察行为,产物从 `.mcaddon` 变为单个 `.mcpack`,符合 `addon-packaging` 的 `auto` 模式语义(1 个包 → `.mcpack`)。

**备选方案**:保留空资源包以维持 `.mcaddon` 产物形态。代价是要为一个空包维护图标、清单与版本同步,且 `pack-icon` 规范要求 128×128 图标,等于为一个无内容的包额外付出成本。

### 决策 4:`minimum_engine_version` 显式配置

`@mc-toolchain/packaging` 在缺少 `packing.minimum_engine_version` 时会尝试从 `@minecraft/server` 依赖推导。本模组无该依赖,推导会失败或落到兜底值。因此在 `package.json#packing` 中显式声明 `minimum_engine_version`,取值与源清单的 `[1, 21, 0]` 保持一致。

### 决策 5:不保留 `scripts/` 与 `tsconfig.json`

模组无脚本。`mod-workspace` 已按本次需要修订为「纯内容模组不保留空的 `scripts/` 与 TypeScript 源码,但仍保留 `just.config.ts` 与 `.env`」。`tsconfig.json` 与 `eslint.config.mjs` 一并省略,避免留下无源码可检查的配置。

### 决策 6:等价性验收靠「配方四要素对照表」,不靠校验工具

由于 `mct validate` 的 `UNLINK323` 对原版物品同样报警,它无法证明 ID 有效性;`FORMATVER156` 只反映版本建议。因此验收改为:

1. 脚本把迁移前、迁移后的每个配方归一化为 `(材料集合, 图案, 产物, 数量)` 四元组并逐条比对,任何差异即失败;
2. 对白名单改写的条目,额外输出 `(item, data) → 显式 ID` 的依据行号,便于人工复核;
3. 实机抽样:在基岩版创造模式中抽样验证若干配方(至少覆盖珊瑚、头颅、虫蚀方块、legacy 方块各一例)。

## Risks / Trade-offs

- **[斜杠 identifier 改为冒号后,已解锁该配方的存档可能出现重复条目]** → 配方 ID 变更会写入玩家解锁记录。缓解:在验收中确认配方数量与产物不变;该风险仅影响配方书展示,不影响能否合成。若实测发现异常,回退 identifier 改写,只保留目录与构建迁移。
- **[白名单改写后实机行为与预期不符]** → 缓解:实机抽样为硬性验收项;一旦某条不符,该条回退为保留原写法,并把结论写回映射文档。
- **[保留 `format_version 1.12` 使 `mct validate` 持续报 `FORMATVER156`]** → 缓解:在文档中标注为刻意接受,并在 CI 中不将其视为失败(它是 RECOMMENDATION)。
- **[legacy 方块配方(`netherreactor`、`glowingobsidian` 等)在部分版本可能本就无法合成]** → 这是源模组的既有行为,迁移不改变它。缓解:不作为本次验收的通过条件,仅在文档中记录现状。
- **[图标从 256×256 缩到 128×128 会损失细节]** → 缓解:按 `pack-icon` 规范以像素画方式重绘而非简单缩放,保持可辨识度。
- **[删除资源包后,若玩家已安装旧 `.mcaddon`]** → 缓解:在模组 README 中说明本次产物形态变化,提示先移除旧包。

## Migration Plan

1. 复制内容到 `mods/craftablerarities/`,目录改为 `behavior_packs/` 与 `resource_packs/`(资源包随后删除)。
2. 生成构建骨架:`package.json`(含 `packing` 块)、`just.config.ts`、`.env`。
3. 重绘 128×128 图标。
4. 规范化配方:先补 `minecraft:` 前缀与冒号 identifier,再按白名单改写辅助值。
5. 生成等价性对照表并核对。
6. 打包并实机抽样验证。
7. 更新 `README.md`、`mods/README.md`、`docs/research/`。

**回滚**:本变更为纯新增目录,删除 `mods/craftablerarities/` 即可完全回滚;不涉及对 `packages/` 或其它模组的修改。

## Open Questions

- 斜杠式 identifier 在当前游戏版本是否本就无效?若实测发现源配方从未真正生效,则本次「改冒号」属于修复而非迁移,需重新界定验收基线。此项不影响任务拆分,可在实机抽样时一并确认。
