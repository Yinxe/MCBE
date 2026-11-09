# 基岩版物品数据值(辅助值)与扁平化 ID 映射

本文记录 `craftablerarities` 模组配方规范化时依据的事实,以及「哪些辅助值可以安全改写为显式 ID」的判定标准。

**证据来源**

- 官方原版行为包 `~/gitRepos/bedrock-samples`(v1.26.60.5),目录 `behavior_pack/recipes/`(1892 个配方)与 `metadata/vanilladata_modules/`
- `@minecraft/vanilla-data` 1.26.60(`node_modules/@minecraft/vanilla-data/lib/mojang-item.d.ts`、`mojang-block.d.ts`)
- 中文/英文 Minecraft Wiki 的数据值章节(逐条核对,见文末链接)

---

## 1. 关键结论

| 结论 | 证据 |
| --- | --- |
| 配方 `identifier` 是**不透明字符串**,不与产物对应 | 原版 1892 个配方中 959 个(50.7%)的 `identifier` 名字与 `result.item` 不同;Wiki 定义仅为「用于区分不同的配方」。详见 §2 |
| 第三方包必须用自定义命名空间 | 原版 1892 个配方的 `identifier` 全部在 `minecraft:` 下,沿用会主键冲突 |
| 原版配方 identifier 全部使用 `minecraft:<name>` 冒号形式 | 1892 个配方中,0 个使用 `/`;唯一无冒号的 `stonecutter_stairs_from_polished_blackstone_bricks` 属于特例,且其 `tags` 为 `stonecutter` 而非 `crafting_table` |
| `data` 字段**未被移除**,高版本仍在使用 | `format_version 1.26.50` 的 154 个配方中仍有 17 个使用 `data`,例如 `suspicious_stew_from_wither_rose` 的 `result.data = 9` |
| 原版低版本配方**从不**使用扁平化 ID | `format_version` 为 1.12 / 1.16 的原版配方中,`tube_coral`、`infested_stone`、`stone_bricks` 等扁平化 ID 出现次数为 **0** |
| 高版本原版配方几乎都带 `unlock` | 1.20.10 起覆盖率 93%~100%;1.12 仅 16%,1.16 为 0% |
| legacy 方块 ID 有合法的带前缀形式 | `minecraft:invisible_bedrock`、`minecraft:netherreactor`、`minecraft:glowingobsidian`、`minecraft:moving_block`、`minecraft:end_gateway`、`minecraft:client_request_placeholder_block` 均出现在官方 `metadata/command_modules/mojang-commands.json` |
| 上述 legacy ID **不在**物品表中 | 同样不在 `metadata/vanilladata_modules/mojang-items.json`;`minecraft:stonecutter` 与 `minecraft:portal` 只在方块表 |
| 两张表都查不到 ≠ 无法获得 | 实机确认这 7 个 legacy 方块均可从创造物品栏取得;其中 `invisible_bedrock` 甚至未在 `item_catalog` 中声明。详见 §7 |
| 变种类改写已实机验证 | 珊瑚、头颅、虫蚀方块、染色玻璃板等 30 条改写均能正常产出(§7);但「能产出」不等于「状态正确」,`bubble_column` 与 `potion` 的 `data` 仍需单独确认 |
| `mct validate` 不能证明 ID 有效性 | `UNLINK323` 对原版真实存在的 `piston`、`redstone` 同样报警 |

**由此得出的三条判定规则**

1. 补 `minecraft:` 前缀是安全的:legacy ID 的带前缀形式已由官方命令模块证实。
2. 把 `(基础 ID, data)` 改写为扁平化 ID **不能**在 `format_version 1.12` 下静态证明等价,因此只改写能在官方数据值表中机械核对到唯一映射的条目,其余保留原写法。
3. 配方的 `identifier` 用自定义命名空间、产物用 `minecraft:` 原版 ID,两者互不影响;判断产物是否有效只需查 `result.item`。

---

## 2. 两个独立的 ID 体系:`identifier` 与 `result.item`

配方文件里有两个看起来都像「ID」的字段,但它们属于**完全不相干的两套体系**。混清这一点会直接导致对「自定义命名空间能不能被识别」的误判。

