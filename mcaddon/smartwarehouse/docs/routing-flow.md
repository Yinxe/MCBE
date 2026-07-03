# SmartWarehouse 分拣路由全流程

## 一、整体架构分层

```
┌─────────────────────────────────────────────────────┐
│ SortingScheduler（调度器 · 驱动层）                    │
│ 每个仓库独立 system.runInterval                      │
│ 间隔 = warehouse.settings.processingSpeed（4/8/16/20 tick）
└──────────┬──────────────────────────────────────────┘
           │ 每 tick 调用
           ▼
┌─────────────────────────────────────────────────────┐
│ SorterEngine（分拣引擎 · 路由层）                      │
│ processWarehouse → processInputContainer             │
│ → moveStackIntoWarehouse → 优先级路由                 │
└──────────┬──────────────────────────────────────────┘
           │
    ┌──────┼──────┬──────────┬──────────┐
    ▼      ▼      ▼          ▼          ▼
  大宗  普通(同类型) 家庭(同族)  杂项(兜底)
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

```
[脚本启动]
  │
  ├─ SortingScheduler.startAll()
  │    遍历所有已启用仓库 → 每个注册 system.runInterval()
  │    间隔 = warehouse.settings.processingSpeed
  │
  ▼ 每 N tick
  ┌─────────────────────────────────────────────────────┐
  │ system.runInterval 回调:
  │   1. repository.load(id)          ← DynamicProperty
  │   2. hasPlayerNearby(warehouse)   ← 8 格内有玩家?
  │      无玩家 → 跳过本次
  │   3. engine.processWarehouse(id)
  └─────────────────────────────────────────────────────┘
     │
     ▼
  ┌─────────────────────────────────────────────────────┐
  │ processWarehouse(warehouseId):
  │   1. runtime.getOrBuild(id)
  │      ├─ 缓存命中且未脏 → 直接返回
  │      └─ 未命中/已脏 → 加载 + 构建运行时模型
  │         ├─ 按 role 分桶:
  │         │   inputContainerIds[]
  │         │   normalContainerIds[]
  │         │   miscContainerIds[]
  │         │   bulkContainerIds[]
  │         │   disabledContainerIds[]
  │         ├─ itemTypeIndex    Map<typeId, ContainerId[]>
  │         └─ familyTypeIndex  Map<familyId, ContainerId[]>
  │
  │   2. 检查 model.inputContainerIds.length === 0 → 跳过
  │   3. checkAreaLoaded()  ← 采样 8 角落，缓存 40 tick
  │      任一角落不可达 → 跳过（区块未加载）
  │   4. 轮询选输入容器:
  │      idx = inputCursor % inputContainerIds.length
  │      inputCursor++
  │      processInputContainer(warehouse, model, containerId)
  └─────────────────────────────────────────────────────┘
     │
     ▼
  ┌─────────────────────────────────────────────────────┐
  │ processInputContainer(warehouse, model, containerId):
  │   1. 获取 StoredContainer → getContainerFromStored()
  │       → MC Container 对象
  │   2. 读取 inputSlotCursors[containerId] 槽位索引
  │   3. container.getItem(slot)
  │      ├─ 空 → findNextNonEmptySlot() → 更新游标 → return
  │      └─ 有物品 ↓
  │   4. moveStackIntoWarehouse(stack, ...)
  │      └─ 核心路由决策（详见第三节）
  │   5. 根据返回值处理输入槽:
  │      ├─ undefined          → 全部放完，清空槽位
  │      ├─ 余量 < 原量        → 部分放置，余量写回
  │      └─ 不变               → 无法分类，留在原地
  │   6. 槽位游标 +1（回绕）
  └─────────────────────────────────────────────────────┘
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
    ║ │  │  ├─ 可达且有 typeId  → 有效                  ║
    ║ │  │  ├─ 可达但无 typeId  → 标记脏，清除          ║
    ║ │  │  └─ 不可达          → 保留索引，本次跳过     ║
    ║ │  │  索引全脏 → 全量回退扫描 normal 容器           ║
    ║ │  │  （零回合延迟修复）                            ║
    ║ │  └─ no → 全量扫描所有 normal 容器               ║
    ║ │              → 发现结果写回索引                   ║
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
    ║ 优先级 4：杂项（兜底）                              ║
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

布局 `[Misc][Bulk(配圆石)][Normal][Normal][Input]`：

