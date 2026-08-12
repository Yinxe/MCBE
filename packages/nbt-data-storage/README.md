# @yinxe/nbt-data-storage — MCBE 存储基石

MCBE 原版无法直接持久化物品的 NBT 数据（掉落物/背包等在部分场景丢 NBT）。本库提供一个**区块锚定的全木桶阵列**作为物品的持久化载体：木桶实物落进世界里，**每个格子持有一个 ItemStack（完整 NBT）**，任何模组都能按"唯一格子 ID"以 **O(1)** 秒定位并取出。

这不是一个完整的模组，而是**模组工具库 / 存储的基石**：消费模组在自己的 `main.ts` 里调用 `ItemStorage.register(...)` 注册一块存储区域，随后 `put / get / take / remove` 即用即存。

> 想进游戏亲手验证能力？仓库自带演示 addon `demo/`（包名 `nds-demo`，显示名"NBT存储测试"）：完整配置 UI + 命令/UI 双通道存取，`pnpm run pack:nds-demo` 打包进游戏即可冒烟（见 `demo/README.md`）。

> **三种存储模式（路线图）**：物品保存（本库，已实现）/ 生物保存 / 结构保存。后两者将把实体/结构序列化成带 NBT 的自定义记录物品，存进**同一套桶阵列**，共用本库的 O(1) 寻址与动态扩容设施。

## 特性

- **完整 NBT**：物品以 `ItemStack` 存入木桶容器格子，自定义 NBT / 附魔 / 组件全部保留。
- **O(1) 寻址**：格子 ID 采用稠密编号，`slotIdToPosition` 纯整数算术解码 → 木桶坐标 + 格内索引，无查表、无扫描。
- **凭据取物**：`put` 成功返回 `{ regionId, slotId }`，凭这个二元组 `ItemStorage.get/take(ref)` O(1) 秒定位（跨模组可用）。
- **动态扩容**：阵列**不预生成**，按使用逐桶物化；纵向固定 64 层（0..63，无需配置），堆满上限后 `put` 拒绝存入返回 `null`。
- **原子传输**：`transferIn/transferOut` 提供与原版容器一致的**安全传输**——要么整体成功，要么保持原状，物品不丢不重复。
- **自定义事件**：`ItemStorage.events` 可订阅存入/取走/移除事件（复用 `@yinxe/toolkit` 的 `EventSignal`）。
- **跨模组共享**：多个模组注册到**同一维度同一区块** → 共享同一阵列（以世界真值为准，绝不覆盖他人物品）。
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
  const stored = ItemStorage.read(ref); // 只读取物（O(1)，不回收槽位、不影响存储）
  const took = ItemStorage.take(ref); // 取走（读出 + 清空格子）
}

// 也可直接对区域操作（已知 slotId 时）
const ok = region.remove(slotId); // 仅清空
const item = region.read(slotId); // 只读取物（与 take 的区别：不取走不回收）
const r = region.write(slotId, item); // 指定槽覆写（旧物读出返回，不丢）
const items = region.readBatch([0, 1, 2]); // 批量只读（同桶一次容器读取，输出与输入对齐）

// 原子传输：源容器格 → 区域（要么成功要么保持原状）
const tr = region.transferIn(container, sourceSlot);
// 原子取出：区域格 → 目标容器格
const tx = region.transferOut(slotId, container, destSlot);
// 安全交换（引擎级原子）：区域格 ↔ 外部容器格对调，双方都保留
const sw = region.swap(slotId, container, destSlot); // => { ok, oldTypeId?, newTypeId?, error? }

// 订阅存储事件（复用 toolkit EventSignal；事件负载只用可序列化 string/number）
ItemStorage.events.stored.subscribe(({ regionId, slotId, itemTypeId }) => {});
// 事件总线一览（全部可订阅）：
//   stored / taken / removed      —— 存入 / 取走 / 移除
//   barrelCreated                 —— put 物化新木桶（扩容可见）
//   barrelRestored                —— 盘点时重建损坏木桶（阵列坐标内任何非木桶方块一律覆盖重建）
//   itemLost { level, barrelInLevel, count, kind }  —— 盘点确认丢失（桶级：桶损坏 / 外部取走）

