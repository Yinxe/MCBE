# SmartWarehouse MVP 设计规格

日期：2026-06-30

## 1. 目标

SmartWarehouse 是一个 Minecraft Bedrock Script API 模组，用于把玩家已有生存仓库接入智能分类系统。MVP 目标是先实现安全、可靠、可扩展的核心仓库能力，而不是一次完成全部监控和统计功能。

第一版包含：

- 仓库区域创建、调整、删除、重新扫描。
- 使用常见生存容器作为仓位：箱子、陷阱箱、木桶、潜影盒。
- 木锄作为主交互工具：对空使用打开菜单，点击方块执行目标交互。
- 容器角色管理：未启用、普通仓位、杂物箱、大宗仓位、入口箱。
- 入口箱按仓库级队列自动归纳。
- 只处理加载区块内的仓库和容器。
- 持久化使用 world dynamic properties，不使用计分板。
- 每个仓库独立存储，并在 MVP 阶段采用 meta + containers 分片，避免单个 dynamic property 过大。

第一版明确不做：

- 告示牌监控。
- 全仓库容量图表。
- 自动识别大宗物品。
- 潜影盒内部物品识别。
- 多玩家权限系统。
- 超大区域分 tick 扫描。
- 数据导入导出。
- 仓库统计缓存持久化。

## 2. 总体架构

采用“MVP 稳定版 + 模块化边界”。第一版功能克制，但代码结构要允许后续扩展告示牌、容量统计、大宗规则和维护 UI。

建议目录结构：

```text
scripts/
  main.ts
  types.ts

  storage/
    DynamicPropertyStore.ts
    WarehouseRepository.ts

  warehouse/
    WarehouseService.ts
    ContainerScanner.ts
    ContainerId.ts

  runtime/
    WarehouseRuntimeModel.ts
    WarehouseRuntimeRegistry.ts

  sorting/
    SorterEngine.ts
    ContainerInventory.ts

  interaction/
    SelectionSessionStore.ts
    ToolInteractionController.ts

  ui/
    MainMenu.ts
    WarehouseCreateFlow.ts
    ContainerRoleMenu.ts

  commands/
    CommandRouter.ts
```

模块职责：

- `WarehouseRepository`：读写 dynamic properties，不包含业务逻辑。
- `WarehouseService`：创建、删除、resize、rescan、更新容器角色。
- `ContainerScanner`：扫描区域内容器方块，处理大箱子规范化。
- `WarehouseRuntimeRegistry`：按需建立和缓存内存仓库模型。
- `SorterEngine`：入口箱归纳逻辑。
- `SelectionSessionStore`：保存玩家正在进行的创建/resize 选点流程。
- `ToolInteractionController`：处理木锄对空使用、点击容器、点击非容器。
- `MainMenu / WarehouseCreateFlow / ContainerRoleMenu`：玩家 UI。
- `CommandRouter`：调试和高级命令入口。

## 3. 持久化存储

### 3.1 存储策略

不使用计分板。使用 world dynamic properties，按仓库拆分。

核心 key：

```text
sw:index
sw:warehouse:<warehouseId>:meta
sw:warehouse:<warehouseId>:containers:0
sw:warehouse:<warehouseId>:containers:1
...
```

`sw:index` 保存仓库 ID 列表：

```ts
interface WarehouseIndex {
  version: 1;
  warehouses: string[];
}
```

单个仓库元数据使用 `sw:warehouse:<warehouseId>:meta`：

```ts
interface WarehouseMeta {
  version: 1;
  id: string;
  displayName: string;
  dimensionId: string;
  area: WarehouseArea;
  settings: WarehouseSettings;
  containerShardCount: number;
}
```

容器数据使用 `sw:warehouse:<warehouseId>:containers:<shardIndex>` 分片：

```ts
interface WarehouseContainerShard {
  version: 1;
  warehouseId: string;
  shardIndex: number;
  containers: Record<string, StoredContainer>;
}
```

业务层看到的是组合后的 `WarehouseData`：

```ts
interface WarehouseData extends WarehouseMeta {
  containers: Record<string, StoredContainer>;
}
```

仓库 ID 由仓库名规范化而来。规则：

1. 去除首尾空白。
2. 转小写。
3. 仅允许 `[a-z0-9_-]`。
4. 不自动替换非法字符；包含非法字符时提示玩家重新输入。
5. 长度限制 1-32。
6. 规范化后的 ID 已存在时拒绝创建，不覆盖旧仓库。

