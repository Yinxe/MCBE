# SmartWarehouse 分拣路由全流程

## 一、整体架构分层

```
┌────────────────────────────────────────────────────────┐
│ SortingScheduler（调度器 · 驱动层）                       │
│ ┌─ 生命周期监控（每 20 tick 扫描玩家位置）               │
│ │  玩家接近 → 惰性激活仓库                              │
│ │  玩家离开 + 2秒 → 停用 + 释放内存                    │
│ └─ 每个活跃仓库独立 system.runInterval                  │
│    间隔 = warehouse.settings.processingSpeed            │
└──────────┬─────────────────────────────────────────────┘
           │ processWarehouse(id)
           ▼
┌────────────────────────────────────────────────────────┐
│ SorterEngine（分拣引擎 · 路由层）                         │
│ processWarehouse → runtime.getOrBuild → 构建运行时模型   │
│ → processInputContainer → moveStackIntoWarehouse       │
└──────────┬─────────────────────────────────────────────┘
           │
     ┌─────┼──────┬──────────┬──────────┬──────────┐
     ▼     ▼      ▼          ▼          ▼          ▼
   大宗  普通(同类) 家庭(同族) 自动创建  杂项(兜底)
     │
     ▼
  tryMoveStackIntoContainer()
  tryFillShulkerBoxes()  ← 大宗专用
     │
     ▼
  Minecraft Container.addItem()
```

---

## 二、完整时序流程

### 2.1 脚本启动 → 惰性监控

```
[脚本启动]
  │
  ├─ SortingScheduler.start()
  │    仅启动一个全局监控 tick（每 20 tick = 1 秒）
  │    不创建任何仓库 interval，不加载任何容器数据
  │
  ▼ 每 20 tick
  ┌────────────────────────────────────────────────────────┐
  │ lifecycleTick():
  │   1. 刷新玩家位置缓存（world.getPlayers）               │
  │      ├─ 无玩家 → 停用所有活跃仓库 → return             │
  │      └─ 有玩家 ↓                                      │
  │   2. repository.loadAll()   ← 读取所有仓库元数据       │
  │   3. 遍历每个仓库:                                     │
  │      ├─ 禁用或已删除 → 停用（stop + 释放内存）         │
  │      ├─ 附近有玩家且未激活 → 惰性激活                  │
      │        ├─ load(id) 防御性验证仓库仍存在             │
  │      │        └─ system.runInterval(fn, speed)         │
  │      ├─ 附近有玩家且已激活 → 刷新活跃标记              │
  │      └─ 无玩家且已激活 → 超过 2 秒延迟 → 停用         │
  └────────────────────────────────────────────────────────┘
```

### 2.2 仓库分拣 tick（每个活跃仓库独立）

```
▼ 每 N tick（processingSpeed: 4/8/16/20）
  ┌────────────────────────────────────────────────────────┐
  │ system.runInterval 回调:                               │
  │                                                       │
  │ engine.processWarehouse(warehouseId):                 │
  │   1. runtime.getOrBuild(id)                           │
  │      ├─ 缓存命中且未脏 → 直接返回                     │
  │      └─ 未命中/已脏 → 加载 + 构建运行时模型            │
  │         ├─ 按 role 分桶:                              │
  │         │   inputContainerIds[]                       │
  │         │   normalContainerIds[]                      │
  │         │   miscContainerIds[]                        │
  │         │   bulkContainerIds[]                        │
  │         │   disabledContainerIds[]                    │
  │         ├─ itemTypeIndex    Map<typeId, ContainerId[]>│
  │         └─ familyTypeIndex  Map<familyId, ContainerId[]>│
  │                                                       │
  │   2. 检查 model.inputContainerIds.length === 0 → 跳过  │
  │   3. checkAreaLoaded()  ← 采样8角落，缓存40tick        │
  │      任一角落不可达 → 跳过（区块未加载）                │
  │                                                       │
  │   4. 轮询选输入容器:                                   │
  │      idx = inputCursor % inputContainerIds.length      │
  │      inputCursor++                                     │
  │                                                       │
  │   5. processInputContainer(warehouse, model, containerId)│
  │      ├─ 读 inputSlotCursors[containerId] 槽位索引      │
  │      ├─ container.getItem(slot)                       │
  │      │  ├─ 空 → findNextNonEmptySlot() → 更新游标     │
  │      │  └─ 有物品 → moveStackIntoWarehouse(stack, ...)│
  │      ├─ 根据返回值处理槽位:                             │
  │      │  ├─ undefined    → 全部放完，清空槽位           │
  │      │  ├─ 余量 < 原量  → 部分放置，余量写回           │
  │      │  └─ 不变         → 无法分类，留在原地           │
  │      └─ 槽位游标 +1（回绕）                            │
  └────────────────────────────────────────────────────────┘
```

