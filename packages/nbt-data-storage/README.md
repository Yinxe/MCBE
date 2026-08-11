# @yinxe/nbt-data-storage — MCBE 存储基石

MCBE 原版无法直接持久化物品的 NBT 数据（掉落物/背包等在部分场景丢 NBT）。本库提供一个**区块锚定的全木桶阵列**作为物品的持久化载体：木桶实物落进世界里，**每个格子持有一个 ItemStack（完整 NBT）**，任何模组都能按"唯一格子 ID"以 **O(1)** 秒定位并取出。

这不是一个完整的模组，而是**模组工具库 / 存储的基石**：消费模组在自己的 `main.ts` 里调用 `ItemStorage.register(...)` 注册一块存储区域，随后 `put / get / take / remove` 即用即存。

> **三种存储模式（路线图）**：物品保存（本库，已实现）/ 生物保存 / 结构保存。后两者将把实体/结构序列化成带 NBT 的自定义记录物品，存进**同一套桶阵列**，共用本库的 O(1) 寻址与动态扩容设施。

## 特性

- **完整 NBT**：物品以 `ItemStack` 存入木桶容器槽位，自定义 NBT / 附魔 / 组件全部保留。
- **O(1) 寻址**：格子 ID 采用稠密编号，`slotIdToPosition` 纯整数算术解码 → 木桶坐标 + 槽内索引，无查表、无扫描。
- **动态扩容**：阵列**不预生成**，按使用逐桶物化；纵向最多 `maxLevels` 层，堆满上限后 `put` 拒绝存入返回 `null`。
- **跨模组共享**：多个模组注册到**同一维度同一区块** → 共享同一阵列与分配水印（以世界真值为准，绝不覆盖他人物品）。
- **可 mock 测试**：`core/` 纯领域层**零 `@minecraft` 依赖**，可脱离游戏用 `node --test` 单测。
- **总存储可管理**：`nds:regions` / `nds:stats` 命令 + `queryWorld()` / `totalStats()`，其他模组只读即可盘点全库。

## 快速开始

```bash
# 消费模组声明依赖（workspace）
pnpm --filter <你的模组> add @yinxe/nbt-data-storage@workspace:*
```

```typescript
// 消费模组 main.ts（Phase 3 / Phase 4）
import { ItemStorage, installNdsCommands } from "@yinxe/nbt-data-storage";

// 注册一个存储区域：锚点坐标所在区块即存储地址（推荐末地虚空）
const region = ItemStorage.register({
  dimension: "minecraft:the_end",
  anchor: { x: 0, y: 120, z: -1024 }, // baseY 默认 120，maxLevels 默认 4（容量 27648 槽）
});

installNdsCommands(); // 可选：注册 nds:regions / nds:stats 管理命令（幂等；多模组重复调用也安全）

// 存入 → 拿到唯一格子 ID
const slotId = region.put(item); // item: ItemStack；满/失败返回 null

// 取物（O(1)，只读不回收）
const stored = region.get(slotId);

// 取走（读出 + 清空槽位 + 回收空洞，槽位可被复用）
const took = region.take(slotId);

// 仅清空
const ok = region.remove(slotId);

// 统计
const stats = region.stats();
// => { key, dimensionId, chunkX, chunkZ, baseY, maxLevels, capacity, used, nextFree, freePoolSize }
```

## API 一览

### `ItemStorage`

| 成员                                                  | 说明                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `register({ dimension, anchor, baseY?, maxLevels? })` | 注册/获取一个存储区域（幂等；同区块 → 共享）         |
| `listRegions()`                                       | 本模组上下文已注册的区域列表                         |
| `getRegion(key)`                                      | 按区域键取已注册区域                                 |
| `queryWorld()`                                        | 只读世界上的**全部**区域统计（无需本上下文注册）     |
| `totalStats()`                                        | 全库汇总 `{ regionCount, totalCapacity, totalUsed }` |

### `StoredRegion`

| 成员             | 说明                                     |
| ---------------- | ---------------------------------------- |
| `put(item)`      | 存入物品 → `slotId \| null`（O(1) 分配） |
| `get(slotId)`    | 按 ID 取物（O(1)，不回收）               |
| `take(slotId)`   | 取走（读出 + 清空 + 回收）               |
| `remove(slotId)` | 清空 + 回收                              |
| `stats()`        | 区域统计快照                             |