| 输入物品 | ⭐大宗 | 普通 | 家庭 | 杂项 |
|---------|:-----:|:----:|:----:|:----:|
| 圆石 | ✅ 大宗 | — | — | — |
| 石头 | ✗ bulkTypeId=圆石 | ✗ 无normal有石头 | ✗ 石头无家庭 | ✅ 杂项 |
| 白色羊毛 | ✗ 不匹配 | ✗ 无normal有羊毛 | ✅ 羊毛家庭聚 | — |
| 橙色羊毛 | ✗ 不匹配 | ✅ 看索引 | — | — |

---

## 五、关键机制

### 5.1 索引自愈（itemTypeIndex）

```
索引记录: {"minecraft:cobblestone": ["箱A", "箱B"]}

分拣圆石时:
  箱A: 可达但无圆石 → 标记脏 → 从索引清除
  箱B: 可达且有圆石 → 有效 → 保留
  索引变为: {"minecraft:cobblestone": ["箱B"]}

若索引全脏:
  立即全量回退扫描所有 normal 容器
  → 找到箱C有圆石
  → 写入索引: {"minecraft:cobblestone": ["箱C"]}
  → 零回合延迟修复
```

### 5.2 家庭纯度排序

```
纯度 = 容器中属于该家族的物品类型数 ÷ 容器中所有物品类型数

家族"羊毛"含 {白,橙,品红,...}:
  箱A: {白色羊毛, 橙色羊毛}       → 纯度 1.0（最优先）
  箱B: {白色羊毛, 圆石}           → 纯度 0.5
  箱C: {圆石, 石头}               → 纯度 0.0（最后）
```

### 5.3 大宗箱匹配

| 状态 | 匹配条件 |
|------|---------|
| 空箱 | `stored.bulkTypeId === typeId`（必须玩家主动配置） |
| 非空箱 | `getBulkChestFirstType(target) === typeId`（按箱内首个物品种类） |

大宗箱不走 `itemTypeIndex` 索引，因为数量极少（1~5个），全量扫描成本低于索引维护。

### 5.4 区块加载预检

```
checkAreaLoaded():
  每 40 tick 采样仓库 8 个角落
  ├─ 全部可达 → areaLoaded = true
  └─ 任一不可达 → areaLoaded = false，跳过本次
  缓存 40 tick
```

### 5.5 输入容器轮询

```
多个输入容器: inputCursor 轮询，每次 +1
单个输入容器: inputSlotCursors 记录槽位，每 interval 处理一格
空槽自动跳到下一个非空槽
```

### 5.6 运行时模型缓存

```
WarehouseRuntimeRegistry: Map<WarehouseId, WarehouseRuntimeModel>

脏标记触发（触发下次 getOrBuild 重载）:
├─ setContainerRoleAndState()
├─ setContainerBulkType()
├─ updateSettings()
├─ deleteWarehouse()
├─ scanAndSetContainers()
└─ registerBlockMaintenance()（方块放置/破坏事件）
```

---

## 六、代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| 调度入口 | `scripts/sorting/SortingScheduler.ts` | 70-88 |
| 仓库处理入口 | `scripts/sorting/SorterEngine.ts` | 71-105 |
| 输入容器处理 | `scripts/sorting/SorterEngine.ts` | 191-253 |
| **路由决策核心** | **`scripts/sorting/SorterEngine.ts`** | **277-333** |
| 大宗匹配（优先级1） | `scripts/sorting/SorterEngine.ts` | 286-310 |
| 普通匹配（优先级2） | `scripts/sorting/SorterEngine.ts` | 312-317 |
| 家庭匹配（优先级3） | `scripts/sorting/SorterEngine.ts` | 319-328 |
| 杂项兜底（优先级4） | `scripts/sorting/SorterEngine.ts` | 330-332 |
| 通用容器尝试 | `scripts/sorting/SorterEngine.ts` | 355-413 |
| 大宗容器尝试 | `scripts/sorting/SorterEngine.ts` | 438-489 |
| 索引查找（普通） | `scripts/sorting/SorterEngine.ts` | 532-615 |
| 索引查找（家庭） | `scripts/sorting/SorterEngine.ts` | 629-721 |
| 运行时模型构建 | `scripts/runtime/WarehouseRuntimeModel.ts` | 13-81 |
| 运行时缓存 | `scripts/runtime/WarehouseRuntimeRegistry.ts` | 37-50 |
| 容器 IO 工具 | `scripts/sorting/ContainerInventory.ts` | 全文件 |
| 类型定义 | `scripts/types.ts` | 167-186(StoredContainer) |