---

## 三、路由优先级决策树

```
                    ┌──────────────────────┐
                    │  物品堆进入分拣        │
                    │  typeId = stack.typeId│
                    └──────────┬───────────┘
                               │
                               ▼
    ╔═══════════════════════════════════════════════════╗
    ║ 优先级 1：大宗（单物品）                            ║
    ║ ─────────────────                                  ║
    ║ 遍历 model.bulkContainerIds[] 过滤:                  ║
    ║                                                   ║
    ║   if 空箱:                                        ║
    ║     stored.bulkTypeId === typeId  ← 必须玩家配置    ║
    ║   else:                                           ║
    ║     getBulkChestFirstType(target) === typeId       ║
    ║                                                   ║
    ║ tryBulkContainers():                               ║
    ║   第1步: tryFillShulkerBoxes()    ← 填已有潜影盒   ║
    ║   第2步: tryMoveStackIntoContainer() ← 填空槽位    ║
    ║                                                   ║
    ║ 全部放完? ──yes──→ ✅ 结束                         ║
    ╚═══════════════════════════════════════════════════╝
                               │ 未放完
                               ▼
    ╔═══════════════════════════════════════════════════╗
    ║ 优先级 2：普通（多物品）                            ║
    ║ ─────────────────                                  ║
    ║ findExistingTypeContainers():                      ║
    ║                                                   ║
    ║ ├─ itemTypeIndex 有记录?                           ║
    ║ │  ├─ yes → 从索引取候选，逐个校验:                ║
    ║ │  │   ├─ isContainerEmpty → 标记脏，跳过         ║
    ║ │  │   ├─ 可达且有 typeId  → 有效                 ║
    ║ │  │   ├─ 可达但无 typeId  → 标记脏，清除         ║
    ║ │  │   └─ 不可达          → 保留索引，本次跳过    ║
    ║ │  │  索引全脏 → 全量回退扫描 normal 容器          ║
    ║ │  │  （零回合延迟修复）                            ║
    ║ │  └─ no → 全量扫描所有 normal 容器               ║
    ║ │              → isContainerEmpty 短路跳过空箱     ║
    ║ │              → containerHasType 逐槽验证非空箱   ║
    ║ │              → 结果写回索引                       ║
    ║                                                   ║
    ║ tryContainers(tag="match"):                       ║
    ║   对每个有效容器:                                  ║
    ║   ├─ tryMoveStackIntoContainer()                   ║
    ║   ├─ 更新 itemTypeIndex + familyTypeIndex          ║
    ║   └─ 播放分拣动画 + 触发整理检查                    ║
    ║                                                   ║
    ║ 全部放完? ──yes──→ ✅ 结束                         ║
    ╚═══════════════════════════════════════════════════╝
                               │ 未放完
                               ▼
    ╔═══════════════════════════════════════════════════╗
    ║ 优先级 3：家庭同族                                  ║
    ║ ─────────────────                                  ║
    ║ 条件: getFamily(typeId) 存在                       ║
    ║       AND id ∈ enabledFamilies                     ║
    ║                                                   ║
    ║ findExistingFamilyContainers():                    ║
    ║ ├─ familyTypeIndex 验证（同自愈机制）                ║
    ║ ├─ 回退全量扫描 normal 容器                         ║
    ║ └─ 按纯度(0~1)降序排列                              ║
    ║                                                   ║
    ║ tryContainers(tag="family", 纯度排序):              ║
    ║   逻辑同优先级2，日志追加纯度分数                    ║
    ║                                                   ║
    ║ 全部放完? ──yes──→ ✅ 结束                         ║
    ╚═══════════════════════════════════════════════════╝
                               │ 未放完
                               ▼
    ╔═══════════════════════════════════════════════════╗
    ║ 优先级 4：自动创建分类                              ║
    ║ ─────────────────                                  ║
    ║ 条件: warehouse.settings.autoCreateCategories=true  ║
    ║                                                   ║
    ║ findEmptyNormalContainer():                        ║
    ║   遍历 normalContainerIds                          ║
    ║   ├─ isContainerEmpty → 找到第一个空箱             ║
    ║   └─ 全都有物品 → 放弃，fallthrough                ║
    ║                                                   ║
    ║ tryContainers(tag="autocreate", [空箱]):           ║
    ║   放入后 addToTypeIndex → 下次同类走优先级2快速路径  ║
    ║                                                   ║
    ║ 全部放完? ──yes──→ ✅ 结束                         ║
    ╚═══════════════════════════════════════════════════╝
                               │ 未放完
                               ▼
    ╔═══════════════════════════════════════════════════╗
    ║ 优先级 5：杂项（兜底）                              ║
    ║ ─────────────────                                  ║
    ║ 遍历 model.miscContainerIds[]                      ║
    ║ tryContainers(tag="misc")                          ║
    ║                                                   ║
    ║ 无论结果 → return remaining                        ║
    ║ (undefined = 全部消耗)                              ║
    ╚═══════════════════════════════════════════════════╝
```