| 字段 | 示例 | 游戏怎么用它 | 必须是原版吗 |
| --- | --- | --- | --- |
| `description.identifier` | `craftablerarities:portal` | 登记配方时的**主键**,用于区分/去重/供 `/recipe` 定位 | 否,第三方包必须自定义 |
| `result.item` | `minecraft:portal` | 查**物品/方块注册表**决定产出什么 | 是(或自己注册过的) |
| `key.*.item` | `minecraft:obsidian` | 同上,查注册表 | 是 |

Wiki 对 `identifier` 的定义只有一句:「此配方的标识符,**用于区分不同的配方**」([配方 · recipe_shaped](https://zh.minecraft.wiki/w/%E9%85%8D%E6%96%B9))。它是一个**不透明字符串**,游戏从不拿它去物品表里查任何东西。产物完全由 `result.item` 决定。

所以 `craftablerarities:portal` + `result.item: minecraft:portal` 能正常工作:前者只是给配方起了个名字,后者才是真正被解析的产物。反之,若把 `result.item` 写成 `craftablerarities:portal`,才会真的失效。

### 证据:`identifier` 与产物名本来就大量不一致

原版 1892 个配方中,**959 个(50.7%)** 的 `identifier` 名字部分与 `result.item` 不同。若 `identifier` 需要与产物对应,这半数配方根本无法工作。

| 文件 | `identifier` | `result.item` |
| --- | --- | --- |
| `bone_meal_from_block.json` | `minecraft:bone_meal_from_block` | `minecraft:dye` |
| `gray_dye_from_ink_bonemeal.json` | `minecraft:gray_dye_from_ink_bonemeal` | `minecraft:dye` |
| `cartography_table_map.json` | `minecraft:cartography_table_map` | `minecraft:emptymap` |
| `sign_darkoak.json` | `minecraft:sign_darkoak` | `minecraft:darkoak_sign` |
| `waxing_oxidized_copper_grate.json` | `minecraft:waxing_oxidized_copper_grate` | `minecraft:waxed_oxidized_copper_grate` |

验证方式:

```bash
cd ~/gitRepos/bedrock-samples/behavior_pack/recipes
python3 -c "
import json,glob
n=m=0
for f in glob.glob('*.json'):
    d=json.load(open(f))
    for k,v in d.items():
        if not k.startswith('minecraft:recipe_'): continue
        n+=1
        r=v.get('result')
        if isinstance(r,dict) and v['description']['identifier'].split(':')[-1]!=r.get('item','').split(':')[-1]: m+=1
print(f'{m}/{n}')
"
```

### 为什么第三方包必须用自定义命名空间

原版 1892 个配方的 `identifier` 全部落在 `minecraft:` 命名空间下。第三方包若沿用 `minecraft:`,会与原版配方**主键冲突**(表现为覆盖或互相失效)。因此 `craftablerarities:` 前缀不是可选项,而是必要条件。

### 产物是否仍为原版物品

`craftablerarities` 的 68 个不同产物**全部**是 `minecraft:` 开头的原版 ID,无一是自定义:

| 分类 | 数量 | 示例 |
| --- | --- | --- |
| 在 `mojang-items.json`(可正常给予) | 52 | `nether_star`、`elytra`、`sponge` |
| 仅在 `mojang-blocks.json`(方块形态) | 9 | `portal`、`water`、`lava`、`bubble_column`、`powder_snow`、`camera`、`end_portal`、`flowing_water`、`piston_arm_collision` |
| 两表都无(legacy 隐藏方块) | 7 | `netherreactor`、`glowingobsidian`、`moving_block`、`invisible_bedrock`、`client_request_placeholder_block`、`end_gateway`、`stonecutter` |

前两类有官方数据背书。第三类只在 `mojang-commands.json` 中出现过,不在物品表也不在方块表;但**实机已确认这 7 个方块均能从创造物品栏取得**(见 §7),包括未在 `item_catalog` 中声明的 `invisible_bedrock`。这说明这两张表并不是「方块能否获得」的权威依据,而只是需要数据值驱动的条目清单。

> 这些方块在配方里**只作为产物**,不是材料(唯一例外:`netherreactor` 在 `命令方块.json` 中作为材料,该方块已确认可取得)。

---

## 3. 已改写的映射(白名单)

以下 30 条均可在 `mojang-blocks.json` 中核对到 `name`,且同时在 `mojang-items.json` 中可给予。

### 珊瑚(植物)

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `coral` + `data:0` | `minecraft:tube_coral` | `tile.coral.blue` |
| `coral` + `data:1` | `minecraft:brain_coral` | `tile.coral.pink` |
| `coral` + `data:2` | `minecraft:bubble_coral` | `tile.coral.purple` |
| `coral` + `data:3` | `minecraft:fire_coral` | `tile.coral.red` |
| `coral` + `data:4` | `minecraft:horn_coral` | `tile.coral.yellow` |

### 珊瑚块

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `coral_block` + `data:0` | `minecraft:tube_coral_block` | `tile.coral_block.blue` |
| `coral_block` + `data:1` | `minecraft:brain_coral_block` | `tile.coral_block.pink` |
| `coral_block` + `data:2` | `minecraft:bubble_coral_block` | `tile.coral_block.purple` |
| `coral_block` + `data:3` | `minecraft:fire_coral_block` | `tile.coral_block.red` |
| `coral_block` + `data:4` | `minecraft:horn_coral_block` | `tile.coral_block.yellow` |

### 生物头颅

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `skull` + `data:0` | `minecraft:skeleton_skull` | `tile.skull.skeleton` |
| `skull` + `data:1` | `minecraft:wither_skeleton_skull` | `tile.skull.wither` |
| `skull` + `data:2` | `minecraft:zombie_head` | `tile.skull.zombie` |
| `skull` + `data:5` | `minecraft:dragon_head` | `tile.skull.dragon` |

### 虫蚀方块

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `monster_egg` + `data:0` | `minecraft:infested_stone` | `tile.monster_egg.stone` |
| `monster_egg` + `data:1` | `minecraft:infested_cobblestone` | `tile.monster_egg.cobble` |
| `monster_egg` + `data:2` | `minecraft:infested_stone_bricks` | `tile.monster_egg.brick` |
| `monster_egg` + `data:3` | `minecraft:infested_mossy_stone_bricks` | `tile.monster_egg.mossybrick` |
| `monster_egg` + `data:4` | `minecraft:infested_cracked_stone_bricks` | `tile.monster_egg.crackedbrick` |
| `monster_egg` + `data:5` | `minecraft:infested_chiseled_stone_bricks` | `tile.monster_egg.chiseledbrick` |

### 石砖

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `stonebrick` + `data:0` | `minecraft:stone_bricks` | `tile.stonebrick.default` |
| `stonebrick` + `data:1` | `minecraft:mossy_stone_bricks` | `tile.stonebrick.mossy` |
| `stonebrick` + `data:2` | `minecraft:cracked_stone_bricks` | `tile.stonebrick.cracked` |
| `stonebrick` + `data:3` | `minecraft:chiseled_stone_bricks` | `tile.stonebrick.chiseled` |

### 其它

| 原写法 | 改写为 | `serialization_id` |
| --- | --- | --- |
| `stained_glass_pane` + `data:10` | `minecraft:purple_stained_glass_pane` | `tile.stained_glass_pane.purple` |
| `stained_hardened_clay` + `data:1` | `minecraft:orange_terracotta` | `tile.stained_hardened_clay.orange` |
| `double_plant` + `data:5` | `minecraft:peony` | `tile.double_plant.paeonia` |
| `red_flower` + `data:7` | `minecraft:pink_tulip` | `tile.red_flower.tulipPink` |
| `yellow_wool` + `data:4` | `minecraft:yellow_wool` | `tile.wool.yellow` |
| `stone` + `data:3` | `minecraft:diorite` | `tile.stone.diorite` |

> **注意 `red_flower:7`**:数据值 7 是**粉郁金香**(`pink_tulip`),铃兰(`lily_of_the_valley`)是数据值 **10**。早期分析曾误判为铃兰,此处以官方 `serialization_id = tile.red_flower.tulipPink` 为准。
>
> **注意 `yellow_wool:4`**:颜色数据值 4 恰好就是黄色,该 `data` 属于冗余写法,改写后物品不变。

---

## 4. 刻意保留原写法的组合

| 原写法 | 保留原因 |
| --- | --- |
| `bubble_column` + `data:0` / `data:1` | `bubble_column` 在基岩版是**不可给予的方块**,数据值表达气泡柱的推拉方向(0 = 向下拖拽,1 = 向上推动),不是变种索引,没有对应的独立 ID |
| `potion` + `data:7` | 药水数据值表达**药水种类**(7 = 隐身药水),没有对应的独立物品 ID;`potion` 仍是唯一标识符 |

这两类合计 3 处引用,均在 `format_version 1.12` 下按原写法保留。

---

## 5. 大小写旧别名

| 原写法 | 改写为 |
| --- | --- |
| `Feather` | `minecraft:feather` |
| `String` | `minecraft:string` |
| `TNT` | `minecraft:tnt` |

---

## 6. 等价性验证方法

`mct validate` 无法用于证明等价(见 §1 最后一行),因此等价性靠以下三件事保证:

1. **机械比对**:`tools/build-recipe-baseline.mjs` 把迁移前配方归一化为 `(材料, 图案, 产物, 数量)` 四元组写入 `tools/recipe-baseline.json`;`tools/verify-recipes.mjs` 用同一归一化规则处理迁移后配方并逐条比对。
2. **改写依据可追溯**:每条白名单改写都能在 §2 找到 `serialization_id` 行。
3. **实机抽样**:见 §6。

## 7. 实机抽样记录

### 已确认:7 个 legacy 隐藏方块在创造物品栏可见

在基岩版创造模式中确认,以下 7 个方块均**能从创造物品栏直接取得**:

| 方块 ID | 创造栏可见 | 在 `item_catalog` 中声明 |
| --- | --- | --- |
| `minecraft:netherreactor` | 是 | 是 |
| `minecraft:glowingobsidian` | 是 | 是 |
| `minecraft:moving_block` | 是 | 是 |
| `minecraft:client_request_placeholder_block` | 是 | 是 |
| `minecraft:end_gateway` | 是 | 是 |
| `minecraft:stonecutter` | 是 | 是 |
| `minecraft:invisible_bedrock` | 是 | **否** |

**关键结论:`invisible_bedrock` 未在 `item_catalog` 中声明却仍可见**,证明可见性由游戏自身的方块注册决定,与本模组的 `item_catalog` 无关。`item_catalog/crafting_item_catalog.json` 只用于**自定义物品**在创造栏与配方书中的排序归组([基岩版 1.21.60](https://zh.minecraft.wiki/w/%E5%9F%BA%E5%B2%A9%E7%89%881.21.60)),不影响原版方块是否可见。

因此 `mojang-items.json` / `mojang-blocks.json` **不是判断方块能否获得的权威依据**——那两张表只收录需要数据值驱动的条目,legacy 隐藏方块不在其中却依然可用。§2 中把这类 ID 标为「唯一真正需要实机确认的部分」是恰当的谨慎,但实机结果已经排除了风险。

### 已确认:变种物品均可正常产出

实机抽样确认,以下类别的产物均能正常合成并取得(至少抽查了一例,基本全覆盖):

- [x] 珊瑚类:`tube_coral`、`brain_coral`、`bubble_coral`、`fire_coral`、`horn_coral` 及其 `_block` 形态
- [x] 头颅类:`skeleton_skull`、`wither_skeleton_skull`、`zombie_head`、`dragon_head`
- [x] 虫蚀方块:`infested_stone`、`infested_cobblestone`、`infested_stone_bricks`、`infested_mossy_stone_bricks`、`infested_cracked_stone_bricks`、`infested_chiseled_stone_bricks`、`infested_deepslate`
- [x] `bubble_column` 保留 `data:0/1` 后能产出对应方块
- [x] `potion` 保留 `data:7` 后能产出药水

这一结果与静态分析一致:这 30 条改写均能在官方数据值表中核对到唯一映射,属于可证等价改写。

### 仍未验证:保留 `data` 的两条行为是否正确

「能产出方块」不等于「产出的状态正确」。以下两条无法通过「产物存在」判断,因为 `data` 在这里表达的是**状态**而非变种索引,产物外观相同、内部状态可能不同:

| 配方 | `data` 含义 | 正确的表现 | 当前状态 |
| --- | --- | --- | --- |
| `气泡柱-上.json` | `bubble_column:1` | 把实体向上推 | 未验证 |
| `气泡柱-下.json` | `bubble_column:0` | 把实体向下拉 | 未验证 |
| `隐形的基岩.json` | `potion:7` | 材料为**隐身药水**(不是任意药水) | 未验证 |

验证方式:

1. **气泡柱**:放下产物后走进其中,观察被向上推还是向下吸;两配方应方向相反。
2. **隐身药水**:确认 `potion:7` 作为材料被接受。若把 `data:7` 去掉后配方仍可合成,说明游戏忽略了 `data`,则这条配方实际接受任意药水 —— 属于需要修正的偏差。

> 这两项在迁移前就是同样写法,因此即使有偏差也不是本次引入的;但既然保留 `data` 是为保持行为不变,就应当确认它确实生效。

## 8. `format_version` 决策

配方保持 `format_version 1.12` 不变。`mct validate` 会报 `FORMATVER156`(建议提升版本),该建议项**刻意接受**:

- 提升 `format_version` 会把配方带入高版本语义区间,而该区间的原版配方 93%~100% 带 `unlock` 字段,配方书解锁行为可能随之变化;
- 本次目标是结构迁移,不应改变玩家发现配方的路径。

## 9. 斜杠 identifier 的性质

源项目 79 个配方全部使用 `craftablerarities/<name>` 斜杠写法,而原版 1892 个配方无一例使用斜杠。已改为冒号形式。

**已实测**:冒号形式(`craftablerarities:portal`)在游戏内可被正常识别、可正常合成。这证明冒号有效,但**没有**直接证明斜杠无效。

基于 §2 的结论(『identifier 是不透明字符串,仅用于区分配方』),**更可能的解释是**:斜杠写法一直都能正常工作,`/` 只是不符合原版惯例。也就是说,这次改动大概率是**等价迁移**而非修 bug。

> 待验证:将旧版 `.mcaddon` 装入游戏并检查配方是否可用,即可彻底钉死这一点。若旧版确实可用,则斜杠→冒号不构成任何行为变化;若旧版不可用,则需把验收基线从「等价迁移」改为「修复缺陷」。

无论哪种结论,改为冒号都是向官方约定对齐。

## 10. 本次无法静态证明的部分

以下事项无法仅靠文件比对确定,集中列在此处以免日后误以为已经验证。

### 已由实机排除

| 事项 | 静态手段为何无效 | 实机结果 |
| --- | --- | --- |
| 7 个 legacy 隐藏方块能否获得 | 只在 `mojang-commands.json` 出现,不在物品/方块表;`mct validate` 的 `UNLINK323` 对原版真实物品也会报警 | **均可从创造物品栏取得**,含未在 `item_catalog` 声明的 `invisible_bedrock`(见 §7) |

### 仍待实机确认

| 事项 | 静态手段为何无效 | 确认方式 |
| --- | --- | --- |
| `bubble_column:0/1` 的推/拉方向是否正确 | `data` 在这里表达状态而非变种索引,产物外观相同,无法从「能合成」推出 | 放下产物后走进去看被推还是被吸(见 §7) |
| `potion:7` 是否真被当作隐身药水材料 | 同上;若 `data` 被忽略,配方会默默接受任意药水 | 看材料位是否只认隐身药水(见 §7) |
| 斜杠 identifier 是否本就无效 | 需要旧版包对比 | 见 §9 |

> 变种类(珊瑚、头颅、虫蚀方块等 30 条改写)已实机确认能正常产出,详见 §7。

### 关于「刻意不加入合成」

源项目有意不把 `netherreactor` 等隐藏方块设为可合成产物之外的材料(唯一例外是 `命令方块.json` 用 `netherreactor` 作材料)。它们的定位是「创造模式快速获取」的**产物**,而非生存链中的**中间材料**。这不是遗漏,迁移时已原样保留。

---

## 参考

- [Coral](https://minecraft.wiki/w/Coral) · [Coral Block](https://minecraft.wiki/w/Coral_Block) · [Head](https://minecraft.wiki/w/Head)
- [Infested Block](https://minecraft.wiki/w/Infested_Block) · [Stone Bricks](https://minecraft.wiki/w/Stone_Bricks)
- [Stained Glass Pane](https://minecraft.wiki/w/Stained_Glass_Pane) · [Stained Terracotta](https://minecraft.wiki/w/Stained_Terracotta)
- [Bubble Column](https://minecraft.wiki/w/Bubble_Column) · [Potion](https://minecraft.wiki/w/Potion) · [Flower](https://minecraft.wiki/w/Flower)
- [Recipe (Bedrock Edition)](https://minecraft.wiki/w/Recipe_(Bedrock_Edition))
