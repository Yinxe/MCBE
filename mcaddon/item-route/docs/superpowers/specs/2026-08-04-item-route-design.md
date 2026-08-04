# item-route 设计文档（v2.0 全新架构）

> 日期：2026-08-04
> 状态：已确认（brainstorming 完成，等待用户审阅后进入 writing-plans）
> 基线：`smartwarehouse-v1-analysis.md`（cffae82）
> 前置：`EventSignal` 事件机制（packages/toolkit，90af586）

## 1. 背景与目标

基于 smartwarehouse v1 全面重写为全新项目 **item-route**。核心目标：

1. **核心引擎零 MC API**：`core/` 目录为纯 TypeScript，不 import 任何 `@minecraft/*`。所有外部世界操作通过接口 + 实现类注入，使核心逻辑可在 node 下直接单测，零 mock 成本。
2. **O(1) 路由**：每次调度只处理一个输入容器的非空 slot；路由经索引 Map 查询（O(1)）定位候选容器，不做全仓扫描。
3. **路由安全**：路由过程绝不修改/吞物/复制物品，唯一允许的变化是堆叠和移动。
4. **越用越快**：索引持久化 + 事件驱动增量维护，崩溃可恢复，缺失条目惰性补算。
5. **可插拔策略**：路由规则与候选排序均为独立抽象，数字优先级，可扩展。
6. **全部功能保留**：仓库管理全套、预警与统计、整理系统、搜索、配置与引导，代码可借鉴 v1 但全新更优设计。家族分类作为后期扩展再设计，本期不含。

## 2. 架构总览（方案 A：分层六边形）

```
mcaddon/item-route/
├── core/                        # 纯 TS，零 MC API（可单测）
│   ├── model/       ItemId/ItemStack/Container/Warehouse/Member
│   ├── routing/     RouteStrategy/CandidateSorter/Router
│   ├── index/       ItemIndex + 增量维护 + 持久化快照
│   ├── scheduling/  Scheduler(5tick)/WarehouseLifecycle/Interval
│   ├── organizing/  Organizer（混乱度/analyze/apply/回滚）
│   ├── stats/       ContainerStats/WarehouseStats/三级预警
│   ├── storage/     KeyValueStore/WarehouseStore/IndexStore/StatsStore
│   ├── events/      EventSignal 领域事件总线
│   └── services/    Warehouse/Route/Organize/Stats/Member
├── mc/                         # 适配层（薄）
│   ├── adapters/    McContainerAdapter/McItemAdapter/McEventBridge
│   ├── storage/     DP 分片实现（30KB 安全线 + hash + 世代号）
│   ├── ui/          ActionForm/ModalForm 12 模块
│   ├── commands/    9 命令
│   ├── interaction/ 信物交互
│   └── main.ts      启动装配（DI：core ← mc 实现）
├── __tests__/       core 单测（node 直跑，零依赖）
├── scripts/         TypeScript 源码入口
├── BP/<Project>/    行为包（manifest.json）
├── RP/<Project>/    资源包（可选）
├── just.config.ts   构建配置
└── package.json     独立版本号
```

**依赖方向**：`core` 不依赖 `mc`；`mc` 依赖 `core` 与 `@minecraft/server`。`core` 内各模块仅依赖 `model/` 与 `events/`。

## 3. 概念模型（core/model/）

### 3.1 物品

```ts
// ItemId：字符串类型别名（如 "minecraft:stone"）
type ItemId = string;

// ItemStack：概念级物品堆（不感知 MC）
interface ItemStack {
  readonly itemId: ItemId;
  amount: number;
  readonly maxStackSize: number;
  isStackableWith(other: ItemStack): boolean;  // 可堆叠性（默认同 itemId）
  equals(other: ItemStack): boolean;           // 深度相等（含元数据）
  clone(): ItemStack;
}
```

### 3.2 容器

```ts
// 容器角色
type ContainerRole = "input" | "single" | "multi" | "misc";

interface Container {
  readonly id: ContainerId;
  role: ContainerRole;              // 可变更（角色可改）
  enabled: boolean;                 // 单容器开关
  readonly capacity: number;        // 总槽位数（动态读取，不写死）
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
  addItem(stack: ItemStack): ItemStack | undefined;  // 返回剩余（未放入部分）
  // 单物绑定：由"首个非空 slot 物品"推导，可被玩家拿走/替换破坏
  getDedicatedItemId(): ItemId | undefined;
}
```

**容器类型支持**：箱子 / 木桶 / 潜影盒。**漏斗**只能作为输入容器（`input`），且默认禁用，需要玩家显式启用。

### 3.3 仓库与成员