---

## 四、路由结果示例

布局 `[Misc][Bulk(配圆石)][Normal][Normal][Input]`，`autoCreateCategories=true`：

| 输入物品 | ⭐大宗 | 普通 | 家庭 | 自动创建 | 杂项 |
|---------|:-----:|:----:|:----:|:-------:|:----:|
| 圆石 | ✅ 专收 | — | — | — | — |
| 石头 | ✗ bulkTypeId=圆石 | ✗ 无normal有石头 | ✗ 石头无家庭 | ✅ 空箱B收 | — |
| 白色羊毛 | ✗ 不匹配 | ✗ 不在索引 | ✅ 羊毛聚箱 | — | — |
| 橙色羊毛 | ✗ 不匹配 | ✅ 索引已有羊毛箱 | — | — | — |
| 地狱岩 | ✗ 不匹配 | ✗ 不在索引 | ✗ 无家庭 | ✗ 无空箱 | ✅ 杂项 |

---

## 五、特殊容器

### 5.1 漏斗（特殊输入容器）

漏斗在扫描时自动强制 `role="input"`，不可改为存储角色：

| 路径 | 角色处理 |
|------|---------|
| `ContainerScanner.scan()` | `isHopperType(block.typeId) → "input"` |
| `WarehouseService.addContainerToWarehouse()` | 同上，放置事件也强制 input |
| UI 管理表单 | 隐藏角色下拉，显示"只能作为输入容器" |
| 只读视图 | 角色标注 `"(漏斗·自动)"` |

漏斗有 5 格物品栏，与其他 input 容器一起参与轮询调度。
Minecraft 的漏斗机制会自动吸取上方容器的物品，起到"收集点"的作用。

### 5.2 大宗箱（单物品专用）

| 状态 | 匹配条件 | 说明 |
|------|---------|------|
| 空箱 | `stored.bulkTypeId === typeId` | 玩家必须通过 UI 主动配置，不自动接受 |
| 非空箱 | `getBulkChestFirstType(target) === typeId` | 按箱内第一个物品种类匹配 |

大宗箱插入顺序：
1. `tryFillShulkerBoxes()` — 先填箱内已有的潜影盒（受限于 Minecraft API，当前运行时不可用）
2. `tryMoveStackIntoContainer()` — 再填散装空槽位