显示名保存为 `displayName`。

### 3.2 仓库设置

```ts
interface WarehouseSettings {
  defaultNewContainerRole: ContainerRole;
  autoCreateCategories: boolean;
  enabled: boolean;
  debug: boolean;
}
```

默认值：

- `defaultNewContainerRole = "disabled"`
- `autoCreateCategories = false`
- `enabled = true`
- `debug = false`

### 3.3 容器角色

```ts
type ContainerRole =
  | "disabled"
  | "normal"
  | "misc"
  | "bulk"
  | "input";
```

含义：

- `disabled`：扫描到了，但系统完全不使用。
- `normal`：普通仓位，参与已有同类归纳；开启自动开新分类后可作为新分类箱。
- `misc`：杂物箱，找不到分类时兜底。
- `bulk`：第一版仅标记，暂不参与特殊归纳。
- `input`：入口箱，系统从这里取物品归纳。

### 3.4 容器数据

容器记录使用主坐标和占用坐标，而不是运行时对象引用。

```ts
interface StoredContainer {
  id: string;
  dimensionId: string;
  primaryLocation: BlockLocation;
  occupiedLocations: BlockLocation[];
  role: ContainerRole;
  discoveredAt: number;
  updatedAt: number;
}
```

普通容器 `occupiedLocations` 只有一个坐标。大箱子包含两个坐标。

容器 ID 使用主坐标。维度 ID 自身包含冒号，所以 ID 字段分隔符使用竖线，不使用冒号：

```text
<dimensionId>|<primaryX>|<primaryY>|<primaryZ>
```

示例：

```ts
{
  id: "minecraft:overworld|10|64|10",
  dimensionId: "minecraft:overworld",
  primaryLocation: { x: 10, y: 64, z: 10 },
  occupiedLocations: [
    { x: 10, y: 64, z: 10 },
    { x: 11, y: 64, z: 10 }
  ],
  role: "normal",
  discoveredAt: 1710000000000,
  updatedAt: 1710000000000
}
```

### 3.5 数据版本、分片与存储预算

所有持久化对象带 `version: 1`。以后结构变化时在 Repository 层做迁移。

MVP 阶段就采用分片，而不是把整个仓库存成一个 dynamic property。原因是 Bedrock dynamic property 对单个字符串值和世界总存储都有实际上限，不同版本和平台的表现需要实测。

分片结构：

```text
sw:warehouse:<id>:meta
sw:warehouse:<id>:containers:0
sw:warehouse:<id>:containers:1
```

预算原则：

- 每个容器记录目标控制在约 200-350 字节 JSON。
- 每个分片最多保存 128 个逻辑容器。
- 每个仓库最多 512 个逻辑容器，即最多 4 个容器分片。
- 写入前计算 JSON 字符串长度，超过安全阈值时拒绝保存并提示玩家缩小仓库或降低容器数量。
- 实现阶段必须用目标版本实测 dynamic property 单 key 可写入的最大字符串长度，以及超限时是抛异常还是写入失败。

业务层不能直接依赖 dynamic property key 细节，必须通过 Repository 访问。

## 4. 内存仓库模型

持久化数据是唯一事实来源。运行时按需建立 `WarehouseRuntimeModel`，用于加速分类、归纳和坐标反查。

```ts
interface WarehouseRuntimeModel {
  warehouseId: string;
  containersById: Map<string, RuntimeContainer>;
  occupiedLocationIndex: Map<string, string>;
  inputContainerIds: string[];
  normalContainerIds: string[];
  miscContainerIds: string[];
  bulkContainerIds: string[];
  disabledContainerIds: string[];
  itemTypeIndex: Map<string, string[]>;
  inputCursor: number;
  lastBuiltAt: number;
  dirty: boolean;
}
```

### 4.1 建立时机

不是启动时一次性扫描所有仓库，而是按需建立：

- 仓库创建完成后。
- 玩家第一次打开某仓库容器菜单。
- 第一次处理某仓库入口箱。
- 仓库 resize/rescan 后。
- 容器角色变化后。

调用形式：

```ts
getOrBuildWarehouseModel(warehouseId)
```

### 4.2 刷新时机

以下操作会把模型标记为 `dirty`：