```ts
type MemberRole = "owner" | "member" | "visitor";

interface Member {
  playerId: PlayerId;
  role: MemberRole;
}

interface Warehouse {
  readonly id: WarehouseId;
  displayName: string;
  ownerId: PlayerId;
  members: Member[];               // 完整成员系统
  area: WarehouseArea;             // 区域（两角坐标 + 维度）
  settings: WarehouseSettings;     // 分拣开关/速度/预警/全局项
  containers: Map<ContainerId, Container>;
}
```

**权限矩阵**：

| 操作 | owner | member | visitor |
|------|:-----:|:------:|:-------:|
| 创建/删除/重命名仓库 | ✓ | - | - |
| 成员管理 | ✓ | - | - |
| 容器注册/角色变更 | ✓ | ✓ | - |
| 分拣开关/速度 | ✓ | ✓ | - |
| 整理执行 | ✓ | ✓ | - |
| 统计/只读查看 | ✓ | ✓ | ✓ |

## 4. 路由引擎（core/routing/）

**核心原则：路由只移动/堆叠，绝不修改/吞物/复制物品。**

```ts
// 路由策略：可插拔，数字优先级越小越快
interface RouteStrategy {
  readonly priority: number;
  findCandidates(ctx: RouteContext): CandidateContainer[];
}

// 候选容器（含排序所需信息）
interface CandidateContainer {
  container: Container;
  priority: number;      // 容器优先级，默认 10，越小越先
  usageRatio: number;    // usedSlots / totalSlots
  isFull: boolean;
}

// 候选排序器：可插拔
interface CandidateSorter {
  sort(candidates: CandidateContainer[]): CandidateContainer[];
}

interface RouteContext {
  item: ItemStack;
  warehouse: Warehouse;
  index: ItemIndex;
}
```

**内置策略（按 priority 升序执行）：**
1. `SingleItemStrategy`（单物）：候选 = 索引中该 typeId 的单物容器（且 dedicatedItemId 匹配）
2. `MultiItemStrategy`（多物）：候选 = 索引中该 typeId 的多物容器
3. `MiscStrategy`（杂项）：兜底，候选 = 杂项容器

**默认 CandidateSorter：** 满箱跳过 → priority 升序 → usageRatio 降序（越满越先）。

**O(1) 路由流程（每输入 slot）：**
1. 从输入容器取一个非空 slot 的 ItemStack
2. `itemIndex.lookup(typeId)` → O(1) Map 查询得到候选容器列表
3. 按策略 priority 升序执行各策略；策略内用 CandidateSorter 排序
4. 尝试 `target.addItem(stack)`（只堆叠/移动），成功则更新索引 + 统计 + 发事件
5. 全部失败 → 物品留在输入容器，触发容量预警事件

## 5. 索引系统（core/index/）

**目标：O(1) 查询 + 持久化 + 事件驱动增量维护 + 越用越快。**

```ts
interface ItemIndex {
  lookup(typeId: ItemId): CandidateContainer[];   // O(1) Map 查询
  onContainerChanged(containerId: ContainerId): void;
  onContainerRoleChanged(containerId: ContainerId, role: ContainerRole): void;
  onContainerRemoved(containerId: ContainerId): void;
  onItemMoved(from: ContainerId, to: ContainerId, itemId: ItemId): void;
  serialize(): IndexSnapshot;
  restore(snapshot: IndexSnapshot): void;
}

interface IndexSnapshot {
  version: number;
  // typeId → 各角色容器 ID 列表
  byItem: Record<ItemId, { single: ContainerId[]; multi: ContainerId[] }>;
  // 容器 → 其内物品类型集合（增量维护反查）
  containerItems: Record<ContainerId, ItemId[]>;
  // 单物容器绑定（由首个非空 slot 推导，缓存）
  singleBindings: Record<ContainerId, ItemId>;
}
```

**"越用越快"机制：**
- 索引持久化到 DP 分片，启动时加载，不依赖全量重建
- 运行中事件驱动增量更新：分拣移动、容器放置/破坏、角色变更、整理、玩家手动改箱（经容器内容变化事件）
- 惰性校验：路由命中候选时发现容器内容与索引漂移（如单物绑定被玩家破坏），局部修复该条目，不触发全量重建
- 崩溃恢复：从持久化快照恢复，缺失条目下次访问时自动补算

**索引不含容量**：容器容量/仓库容量单独动态读取 + 持久化。

## 6. 调度系统（core/scheduling/）

```ts
// 全局主任务：每 5 tick 运行一次
class Scheduler {
  tick(): void;   // 遍历所有仓库，驱动生命周期状态机
}

type WarehouseLifecycle = "inactive" | "activating" | "active" | "deactivating";

interface WarehouseRuntime {
  lifecycle: WarehouseLifecycle;
  interval?: IntervalHandle;                    // 独立 interval
  inputCursor: number;                          // 输入容器轮询游标
  slotCursors: Map<ContainerId, number>;        // 每输入容器槽位游标
}
```