大宗箱不走 `itemTypeIndex`，因为数量极少（1~5 个），全量扫描成本低于索引维护。

---

## 六、关键机制

### 6.1 索引自愈（itemTypeIndex）

```
索引记录: {"minecraft:cobblestone": ["箱A", "箱B"]}

分拣圆石时:
  箱A: isContainerEmpty → true → 标记脏 → 从索引清除
  箱B: 可达且有圆石 → 有效 → 保留
  索引变为: {"minecraft:cobblestone": ["箱B"]}

若索引全脏 (valid.length===0):
  立即全量回退扫描所有 normal 容器
  → 找到箱C有圆石
  → 写入索引: {"minecraft:cobblestone": ["箱C"]}
  → 零回合延迟修复（不分批，此 tick 内完成）
```

**索引不被持久化**——重启后重新冷启动。因为 Minecraft 容器内的物品由方块数据管理，
我们的索引只是运行时缓存，持久化快照可能在重启期间过期（玩家移动了物品），
最终还是得重新校验。冷启动每种物品全量扫一次即可进入快速路径。

### 6.2 空箱短路优化

```
validateIndexCandidates / fullScanNormalContainers 中:

  for each candidate:
    container = getContainerFromStored(dimension, stored)
    if (!container) → skip (区块未加载)
    if (isContainerEmpty(container)) → skip  ← O(1) API，不走槽位
    if (containerHasType(container, typeId)) → valid  ← O(n) 遍历 27 槽

收益:
  50 空箱全量扫:  50 × getContainer + 50 × emptySlotsCount = 100 次 API
  改前:          50 × containerHasType(27槽) = 1350 次 getItem()
```

### 6.3 家庭纯度排序

```
纯度 = 容器中属于该家族的物品类型数 ÷ 容器中所有物品类型数

家族"羊毛"含 {白,橙,品红,...}:
  箱A: {白色羊毛, 橙色羊毛}       → 纯度 1.0（最优先）
  箱B: {白色羊毛, 圆石}           → 纯度 0.5
  箱C: {圆石, 石头}               → 纯度 0.0（最后）
```

### 6.4 区块加载预检

```
checkAreaLoaded():
  每 40 tick 采样仓库 8 个角落
  ├─ 全部可达 → areaLoaded = true
  └─ 任一不可达 → areaLoaded = false，跳过本次分拣
  缓存 40 tick
```

### 6.5 输入容器轮询

```
多个输入容器: inputCursor 轮询，每次 +1
选中容器 = inputContainerIds[inputCursor % length]

单个输入容器内部:
  inputSlotCursors[containerId] 记录当前处理的槽位
  每 interval 只处理一格 → 粒度控制
  空槽自动跳到下一个非空槽
```

### 6.6 惰性生命周期（SortingScheduler）

```
┌─ 生命周期状态 ──────────────────────────────────────────┐
│                                                         │
│  停用（Inactive）── 玩家接近 + 验证 ──→ 激活（Active）    │
│    ↑                            │                       │
│    └── 玩家离开 + 40tick(2s) ───┘                       │
│                                                         │
│  停用: 无 interval、无运行时模型（内存回收）              │
│  激活: 创建 interval + 运行时模型（按需 cold-start）      │
│                                                         │
│  监控: 每 20 tick 扫描世界玩家 → 管理生命周期            │
└─────────────────────────────────────────────────────────┘

优点:
  - 无玩家在线 → 所有仓库零 tick 开销
  - 玩家离开 2 秒 → 停用 → 运行时模型释放 → 内存回收
  - 100 仓库同时存在 → 只活跃玩家附近的 N 个
```

### 6.7 运行时模型缓存

```
WarehouseRuntimeRegistry: Map<WarehouseId, WarehouseRuntimeModel>

生命周期停用时释放: runtime.delete(id) → 内存回收

脏标记触发重建（下次 getOrBuild 重载）:
├─ setContainerRoleAndState()
├─ setContainerBulkType()
├─ updateSettings()
├─ deleteWarehouse()
├─ rescanWarehouse()
├─ resizeWarehouse()
├─ addContainerToWarehouse()
├─ removeContainerFromWarehouse()
└─ registerBlockMaintenance()（方块放置/破坏事件）
```