## 存储设计

### 格子 ID → 物理位置（纯算术 O(1)）

```
slotInBarrel = slotId % 27
barrelLocal  = floor(slotId / 27) % 256     // 区块内木桶序号 0..255
level        = floor(slotId / (27*256))     // 纵向层号
x = chunkX*16 + (barrelLocal % 16)
z = chunkZ*16 + floor(barrelLocal / 16)
y = baseY + level
```

- 一个区域 = 一个区块（16×16）的水平面 + 纵向 `maxLevels` 层桶 → 每层 256 桶 × 27 槽。
- 单区域容量 = `maxLevels × 256 × 27`（默认 4 层 = 27648 槽）。
- 取物只凭 ID 解码坐标，**无需查表/扫描**，即 O(1)。

### 动态扩容

阵列**不初始化时全量生成**。`put` 分配到一个槽位时才物化该桶（`setBlockType` 幂等，已存在即跳过），按使用逐桶/逐层增长；`nextFree` 水印触及容量上限后拒绝存入。空洞（`take`/`remove` 释放的槽位）进入 `freePool`，下次 `put` 优先复用，不浪费容量。

### 跨模组共享与数据安全

- **寻址共享**：`regionKey = 维度短名:区块X:区块Z`（如 `the_end:0:-64`）。任何模组注册到同一键 → 共享同一物理阵列。
- **共享单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）内的任意锚点共享同一阵列，跨区块各自独立。归块逻辑在 core 并有四象限/边界单测。
- **布局共享**：首个注册者把 `layout + 维度` 写进 DP 记录，后续模组直接采纳，不覆盖不改变。
- **以世界为真值**：分配元数据（水印 + 空洞池）是软状态，经 DP 读改写（RMW）持久化；`put` 写入前会**检查目标槽是否已被占用**——被外部占用则不覆盖、丢弃该候选、改选下一候选（有界重试 64 次）。元数据即使丢失，也会从世界真值自愈。

### 常加载

注册时通过 `tickingarea add` 把阵列所在区块加入常加载区块管理，保证区块卸载时容器仍可读写。
⚠️ 注意：

- `tickingarea` 为 **OP 命令**，世界需开启作弊（Script API 开发/测试环境默认开启）；未开启时注册静默失败，读写可能受区块加载影响（`put`/`get` 返回 `null`/`undefined` 而非崩溃）。
- MCBE 对 ticking area 数量有上限（约每维度 10 个），建议**把各模组存储集中在末地**，避免区域数量过多。

## 持久化键约定（DynamicProperty）

| 键                  | 内容                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `nds:regions`       | 全局区域索引（`string[]`，供其他模组只读盘点）                         |
| `nds:item:{区域键}` | 该区域记录：`{ v, dimensionId, layout, meta }`（meta = 水印 + 空洞池） |

## 测试

```bash
pnpm --filter nbt-data-storage run test   # 或根目录 pnpm run test:nbt-data-storage
```

- `core/` **零 `@minecraft` 依赖**，由 `tsconfig.test.json` 单独编译进 node 测试；`tests/*.test.ts` 用 `node:test` + `node:assert/strict`。
- mc 适配层（方块/容器 IO、ticking area）靠游戏内冒烟验证（同 item-route 约定）。

## 路线图：三种存储模式

| 模式                            | 状态      | 思路                                                           |
| ------------------------------- | --------- | -------------------------------------------------------------- |
| **物品保存** `ItemStorage`      | ✅ 已实现 | ItemStack 直接存木桶槽位                                       |
| **生物保存** `EntityStorage`    | 🔜 规划   | 实体 NBT 序列化 → 存为自定义记录物品（`nds:record`）进同一阵列 |
| **结构保存** `StructureStorage` | 🔜 规划   | 结构区域序列化 → 同上                                          |

三种模式共用本库的 O(1) 寻址、动态扩容、跨模组共享与常加载设施，DP 键预留 `nds:entity:` / `nds:structure:` 前缀。
