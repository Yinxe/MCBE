# @yinxe/nbt-data-storage — MCBE 存储基石

MCBE 原版无法直接持久化物品的 NBT 数据（掉落物/背包等在部分场景丢 NBT）。本库提供一个**区块锚定的全木桶阵列**作为物品的持久化载体：木桶实物落进世界里，**每个格子持有一个 ItemStack（完整 NBT）**，任何模组都能按"唯一格子 ID"以 **O(1)** 秒定位并取出。

这不是一个完整的模组，而是**模组工具库 / 存储的基石**：消费模组在自己的 `main.ts` 里调用 `ItemStorage.register(...)` 注册一块存储区域，随后 `put / get / take / remove` 即用即存。

> 想进游戏亲手验证能力？仓库自带演示 addon `demo/`（包名 `nds-demo`，显示名"NBT存储测试"）：完整配置 UI + 命令/UI 双通道存取，`pnpm run pack:nds-demo` 打包进游戏即可冒烟（见 `demo/README.md`）。

> **三种存储模式（路线图）**：物品保存（本库，已实现）/ 生物保存 / 结构保存。后两者将把实体/结构序列化成带 NBT 的自定义记录物品，存进**同一套桶阵列**，共用本库的 O(1) 寻址与动态扩容设施。

## 特性

- **完整 NBT**：物品以 `ItemStack` 存入木桶容器槽位，自定义 NBT / 附魔 / 组件全部保留。
- **O(1) 寻址**：格子 ID 采用稠密编号，`slotIdToPosition` 纯整数算术解码 → 木桶坐标 + 槽内索引，无查表、无扫描。
- **凭据取物**：`put` 成功返回 `{ regionId, slotId }`，凭这个二元组 `ItemStorage.get/take(ref)` O(1) 秒定位（跨模组可用）。
- **动态扩容**：阵列**不预生成**，按使用逐桶物化；纵向固定 64 层（0..63，无需配置），堆满上限后 `put` 拒绝存入返回 `null`。
- **原子传输**：`transferIn/transferOut` 提供与原版容器一致的**安全传输**——要么整体成功，要么保持原状，物品不丢不重复。
- **自定义事件**：`ItemStorage.events` 可订阅存入/取走/移除事件（复用 `@yinxe/toolkit` 的 `EventSignal`）。
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
// 纵向固定 64 层（0..63），baseY 默认 120；不够再注册新集群
const region = ItemStorage.register({
  dimension: "minecraft:the_end",
  anchor: { x: 0, y: 120, z: -1024 },
});

installNdsCommands(); // 可选：注册 nds:regions / nds:stats 管理命令（幂等；多模组重复调用也安全）

// 存入 → 拿到取物凭据 { regionId, slotId }（满/失败返回 null）
const ref = region.put(item); // item: ItemStack
if (ref) {
  const stored = ItemStorage.get(ref); // 取物（O(1)，只读不回收）
  const took = ItemStorage.take(ref); // 取走（读出 + 清空槽位 + 回收空洞）
}

// 也可直接对区域操作（已知 slotId 时）
const ok = region.remove(slotId); // 仅清空

// 原子传输：源容器槽 → 区域（要么成功要么保持原状）
const tr = region.transferIn(container, sourceSlot);
// 原子取出：区域槽 → 目标容器槽
const tx = region.transferOut(slotId, container, destSlot);

// 订阅存储事件（复用 toolkit EventSignal；事件负载只用可序列化 string/number）
ItemStorage.events.stored.subscribe(({ regionId, slotId, itemTypeId }) => {});
// 事件总线一览（全部可订阅）：
//   stored / taken / removed      —— 存入 / 取走 / 移除
//   barrelCreated                 —— put 物化新木桶（扩容可见）
//   barrelRestored                —— 巡检重建损坏木桶（阵列坐标内任何非木桶方块一律覆盖重建）
//   itemLost { kind }             —— 巡检确认丢失（barrel-destroyed=桶损坏 / taken-externally=外部取走）