---

## 七、持久化优化

### 7.1 全量写入 vs 仅 meta 写入

| 操作 | 方法 | 写入内容 |
|------|------|---------|
| 创建仓库、全量重扫、调整区域 | `save()` | 所有容器分片 + meta（递增世代号） |
| 改角色、配大宗类型 | `save()` | 同上（容器数据变了） |
| 改设置、改名称 | `saveMetaOnly()` ✨ | **只写 meta，不碰容器分片** |
| 放置/破坏容器 | `patchContainers()` | 覆写当前世代分片，不递增世代号 |

**`saveMetaOnly()`** 针对 `updateSettings`、`renameWarehouse` 等仅修改仓库元数据
（设置、名称）的操作，跳过重写所有容器分片，减少 DynamicProperty I/O。

### 7.2 崩溃安全

```
save() 写入顺序:
  1. 递增世代号 → 写入新分片键（旧数据不受影响）
  2. 写 meta（指向新世代）
  3. 清理旧世代分片键

任何步骤崩溃:
  - 步骤 1 后 → meta 仍指向旧世代 → 读到旧数据（一致）
  - 步骤 2 后 → meta 指向新世代 → 读到新数据（一致）
  - 步骤 3 未完成 → 遗留旧键但不影响正确性（不会被读取）
```

---

## 八、代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| 惰性生命周期监控 | `scripts/sorting/SortingScheduler.ts` | `lifecycleTick()` |
| 仓库激活/停用 | `scripts/sorting/SortingScheduler.ts` | `activate()` / `deactivate()` |
| 仓库处理入口 | `scripts/sorting/SorterEngine.ts` | `processWarehouse()` |
| 输入容器处理 | `scripts/sorting/SorterEngine.ts` | `processInputContainer()` |
| **路由决策核心** | **`scripts/sorting/SorterEngine.ts`** | **`moveStackIntoWarehouse()`** |
| 大宗匹配（优先级1） | `scripts/sorting/SorterEngine.ts` | bulk filter → `tryBulkContainers()` |
| 普通匹配（优先级2） | `scripts/sorting/SorterEngine.ts` | `findExistingTypeContainers()` |
| 家庭匹配（优先级3） | `scripts/sorting/SorterEngine.ts` | `findExistingFamilyContainers()` |
| 自动创建（优先级4） | `scripts/sorting/SorterEngine.ts` | `findEmptyNormalContainer()` |
| 杂项兜底（优先级5） | `scripts/sorting/SorterEngine.ts` | misc → `tryContainers()` |
| 索引自愈 | `scripts/sorting/SorterEngine.ts` | `validateIndexCandidates()` + `cleanStaleIndexEntries()` + `fullScanNormalContainers()` |
| 大宗容器插入 | `scripts/sorting/SorterEngine.ts` | `tryBulkContainers()` |
| 通用容器插入 | `scripts/sorting/SorterEngine.ts` | `tryContainers()` |
| 运行时模型构建 | `scripts/runtime/WarehouseRuntimeModel.ts` | `buildWarehouseRuntimeModel()` |
| 运行时缓存 | `scripts/runtime/WarehouseRuntimeRegistry.ts` | `getOrBuild()` / `delete()` |
| 容器 IO 工具 | `scripts/sorting/ContainerInventory.ts` | 全文件 |
| 容器类型识别 | `scripts/warehouse/ContainerTypes.ts` | `isSupportedContainerType()` / `isHopperType()` |
| 容器扫描 | `scripts/warehouse/ContainerScanner.ts` | `scan()` / 漏斗强制 input |
| 仓储层 | `scripts/storage/WarehouseRepository.ts` | `save()` / `saveMetaOnly()` / `patchContainers()` |
| 类型定义 | `scripts/types.ts` | `StoredContainer`、`ContainerRole`、`WarehouseRuntimeModel` |