- 容器角色变更。
- 容器放置或破坏。
- 仓库 resize/rescan。
- 仓库设置变更。
- 归纳时发现容器失效。

下一次使用时重建：

```ts
if (model.dirty) rebuildWarehouseModel(warehouseId);
```

### 4.3 itemTypeIndex

`itemTypeIndex` 是运行时优化，不持久化。

它表示某个 `typeId` 优先尝试哪些 normal 容器。它不能作为事实来源，因为玩家可能手动改变箱内物品。

规则：

- 建模时只扫描已加载 normal 容器。
- 归纳时仍然读取真实容器内容确认。
- 候选失效时局部修正：如果容器不可访问，则本轮跳过但保留索引；如果容器可访问且已不包含该 `typeId`，从该 `typeId` 的候选列表移除；如果容器方块已失效，则标记模型 dirty 并更新持久化容器列表。
- 区块未加载的容器不纳入当前索引，但保留持久化记录。

## 5. 交互流程

### 5.1 木锄规则

第一版以木锄作为主交互工具：

- 木锄对空使用：打开 SmartWarehouse 主菜单。
- 木锄点击非容器方块：用于当前创建/resize 流程的选点。
- 木锄点击容器方块：打开容器菜单。

Bedrock Script API 2.x 不提供可靠的“长按时长”检测。MVP 不实现长按判断，统一使用事件分层：

- `world.afterEvents.itemUse`：用于对空使用木锄打开主菜单。
- `world.beforeEvents.itemUseOn`：用于点击方块，包括容器菜单和选点。

事件竞争处理：

- 点击方块时优先处理 `itemUseOn`。
- `itemUseOn` 命中 SmartWarehouse 交互目标时尝试 `cancel = true`，避免原版交互和后续菜单冲突。
- 实现阶段必须验证 `itemUseOn.cancel` 是否能阻止同一次操作触发 `itemUse`；如果不能，需要在 `itemUse` 中加入短时间去重窗口，忽略刚刚发生过的 `itemUseOn`。

### 5.2 临时选点流程

不需要完整的玩家模式管理器。只需要轻量 `SelectionSessionStore` 保存未完成的选点流程。

```ts
type SelectionSession =
  | {
      type: "createWarehouse";
      warehouseName: string;
      defaultNewContainerRole: ContainerRole;
      pointA?: BlockLocation;
    }
  | {
      type: "resizeWarehouse";
      warehouseId: string;
      pointA?: BlockLocation;
    };
```

没有 session 时，木锄点击非容器提示玩家先从菜单选择创建或调整范围。

木锄点击容器始终优先打开容器菜单，不作为选点，避免误操作。选区角点应选在非容器方块上。

### 5.3 创建仓库

流程：

1. 玩家手持木锄对空使用，打开主菜单。
2. 选择“创建仓库”。
3. 输入仓库名。
4. 选择新容器默认角色，默认 `disabled`。
5. 进入选点流程。
6. 点击非容器方块选择第一个点。
7. 点击非容器方块选择第二个点。
8. 系统计算区域 min/max。
9. 扫描区域内容器。
10. 写入仓库数据。
11. 建立或标记运行时模型。
12. 提示创建结果。

### 5.4 容器菜单

玩家木锄点击容器时：

1. 判断玩家是否有仓库管理权限。
2. 判断该容器是否位于某个仓库范围内。
3. 如果不在仓库范围内，提示不属于任何仓库。
4. 如果属于仓库，使用 `occupiedLocations` 反查逻辑容器。
5. 管理员打开容器角色菜单；非管理员只提示所属仓库和当前角色，不允许修改。

菜单项：

- 未启用。
- 普通仓位。
- 杂物箱。
- 大宗仓位。
- 入口箱。

选择后更新仓库数据，并标记运行时模型为 dirty。

### 5.5 指令入口

保留调试和高级命令入口：

```text
/sw:create <name> <x1> <y1> <z1> <x2> <y2> <z2>
/sw:resize <name> <x1> <y1> <z1> <x2> <y2> <z2>
/sw:delete <name>
/sw:rescan <name>
```

如果当前 Bedrock Script API 自定义斜杠命令注册受限，则使用聊天命令兼容：

```text
!sw create main 0 60 0 20 80 20
!sw resize main 0 60 0 30 90 30
!sw delete main
!sw rescan main
```

## 6. 容器扫描与大箱子处理

