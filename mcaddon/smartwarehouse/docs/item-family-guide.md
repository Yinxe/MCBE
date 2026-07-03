# 物品分类系统 — 总结与维护指南

## 概览

SmartWarehouse 的物品分类系统将 Minecraft 所有物品归入 **51 个家族**，覆盖 **1430 个物品 ID**（覆盖率 90.8%），用于仓库分拣 UI 的物品分类展示。

分类原则：**一个物品只属于一个家族**，按物品最自然的用途或来源归类。跨域物品（如 `ender_pearl` 既是末地主题又是弹射物）按主要功能归属。

---

## 51 个家族完整列表

### 建筑方块 (7)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `wool` | 羊毛 | 16 |
| `carpet` | 地毯 | 16 |
| `stained_glass` | 玻璃 | 35 |
| `concrete` | 混凝土 | 16 |
| `concrete_powder` | 混凝土粉末 | 16 |
| `terracotta` | 陶瓦 | 17 |
| `glazed_terracotta` | 带釉陶瓦 | 17 |

### 容器与装饰 (4)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `shulker_box` | 潜影盒 | 17 |
| `candle` | 蜡烛 | 17 |
| `dye` | 染料 | 16 |
| `bundle` | 同捆包 | 17 |

### 装备与家具 (2)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `bed` | 床 | 16 |
| `animal_gear` | 骑乘与驾驭 | 24 |

### 木材 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `logs` | 原木/菌柄 | 49 |
| `wood_products` | 木制品 | 164 |
| `wood_misc` | 人工合成物 | 40 |

### 石材 (5)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `stone_core` | 普通石材 | 53 |
| `deep_rock` | 深层岩石 | 38 |
| `decorative_stone` | 装饰石材 | 71 |
| `copper_blocks` | 铜方块 | 86 |
| `rare_minerals` | 稀有矿物 | 7 |

### 矿石 (2)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `common_minerals` | 普通金属矿物 | 23 |
| `common_ores` | 普通矿石 | 15 |
| `rare_ores` | 稀有矿石 | 5 |

### 装备与武器 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `wearables` | 可穿戴装备 | 28 |
| `weapons` | 武器 | 28 |
| `tools` | 工具 | 21 |

### 弹射物与道具 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `projectiles` | 弹射物 | 4 |
| `accessories` | 道具 | 10 |
| `books_maps` | 书与地图 | 5 |

### 红石与农业 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `buckets` | 桶 | 11 |
| `redstone` | 红石及原件 | 31 |
| `crops_food` | 农作物与食物 | 52 |

### 自然与生态 (6)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `plants` | 植物与树苗 | 61 |
| `flowers` | 花 | 19 |
| `coral` | 珊瑚 | 30 |
| `nether` | 地狱物品 | 48 |
| `end` | 末地物品 | 15 |
| `surface` | 地表方块 | 23 |

### 掉落物 (2)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `friendly_drops` | 友好生物掉落 | 12 |
| `hostile_drops` | 敌对生物掉落 | 16 |

### 药水与唱片 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `potions` | 药水与酿造 | 21 |
| `enchanted` | 附魔 | 1 |
| `music_disc` | 唱片 | 21 |

### 宝藏与结构 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `ancient_city` | 古城方块 | 8 |
| `treasure` | 宝藏 | 16 |
| `spawn_eggs` | 刷怪蛋 | 82 |

### 锻造陶片旗帜 (3)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `smithing_templates` | 锻造模板 | 19 |
| `pottery_sherds` | 陶片 | 24 |
| `banner_patterns` | 旗帜图案 | 11 |

### 创造专属 (1)
| 家族 ID | 名称 | 物品数 |
|---------|------|--------|
| `creative_only` | 创造专属 | 31 |

---

## 数据文件

### `scripts/data/ItemFamilies.ts` — 主数据文件

TypeScript 文件，导出 51 个 `ItemFamily` 常量。每个家族结构：

```typescript
const family_id: ItemFamily = {
  id: "family_id",
  displayName: "中文名称",
  items: [
    "minecraft:item_id", // 中文注释
  ],
};
```

然后在文件末尾通过 `export const ITEM_FAMILIES = [ ... ]` 导出汇总数组。

### `scripts/data/name-maps/` — 中文名映射目录

| 文件 | 内容 |
|------|------|
| `items-direct.ts` | 主力中译名映射 |
| `items-fallback.ts` | 英文 fallback 映射 |
| `items-special.ts` | 专属译名（覆盖） |
| `items-colors.ts` | 颜色变体物品映射 |
| `items-woods.ts` | 木材变体物品映射 |
| `items-compounds.ts` | 复合物品映射 |
| `items-gaps.ts` | 补充/缺失物品映射 |
| `entities.ts` | 实体 ID → 中文名 |
| `effects.ts` | 效果 ID → 中文名 |
| `enchantments.ts` | 附魔 ID → 中文名 |
| `types.ts` | 类型定义 |
| `index.ts` | 汇总导出 |

---

## 维护工具

### 1. 分类生成器 `tools/generateItemFamilies.mjs`

自动化生成 ItemFamilies.ts 的脚本。它根据 Minecraft 数据自动构建颜色变体、木材变体等重复模式，然后输出完整的 TypeScript 文件。

**用法：**
```bash
cd tools && node generateItemFamilies.mjs > ../scripts/data/ItemFamilies.ts
```

**重要：** 如果你手动修改了 ItemFamilies.ts，需要同样更新此生成器中的 `ALL.*` 部分，否则重新生成时会丢失手动变更。

### 2. 中文名注释注入 `tools/annotateFamilies.mjs`

为 ItemFamilies.ts 中所有 `"minecraft:xxx"` 条目自动添加中文注释（从 name-maps/ 查询）。

**用法：**
```bash
cd tools && node annotateFamilies.mjs
```

会在已有注释的条目旁补上中文名（跳过已有注释的行和查不到译名的行）。

---

## 维护原则

### 分类原则
1. **按掉落来源** — 只放该生物直接掉落物
2. **按主要用途** — 跨域物品按最能体现其功能的家族归属
3. **一个物品一个家** — 避免重复（铜块系列是唯⼀的特例）
4. **物品不计入家族** — 实体 ID、效果 ID、附魔 ID 不放入家族

### 添加新物品的步骤
1. 确保 `name-maps/` 中有该物品的中文名
2. 确定它所属的家族
3. 在 `ItemFamilies.ts` 对应家族的 `items` 数组中添加
4. 在 `generateItemFamilies.mjs` 的对应 `ALL.*` 部分同步添加
5. 运行 `tools/annotateFamilies.mjs` 补充注释
6. 运行 `npx tsc --noEmit` 验证编译

### 新增家族的步骤
1. 在 `ItemFamilies.ts` 中添加新的 `const` 块（放在逻辑位置）
2. 在 `ITEM_FAMILIES` 导出数组中注册新家族
3. 在 `generateItemFamilies.mjs` 中添加对应的 `ALL.*` 行
4. 运行注释 + 编译验证

---

## 版本记录

| 日期 | 变更 |
|------|------|
| 2026-07-03 | 初始分类完成：51 家族，90.8% 覆盖率 |
| | 友好/敌对掉落物严格按来源清洗 |
| | 新增 accessories/buckets/books_maps/enchanted/projectiles 家族 |
| | 修复多处注释错误（blue_dye、black_dye 等） |
