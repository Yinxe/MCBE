# 全物品家族分类扩展方案

## 目标
将 ItemFamilies 覆盖率从 1186/1575（75.3%）提升至 95%+，新增 6 个家族，补充所有遗漏物品到现有家族。

## 新增家族

### 1. 宝藏 (treasure) ~15 物品
稀有珍藏品：信标、附魔台、潮涌核心、磁石、刷怪笼、试炼刷怪笼、宝库、末地水晶、末地烛、海洋之心、下界之星、沉重核心、龙蛋、不死图腾

### 2. 刷怪蛋 (spawn_eggs) ~82 物品
所有 `*_spawn_egg` 物品

### 3. 锻造模板 (smithing_templates) ~19 物品
所有 `*_armor_trim_smithing_template` + `netherite_upgrade_smithing_template`

### 4. 陶片 (pottery_sherds) ~24 物品
23 种陶片 + `decorated_pot`

### 5. 旗帜图案 (banner_patterns) ~11 物品
10 种旗帜图案 + `banner`

### 6. 创造专属 (creative_only) ~20 物品
基岩、屏障、轻型方块(15级)、结构方块(3种)、命令方块(3种)、拼图方块、允许、拒绝、边界、NPC、代理机器人等

## 现有家族补充

### copper_blocks
- 添加：copper_block + 氧化变体(非切割)、铜门/铜活板门 + 氧化/蜡变体

### 人工合成物 (wood_misc)
- 添加：铁砧、开裂铁砧、损坏铁砧、钟、骨块、紫晶块、紫晶芽

### decorative_stone
- 添加：锁链、铁栏杆、蛙光体×3、雕纹石英块

### crops_food
- 添加：干草垛、干海带块

### common_minerals
- 添加：木炭、燧石

### rare_minerals
- 添加：下界合金碎片

### end
- 添加：爆裂紫颂果、末影珍珠、潜影壳

### potions
- 添加：恶魂之泪、火药、蜘蛛眼、兔脚、龙息、闪烁的西瓜、金胡萝卜、荧石粉

### tools
- 添加：碗、水生生物桶(鳕鱼/鲑鱼/河豚/热带鱼/蝾螈/美西螈/tadpole 桶)

### plants
- 添加：发光地衣

### surface
- 添加：霜冰

### stone_core
- 添加：被虫蚀的石头变体(7种)

### friendly_drops
- 添加：蓝蛋、褐蛋、烟花火箭

### hostile_drops
- 添加：蜘蛛网、经验瓶

### wood_products
- 添加：石化橡木台阶、船、箱子船

## 从原有家族移出的物品

| 物品 | 原家族 | 目标家族 |
|------|--------|---------|
| end_crystal | end | treasure |
| end_rod | end | treasure |
| heart_of_the_sea | friendly_drops | treasure |
| nether_star | hostile_drops | treasure |
| heavy_core | hostile_drops | treasure |
| dragon_egg | end | treasure |
| totem_of_undying | hostile_drops | treasure |
| snowball | (uncategorized) | weapons → **取消，不添加** |
| 各类 *_spawn_egg | (uncategorized) | spawn_eggs |
| 各类 *_template | (uncategorized) | smithing_templates |
| 各类 *_pottery_sherd | (uncategorized) | pottery_sherds |
| 各类 *_banner_pattern | (uncategorized) | banner_patterns |

## 实施顺序

1. 更新 `tools/generateItemFamilies.mjs` 生成器
2. 更新 `scripts/data/ItemFamilies.ts` 分类文件
3. 运行注释脚本加中文名
4. 编译验证
5. 提交