### 6.1 支持范围

MVP 支持：

- `minecraft:chest`
- `minecraft:trapped_chest`
- `minecraft:barrel`
- 所有颜色的 shulker box

识别方式：

1. 使用方块 typeId 白名单筛选。
2. 尝试读取 block inventory 组件验证。
3. 获取不到 inventory 的不纳入仓库。

### 6.2 大箱子规范化

大箱子占两个方块，但逻辑上是一个容器。

扫描箱子或陷阱箱时：

1. 检查相邻四方向同类型箱子。
2. 如果组成同一个大箱子，选择数值排序更小的坐标作为 `primaryLocation`：先比较 `x`，再比较 `z`，最后比较 `y`。
3. `occupiedLocations` 保存两个坐标。
4. 只登记一个逻辑容器。

运行时建立：

```ts
occupiedLocationIndex: Map<string, containerId>
```

点击任意半边都能反查到同一个逻辑容器。

### 6.3 rescan 合并规则

创建、resize、rescan 时：

- 仍存在的旧容器保留原角色。
- 新发现容器使用 `defaultNewContainerRole`。
- resize 后离开新区域的容器从管理关系中移除。
- 区块未加载导致不可访问时，不删除旧记录。
- 如果旧容器位置可访问且方块已不是容器，则移除。

初次创建仓库时，扫描只能发现当前可访问/已加载区块内的容器。MVP 不主动加载远处区块。玩家创建较大仓库时应站在目标区域附近，确保仓库区块已加载；未加载区块中的容器需要后续 rescan 或放置/破坏事件触发后加入。

### 6.4 放置和破坏自动感知

监听方块放置/破坏事件：

- 放置容器：如果在仓库范围内，自动加入该仓库，角色使用默认新容器角色。
- 破坏容器：如果属于仓库容器记录，从仓库容器列表移除。
- 箱子/陷阱箱变化：对附近 1 格做小范围重新扫描，以处理大箱子合并或拆分。

## 7. 智能归纳算法

### 7.1 调度原则

入口箱处理采用仓库级轮询队列。

规则：

- 只处理 `enabled = true` 的仓库。
- 只处理加载区块中的入口箱。
- 每个调度周期只处理有限数量。
- 每个仓库每轮最多处理一个入口箱。
- 每个入口箱每轮只处理一个非空 slot。
- 区块不可访问时跳过，不删除数据。

建议默认：

```text
每 8 tick 运行一次调度器
每次最多处理 4 个仓库
每个仓库最多处理 1 个入口箱
每个入口箱最多处理 1 个非空 slot
```

这是保守默认值。后续可以暴露为仓库设置或根据服务器负载动态调整。

### 7.2 加载区块判断

不主动加载区块。处理入口箱前尝试获取：

1. dimension。
2. block。
3. inventory component。
4. container。

任何一步失败则跳过该入口箱，不报错刷屏，不删除记录。

### 7.3 单个入口箱流程

1. 获取入口箱 container。
2. 找到第一个非空 slot。
3. 读取该 `ItemStack`。
4. 根据 `typeId` 查找目标容器。
5. 尝试搬运这一 stack。
6. 根据实际搬入数量更新入口箱 slot。
7. 无法搬运时保持入口箱不变并触发冷却提示。

### 7.4 目标选择顺序

对一个物品 stack：

1. 已有同类 `normal` 容器。
   - 容器角色必须是 `normal`。
   - 容器内存在 `typeId` 相同的物品。
   - `typeId` 相同只代表归类相同，不代表一定能堆叠。
2. 自动开新分类。
   - 仅当 `autoCreateCategories = true`。
   - 选择空的 `normal` 容器。
3. `misc` 杂物箱。
4. 失败，入口箱保持剩余物品不变。

`bulk` 第一版只作为角色标记，不参与特殊目标选择。

### 7.5 同类与堆叠

归类依据是 `ItemStack.typeId`：同 ID 即同类。

堆叠依据不能只看 `typeId`。特殊元数据不同的物品不可强行堆叠。插入逻辑必须通过真实容器操作验证。

策略：

1. 先遍历目标容器已有 slot。
2. 对 `typeId` 相同的 slot 尝试合并。
3. 如果元数据不同导致不能堆叠，跳过该 slot。
4. 再遍历空 slot 放入剩余物品。
5. 返回剩余 stack。

原则：