**调度规则：**
- 全局 5 tick 主任务：检查各仓库邻近状态（玩家进入/离开事件驱动切换，非每 tick 轮询）
- 激活：玩家进入邻近范围 → `activating` → 创建该仓库独立 interval（间隔 = processingSpeed）
- 停用：无玩家 → `deactivating` → 延迟后清除 interval → `inactive`
- 每个 interval 每轮处理**一个输入容器的非空 slot**（槽位游标轮询）
- 单仓速度可调（processingSpeed ∈ [4,8,16,20,30,40]）+ 全局速度限制（ModConfig.globalSpeedLimit，clamp 单仓速度）
- 全局分拣总开关（暂停/恢复）

## 7. 统计系统（core/stats/）

```ts
// 容器级统计
interface ContainerStats {
  containerId: ContainerId;
  role: ContainerRole;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  isWarning: boolean;              // usedSlots/totalSlots >= 0.9
  byType: Record<ItemId, number>;  // 类型统计：物品 → 数量
}

// 仓库级统计
interface WarehouseStats {
  warehouseId: WarehouseId;
  containerCount: number;
  totalSlots: number;
  usedSlots: number;
  totalItems: number;
  uniqueTypes: number;
  byRole: Record<ContainerRole, RoleStats>;
  byType: Record<ItemId, number>;   // 仓库级类型统计
  byItem: Record<ItemId, ItemStat>; // 物品统计（数量/堆叠数/所在容器）
}
```

**统计策略：**
- 写穿透：分拣/整理后立即重算受影响容器统计并持久化（DP 分片）
- 失效驱动：设置页"刷新统计" → 清缓存 + 删 DP → 下次访问全量重算
- 崩溃恢复：从 DP 加载，缺失条目自动补算
- 三级容量预警（黄/红/深红）基于统计触发，冷却 100 tick，事件驱动发送

## 8. 存储接口与 DP 分片实现（core/storage/ + mc/storage/）

**原则：core 只定义接口，实现注入。**

```ts
// 分片化键值仓储
interface KeyValueStore {
  read<T>(key: string): T | undefined;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
}

interface WarehouseStore {
  list(): WarehouseSnapshot[];
  load(id: WarehouseId): WarehouseSnapshot | undefined;
  save(snapshot: WarehouseSnapshot): void;
  remove(id: WarehouseId): void;
}
interface IndexStore {
  load(id: WarehouseId): IndexSnapshot | undefined;
  save(id: WarehouseId, snapshot: IndexSnapshot): void;
}
interface StatsStore {
  load(id: WarehouseId): StatsSnapshot | undefined;
  save(id: WarehouseId, snapshot: StatsSnapshot): void;
}
```

**DP 分片实现（mc/storage/）：**
- **单键满容量实测 32KB**，分片为必选方案
- 每个分片键内容 ≤ **30KB 安全线**（留余量给 hash 校验字段）
- 内容 hash 分片 + 世代号防陈旧数据（沿用 v1 方案）
- 写后验：读回校验 hash，失败则重写
- 单仓库数据超总量限制（1MB）的极端场景：按仓库拆分快照降级兜底
- 核心测试用 `InMemoryKeyValueStore`

## 9. 领域事件（core/events/）

**core 内部事件用 toolkit EventSignal（纯 TS，已就绪）：**

```ts
type DomainEvent =
  | { type: "item-routed"; warehouseId; from: ContainerId; to: ContainerId; itemId; amount }
  | { type: "container-changed"; warehouseId; containerId }
  | { type: "index-updated"; warehouseId; itemId; candidates: ContainerId[] }
  | { type: "stats-changed"; warehouseId; containerId? }
  | { type: "warning"; warehouseId; level: "yellow" | "red" | "deep-red"; containerId? }
  | { type: "visual-effect"; kind: "route-flash" | "boundary-glow" | "particle"; target: Location; color? };
```

- 事件总线：core 发事件 → 适配层订阅播放视觉反馈（粒子/光幕）
- 预警事件带冷却（100 tick）由 core 统计模块统一管理
- 索引/统计更新作为事件副作用，形成闭环

## 10. MC 适配层（mc/adapters/）

```ts
// 容器适配器：真实 MC 容器 ↔ 概念 Container
class McContainerAdapter implements Container {
  // 内部持有 mc.Container，getItem/setItem/addItem 委托
  // 容量从容器 size 动态读取
}

// 物品适配器：mc.ItemStack ↔ 概念 ItemStack
class McItemAdapter {
  toDomain(mcStack: mc.ItemStack): ItemStack;
  toMc(domain: ItemStack): mc.ItemStack;
}

// 事件桥接：MC 世界事件 → 领域事件
class McEventBridge {
  // containerContentChange / blockPlace / blockBreak / blockExplode / playerInteract
  // → 过滤本仓库容器 → 派发 container-changed → 索引增量维护
}
```