// 统计
const stats = region.stats();
// => { regionId, dimensionId, chunkX, chunkZ, baseY, maxLevels, capacity, barrels, totalBarrels, used, nextFree, freePoolSize }
```

## API 一览

### `ItemStorage`

| 成员                                      | 说明                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `register({ dimension, anchor, baseY? })` | 注册/获取一个存储区域（幂等；同区块 → 共享）              |
| `registerTest({ ... , slotPerBarrel?, maxLevels? })` | ⚠️ 仅测试/演示：额外接受每桶可分配槽数 1..27、层数 1..64（解码恒按 27 槽/桶，ID 不漂移；同区块布局参数不一致抛错拒绝，请换锚点） |
| `listRegions()`                           | 本模组上下文已注册的区域列表                              |
| `getRegion(regionId)`                     | 按区域 ID 取/采纳区域（跨模组凭据取物）                   |
| `queryWorld()`                            | 只读世界上的**全部**区域统计（无需本上下文注册）          |
| `totalStats()`                            | 全库汇总 `{ regionCount, totalCapacity, totalUsed }`      |
| `get(ref)` / `take(ref)`                  | 凭 `{ regionId, slotId }` 取物 / 取走（O(1)，跨模组可用） |
| `events`                                  | 存储事件总线（stored / taken / removed，可订阅）          |

### `StoredRegion`

| 成员                                       | 说明                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| `put(item)`                                | 存入物品 → `{ regionId, slotId } \| null`（O(1) 分配） |
| `get(slotId)`                              | 按 ID 取物（O(1)，不回收）                             |
| `take(slotId)`                             | 取走（读出 + 清空 + 回收）                             |
| `remove(slotId)`                           | 清空 + 回收                                            |
| `transferIn(container, sourceSlot)`        | 原子存入（源容器槽 → 区域）                            |
| `transferOut(slotId, container, destSlot)` | 原子取出（区域槽 → 目标槽）                            |
| `stats()`                                  | 区域统计快照                                           |

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

- 一个区域 = 一个区块（16×16）的水平面 + 纵向 64 层桶 → 每层 256 桶 × 27 槽。
- 单区域容量 = `64 × 256 × 27` = 442368 槽（不够再注册新集群）。
- 取物只凭 ID 解码坐标，**无需查表/扫描**，即 O(1)。

### 动态扩容

阵列**不初始化时全量生成**。`put` 分配到一个槽位时才物化该桶（`setBlockType` 幂等，已存在即跳过），按使用逐桶/逐层增长；`nextFree` 水印触及容量上限后拒绝存入。空洞（`take`/`remove` 释放的槽位）**按层存回该层的空洞池**，下次 `put` 优先复用，不浪费容量。

### 桶的创建与感知

- **创建时机**：`put` 分配的槽位所在桶在世界上不存在（不是木桶）时才 `setBlockType` 物化——只在"首次触达某桶的第一个槽位"时发生；空洞复用不建新桶。
- **创建顺序**：槽位 ID 递增 → 桶序号 0..16383 递增（层内 X→Z 行扫描，层 0 填满 256 桶才到层 1），新桶总在"当前最高触达槽位的那个桶"。
- **感知数量**：`stats()` 报告 `barrels`（已物化桶数，`meta.barrelCount` 精确跟踪）、`totalBarrels`（满容量桶数 = 层数×256，静态）、`capacity`（总槽数 = 层数×256×27，静态）。

### 扩容机制与并发安全

- **分配优先级**：只要有任何可用空位（各层空洞池非空）→ **先复用空位**（O(1) 取最低洞层）；**无任何空位才推进水印扩容**，扩容触达新桶的第一个槽位时才物化新桶。
- **区域真满**：无空洞且水印触顶（`nextFree ≥ capacity`）→ `put` 拒绝返回 null，**绝不建桶**。
- **并发扩容**：即使两个模组读到同一份陈旧元数据、都分配到同一槽位，写前有**世界真值检查**（`isSlotOccupied`）——后写入者发现目标槽已被占用 → 丢弃候选、改选下一槽位（有界重试），**绝不覆盖前者已写入的数据**；同一位置只有一个赢家。
- **布局共享**：区域 ID 由"维度枚举+区块"决定（不含高度），同区块任意 `baseY` 注册都归同一区域；首个注册者写下的 `baseY` 被后续模组采纳，后传的高度被忽略（不分裂、不覆盖）。

### 空洞存储：每层一个 DP 键（规避单值上限）

空洞数据**按层分键**持久化（`nds:item:{区域ID}:pool:{层}`），且存的是 **level-local 索引（0..6911）**，而不是全局 slotId：

- **单值有界**：一层最多 6912 槽 → 单键最坏 ≈ 24KB，稳在 DynamicProperty 单值上限（~32k）内；
- **层数再多也安全**：默认 64 层（容量 442368 槽、slotId 可达 6 位数），落盘的数字也始终 ≤ 4 位——全局 slotId = `level × 6912 + local` 用时现算，**存的时候永远不出现大数字**；
- **O(1) 定位**：主记录里维护 `holeLevels`（有洞的层号，升序）+ `holeCount`（洞总数），分配只触碰最低洞层，统计不加载全部层。

### 跨模组共享与数据安全

- **寻址共享**：`regionId = 维度枚举:区块X:区块Z`（如 `2:0:-64`，维度 0=主世界 1=下界 2=末地）。任何模组注册到同一 ID → 共享同一物理阵列。
- **共享单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）内的任意锚点共享同一阵列，跨区块各自独立。归块逻辑在 core 并有四象限/边界单测。
- **布局共享**：首个注册者把 `layout + 维度` 写进 DP 主记录，后续模组直接采纳，不覆盖不改变。
- **以世界为真值**：分配元数据（水印 + 按层空洞池）是软状态，经 DP 读改写（RMW）持久化；`put` 写入前会**检查目标槽是否已被占用**——被外部占用则不覆盖、丢弃该候选、改选下一候选（有界重试 64 次）。元数据即使丢失，也会从世界真值自愈。

### 常加载

注册时通过 `tickingarea add` 把阵列所在区块加入常加载区块管理，保证区块卸载时容器仍可读写。
⚠️ 注意：

- `tickingarea` 为 **OP 命令**，世界需开启作弊（Script API 开发/测试环境默认开启）；未开启时注册静默失败，读写可能受区块加载影响（`put`/`get` 返回 `null`/`undefined` 而非崩溃）。
- MCBE 对 ticking area 数量有上限（约每维度 10 个），建议**把各模组存储集中在末地**，避免区域数量过多。

## 持久化键约定（DynamicProperty）

| 键                            | 内容                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `nds:regions`                 | 全局区域索引（`string[]`，供其他模组只读盘点）                                        |
| `nds:item:{区域ID}`           | 区域主记录：`{ v, dimensionId, layout, meta }`（meta = 水印 + 洞层索引 + 洞数，很小） |
| `nds:item:{区域ID}:pool:{层}` | 该层空洞池（JSON level-local 索引数组，单值 ≤ 一层 6912 槽）                          |

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