```text
归类依据：typeId
堆叠依据：实际容器插入是否成功
```

## 8. 错误处理与安全限制

### 8.1 第一原则

宁可停止工作，也不能吞物品、复制物品、误动玩家已有箱子。

### 8.2 错误场景

- 仓库数据损坏：不加载该仓库，不删除 dynamic property，提示管理员。
- 仓库重名：拒绝创建，不覆盖旧仓库。
- 区域过大：拒绝创建/resize。
- 区块未加载：跳过，不删除记录。
- 容器失效：位置可访问且已不是容器时，从仓库记录移除。
- 杂物箱未配置或已满：入口箱物品保持原样，冷却提示。
- 没有 normal 仓位：根据 `autoCreateCategories` 决定是否找空 normal；失败后进 misc。

### 8.3 权限

MVP 建议：

- 只有管理员可以创建、resize、删除仓库。
- 只有管理员可以修改容器角色。
- 普通玩家可以使用入口箱。

后续再加入 owner/member 权限系统。

### 8.4 限制

建议第一版限制：

```text
每个仓库最多 512 个逻辑容器
最大扫描体积 65536 个方块
仓库名称长度 1-32
仓库 ID 仅允许英文、数字、下划线、短横线
每个容器分片最多 128 个逻辑容器
```

### 8.5 API 依赖与实现阶段验证

目标依赖版本：当前项目 `package.json` 使用 `@minecraft/server 2.0.0`，manifest 中声明的 Script API 版本需要在实现前同步确认。

实现阶段必须验证：

- world dynamic property 单 key 最大字符串长度、超限行为和注册/声明要求。
- `world.afterEvents.itemUse` 是否适合作为“木锄对空使用”菜单入口。
- `world.beforeEvents.itemUseOn` 是否可稳定获取点击方块，并且 `cancel` 行为是否阻止原版交互/后续 `itemUse`。
- `BlockInventoryComponent` 对箱子、木桶、潜影盒、大箱子的 container 行为。
- 大箱子返回的是单边 inventory 还是合并后的 54 格 inventory。
- `Dimension.getBlock` 或 block/container 访问未加载区块时是抛异常、返回 undefined，还是返回 invalid block。
- `blockPlace` 后立即读取 inventory 是否可用；如果不可用，需要延迟一 tick 处理。
- 潜影盒 typeId 白名单是否覆盖无色和 16 色变种。

### 8.6 提示冷却

避免每 8 tick 刷屏。

冷却 key：

```text
warehouseId + inputContainerId + reason
```

默认冷却：10 秒。

常见 reason：

- 没有杂物箱。
- 杂物箱已满。
- 没有可用 normal 容器。
- 容器记录失效。

## 9. 测试方案

### 9.1 构建检查

至少运行：

```bash
npm run build
npm run lint
```

目标：

- TypeScript 类型通过。
- bundle 成功。
- manifest 版本同步正常。

### 9.2 游戏内测试清单

创建仓库：

1. 木锄对空使用打开菜单。
2. 创建仓库。
3. 输入名称。
4. 选择两个点。
5. 扫描到容器。
6. 默认容器为 disabled。

容器角色：

1. 木锄点击箱子。
2. 改为 normal。
3. 改为 misc。
4. 改为 input。
5. 重开世界后角色仍存在。

归纳：

1. input 放入圆石。
2. normal 箱已有圆石。
3. 系统自动搬入 normal。
4. normal 满后转 misc。
5. misc 满后入口箱保持不变并提示。

安全：

1. disabled 容器不会被放入。
2. 区块卸载时不处理。
3. 删除仓库不删除物品。
4. resize 后离开区域的容器不再被管理。
5. 大箱子任意半边点击都对应同一容器。

大箱子：

1. 扫描大箱子只登记一个逻辑容器。
2. `occupiedLocations` 包含两个坐标。
3. 破坏半边后重新识别。
4. 点击任意半边都打开同一个菜单。

## 10. 实现顺序建议

1. 类型定义和 Repository。
2. Dynamic Properties 读写与仓库索引。
3. 仓库创建、删除、扫描。
4. 木锄菜单和选点流程。
5. 容器角色菜单。
6. 运行时模型懒加载。
7. 大箱子与 `occupiedLocations`。
8. 入口箱轮询调度。
9. 归纳算法。
10. 错误提示与冷却。
11. 构建检查和游戏内测试。