// 统计
const stats = region.stats();
// => { regionId, dimensionId, chunkX, chunkZ, baseY, maxLevels, capacity, barrels, totalBarrels, used, freeSlots }
```

## API 一览

### `ItemStorage`

| 成员                                      | 说明                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| `register({ dimension, anchor, baseY? })` | 注册/获取一个存储区域（幂等；同区块 → 共享）              |
| `registerTest({ ... , slotPerBarrel?, maxLevels? })` | ⚠️ 仅测试/演示：额外接受每桶可用格数 1..27、层数 1..64（解码恒按 27 格/桶，ID 不漂移；同区块布局参数不一致抛错拒绝，请换锚点） |
| `listRegions()`                           | 本模组上下文已注册的区域列表                              |
| `getRegion(regionId)`                     | 按区域 ID 取/采纳区域（跨模组凭据取物）                   |
| `queryWorld()`                            | 只读世界上的**全部**区域统计（无需本上下文注册）          |
| `totalStats()`                            | 全库汇总 `{ regionCount, totalCapacity, totalUsed }`      |
| `read(ref)` / `take(ref)`                 | 凭 `{ regionId, slotId }` 只读取物 / 取走（O(1)，跨模组可用） |
| `events`                                  | 存储事件总线（stored / taken / removed，可订阅）          |
### `StoredRegion`

| 成员                                       | 说明                                                   |
| ------------------------------------------ | ------------------------------------------------------ |
| `put(item)`                                | 存入物品 → `{ regionId, slotId } \| null`（O(1) 分配） |
| `read(slotId)`                             | 只读取物（O(1)，不回收槽位、不影响存储阵列）           |
| `readBatch(slotIds)`                       | 批量只读（同桶一次容器读取，输出与输入顺序对齐）       |
| `take(slotId)`                             | 取走（读出 + 清空）                                    |
| `remove(slotId)`                           | 清空                                                   |
| `write(slotId, item)`                      | 指定槽覆写（read 的写对；旧物读出返回调用方处置；空槽也允许，实时数据保存用） |
| `probe(slotId)`                            | 槽位只读状态探测（occupied/empty/damaged/unknown）     |
| `listOccupied()`                           | 枚举区域内全部已占用槽（巡检/迁移/调试）               |
| `swap(slotId, container, destSlot)`        | 安全交换（区域格 ↔ 外部容器格，引擎级原子，双方都保留；触发 taken+stored 事件） |
| `transferIn(container, sourceSlot)`        | 原子存入（源容器格 → 区域，防丢物：失败回滚/重存/dropped 兜底） |
| `transferOut(slotId, container, destSlot)` | 原子取出（区域格 → 目标格，防丢物：失败重存/dropped 兜底） |
| `stats()`                                  | 区域统计快照（barrels 为真值：各层账本长度之和）       |
| `checkAndRepair(onDone?)`                  | 盘点 + 修复（**分批**：每 tick 盘一层，完成回调报告；进行中返回 false） |

## 存储设计（用"仓库"来理解）

把存储区域想成一座**木桶仓库**：一个区块（16×16）的地面摆满一层木桶（256 个），向上堆 64 层。每个木桶 27 格，每格放一件物品（完整 NBT）。

- **格子编号（slotId）**：整座仓库所有格子按顺序编号（0 起）。凭编号用纯算术就能算出"第几层、哪个木桶、桶里第几格"，所以取物是 O(1) 的，不需要查表。
- **仓库有多大**：一层 256 桶 × 27 格 = 6912 格，64 层 = 442368 格。不够就再注册一座新仓库（新区块）。

### 格子 ID → 物理位置（纯算术 O(1)）

```
格内索引   = slotId % 27
桶序号     = floor(slotId / 27) % 256     // 该层内第几个木桶 0..255
层号       = floor(slotId / (27*256))     // 第几层
x = chunkX*16 + (桶序号 % 16)
z = chunkZ*16 + floor(桶序号 / 16)
y = baseY + 层号
```

### 存入：找个"没装满的木桶"，放进第一个空格子

库为每层维护一张**"每桶已用格数"小账本**（每层一条 DP，256 个数字，每个数字 0..27）。存入流程：

1. **翻账本**：从桶 0 开始找第一个"已用格数 < 每桶可放上限"的木桶（账本只是快速筛选）；
2. **看实物**：打开那个桶，一格一格看，找第一个**真正的空格子**（以世界实物为准——就算账本记错了，也绝不会把物品盖到已有物品上）；
3. **放进去**：写入物品，账本上该桶已用格数 +1。

取走（take）时清空格子，账本该桶已用格数 -1。**空格子不需要登记**——下次存入时现场看一眼就知道哪里有位置。账本和实物偶尔对不上也没关系：实物永远优先（绝不覆盖），账本在盘点（巡检）时自动对平。

> 这样做的好处：账本体量从旧版的"每层最多 6912 个空格子编号"降到"每层 256 个数字"（约 640 字节），彻底摆脱了 Minecraft 动态属性单条 32KB 上限的困扰。

### 桶的创建与感知

- **创建时机**：只在"首次往一个还没物化的桶位置放东西"时才在世界里 `setBlockType` 建桶（幂等，已存在即跳过）——按使用逐桶生长，不预生成。
- **创建顺序**：格子编号递增 → 桶序号递增（层内 X→Z 行扫描，层 0 填满 256 桶才到层 1），新桶总在仓库"当前的末尾"。
- **感知数量**：`stats()` 报告 `barrels`（已建桶数）、`totalBarrels`（满容量桶数 = 层数×256，静态）、`capacity`（总格数 = 层数×256×27，静态）、`used`（已用格数，来自账本）、`freeSlots`（剩余格数）。

### 并发安全

即使两个模组同时读到同一份旧账本、都想往同一个格子放东西：写入前都会**检查实物**——后到的人发现格子里已经有东西 → 放弃这个格子、改选下一格（有界重试），**绝不覆盖**先到者已写入的数据。同一格只有一个赢家。

### 盘点（巡检 + 修复，`checkAndRepair`）

**盘点**就是把仓库对一遍账：数每个已建木桶实际有几格有东西，和账本比对：

- 桶被挖掉/变成别的方块 → **重建木桶**（桶里的东西随方块损坏无法找回，如实报告；重建事件 `barrelRestored`）；
- 桶还在但格子里东西少了（外部取走）→ 按桶报告"丢失 N 件"（`itemLost` 桶级事件 `{level, barrelInLevel, count, kind}`），账本对平；
- 账本比实物多记了（计数失真）→ 静默对平，不误报；
- 区块没加载 → 跳过，下次再盘。

**分批执行**：盘点**每 tick 盘一层**（`system.runInterval` 调度，满阵列 64 层约 3 秒完成）——不把全部扫描堆在一个 tick 卡死游戏；完成时回调报告（demo 会提示"开始盘点…完成后自动汇报"）。盘点中重复触发会被忽略。这是显式操作（命令/UI 触发），不是热路径。

### 性能设计（看实物是必要的，但少查方块）

"以实物为真值"意味着每次存入都要看实物——优化空间在于**少查方块、复用容器句柄**：

- **桶内找空格子**：一次取容器（1 次方块查询）后循环查格，替代逐格重新查方块（每件存入从约"桶已用格数+1 次方块查询"降到 1 次）；
- **新桶不探测**：刚物化的桶必空（同 tick 内外部无法插入），直接写格 0，跳过探测（也规避了"物化后容器未就绪 → 误判被塞满 → 桶数虚增"的坑）；
- **盘点分批**：见上（每 tick 一层 + 每桶一次取容器）；
- **统计轻量**：`barrelCount` 用各层账本长度之和（真值，不受物化计数漂移影响）；扩容见证等高频场景用真值而非全量遍历。

### 跨模组共享与数据安全

- **寻址共享**：`regionId = 维度枚举:区块X:区块Z`（如 `2:0:-64`，维度 0=主世界 1=下界 2=末地）。任何模组注册到同一 ID → 共享同一座仓库。
- **共享单元是区块**：锚点经 `chunkFromAnchor`（`Math.floor(x/16)`，负数精确归块）定到 16×16 区块；同维度**同区块**（16 块一格）内的任意锚点共享同一阵列，跨区块各自独立。
- **布局共享**：首个注册者把 `layout + 维度` 写进 DP 主记录，后续模组直接采纳，不覆盖不改变。
- **以世界为真值**：账本（已用格数）是软状态，丢了也能从实物自愈；`put` 永远先看实物再写，绝不覆盖他人物品。

### 世界高度按维度（baseY 与层数的上限）

**只有主世界能到 320**——各维度 y 轴合法范围不同（`worldHeightRangeOf`，注册与调整布局时按维度校验）：

| 维度 | 最低 Y | 最高 Y |
| ---- | ------ | ------ |
| 主世界 `minecraft:overworld` | -64 | 320 |
| 下界 `minecraft:nether` | 0 | 128 |
| 末地 `minecraft:the_end` | 0 | 256 |

`baseY + 层数 - 1` 不得超过所选维度的最高 Y（如末地 64 层阵列的 baseY 最高 193）；未知维度（自定义）不做高度限制。

### 常加载

注册时通过 `world.tickingAreaManager`（模组独立额度，不占命令预算）把阵列所在区块加入常加载，保证区块卸载时容器仍可读写。

⚠️ 注意：

- 未开启作弊/额度不足时挂载失败会告警，读写可能受区块加载影响（`put`/`get` 返回 `null`/`undefined` 而非崩溃）。
- 建议**把各模组存储集中在末地**，区域数量可控。

## 持久化键约定（DynamicProperty）

| 键                              | 内容                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `nds:regions`                   | 全局区域索引（`string[]`，供其他模组只读盘点）                                       |
| `nds:item:{区域ID}`             | 区域主记录：`{ v:2, dimensionId, layout, meta }`（meta v3 = 仅"已建桶数"，很小）     |
| `nds:item:{区域ID}:usage:{层}`  | 该层"每桶已用格数"账本（JSON 数字数组，每桶 0..27；满层 ≈ 640B）                     |

旧版 v2 的 `...:pool:{层}`（空格子编号表）键残留无害（软状态，不再读写）；v2 主记录兼容读取（自动迁移）。

## 测试

```bash
pnpm --filter nbt-data-storage run test   # 或根目录 pnpm run test:nbt-data-storage
```

- `core/` **零 `@minecraft` 依赖**，由 `tsconfig.test.json` 单独编译进 node 测试；`tests/*.test.ts` 用 `node:test` + `node:assert/strict`。
- mc 适配层（方块/容器 IO、ticking area）靠游戏内冒烟验证（同 item-route 约定）。

## 路线图：三种存储模式

| 模式                            | 状态      | 思路                                                           |
| ------------------------------- | --------- | -------------------------------------------------------------- |
| **物品保存** `ItemStorage`      | ✅ 已实现 | ItemStack 直接存木桶格子                                       |
| **生物保存** `EntityStorage`    | 🔜 规划   | 实体 NBT 序列化 → 存为自定义记录物品（`nds:record`）进同一阵列 |
| **结构保存** `StructureStorage` | 🔜 规划   | 结构区域序列化 → 同上                                          |

三种模式共用本库的 O(1) 寻址、动态扩容、跨模组共享与常加载设施，DP 键预留 `nds:entity:` / `nds:structure:` 前缀。