**适配层职责边界：**
- 容器变更监听只在本仓库激活区间挂载（性能）
- 区块安全访问：所有方块/容器访问 try-catch，适配层返回 undefined 而非抛错
- core 完全不知道 MC 存在——单测零 mock 成本

## 11. 应用服务层（core/services/）

```ts
class WarehouseService {
  // 创建/删除/重命名/成员管理/设置（via WarehouseStore）
  // 验证：重名检查、区域重叠检查（容器不允许重复注册）
}
class RouteService {
  // 分拣开关、速度设置、逐容器启用/禁用
  // 委托给 Scheduler + Router
}
class OrganizeService {
  // 概念化整理器（进 core，可单测）
  // 混乱度评分 → analyze → apply（快照 → 回滚）
}
class StatsService {
  // 统计查询 + 失效刷新 + 三级预警判定
}
class MemberService {
  // owner/member/visitor 权限校验（命令/信物/UI 统一入口）
}
```

**整理器（core/organizing/）**：保留 v1 思路——混乱度评分、analyze/apply 三段式、快照回滚，全部基于概念容器实现。

## 12. 交互层（mc/ui/ + mc/commands/ + mc/interaction/）

- **UI：** 12 模块结构（ActionForm/ModalForm），用 toolkit 的 ActionFormBuilder/ModalFormBuilder 重构；新增统计页（类型/物品统计双视图）
- **命令：** 9 命令平移（`<prefix>:<command>` via defineCommand），含注册页命令（区域点选/容器点选/信物），权限经 MemberService 校验
- **信物交互：** 手持信物右键容器 → 打开对应管理页（v1 式）
- **视觉反馈：** 订阅 core 事件 → 播放路由闪光/边界光幕/粒子；无玩家在场不播放（适配层判断）

## 13. 测试策略

- core 为纯 TS 零 MC import → node 直接跑，无 mock 框架
- 测试运行：`pnpm test:item-route`（tsc 编译 + node 断言脚本，不引入 jest，保持零额外依赖）

**核心单测清单：**
1. 路由引擎：O(1) 流程正确性（单物→多物→杂项顺序、堆叠/移动、满箱跳过、不吞物不复制）
2. 候选排序器：priority + usageRatio 排序、满箱过滤
3. 单物绑定：首个非空 slot 推导、玩家破坏后索引自愈
4. 索引：增量维护正确性（分拣/角色变更/移除）、序列化往返、崩溃恢复
5. 调度：生命周期状态机（inactive↔active）、速度 clamp、全局开关
6. 统计：三级预警阈值（90%）、冷却、失效刷新
7. 整理器：混乱度评分、analyze/apply/回滚
8. 存储：InMemoryKeyValueStore 上的分片写读、hash 校验、世代号
9. 成员：权限矩阵

## 14. v1 技术债规避（对照 v1 分析 §15）

| v1 技术债 | item-route 对策 |
|-----------|----------------|
| 模块级单例 | 构造函数依赖注入，显式装配（main.ts） |
| 搜索无索引 | 本期索引即搜索底座（byItem/containerItems），搜索页直接查索引 |
| 模型不淘汰（v1 索引缓存不清理） | 快照 + 惰性补算，定期清理失效条目 |
| 文档阈值不一致（90% vs 80%） | 常量统一于 core/stats，单测锁定 |
| 内容 hash 分片无写后验 | 写后验读回校验 hash，失败重写 |
| 调度全局单速度 | 单仓速度 + 全局 clamp |
| 索引全量重建 | 事件驱动增量维护 + 崩溃恢复 |

## 15. 里程碑

1. **M1 骨架**：项目脚手架（just.config/tsconfig/manifest/package.json）+ core/model + 存储接口 + InMemory 实现 + DI 装配
2. **M2 核心路由**：routing + index + scheduling 最小闭环 + 路由/索引/排序单测
3. **M3 数据层**：mc/storage DP 分片实现 + McContainerAdapter/McItemAdapter/McEventBridge
4. **M4 服务与交互**：services + 12 UI 模块 + 9 命令 + 信物交互 + 视觉反馈
5. **M5 整理与统计**：organizing + stats 完整实现 + 预警
6. **M6 收尾**：全量单测、构建、打包、游戏内验证

## 16. 待办（设计审阅后）

- [ ] 用户审阅本设计文档
- [ ] writing-plans 生成实施计划（分里程碑）
- [ ] 项目脚手架创建（item-route 目录）
