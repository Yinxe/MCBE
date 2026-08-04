# SmartWarehouse v1（0.0.62）功能与细节分析

日期：2026-08-04
用途：为 SmartWarehouse 2.0 完全重写提供源项目全貌参考（功能清单、架构细节、设计决策、已知问题）。

> 本文基于对源码的逐文件通读（scripts/ 全部 77 个 TS 文件、BP/RP 配置、docs/ 文档）整理。
> 目标是"照镜子"：2.0 规划时以本文为基线，逐条决定保留 / 改进 / 舍弃。

---

## 1. 项目概况

| 项 | 值 |
|---|---|
| 包名 | smartwarehouse（workspace 内） |
| 版本 | 0.0.62 |
| 打包产物名 | 智能仓库-v0.0.62.mcaddon |
| 许可证 | MIT |
| 项目地址 | https://github.com/YinxSmartHouse/SmartWarehouse |
| 依赖 | @minecraft/server ^2.0.0（实际 2.6）、@minecraft/server-ui ^2.0.0、@minecraft/math 2.2.7、@yinxe/toolkit（workspace）、@yinxe/toolkit-build |
| 构建 | just-scripts + tsc + esbuild；generate-version → sync manifest 版本 → tsc → bundle |
| min_engine_version | 1.21.90 |
| 源码规模 | 77 个 TS 文件，约 1.2 万+ 行；data/ 约 4200 行（含 51 家族 1877 行 + name-maps 2255 行） |

模块结构（9 层）：

```
main.ts          入口：两阶段引导（Phase1 基础设施 → Phase2 有状态业务）+ 4 Phase 启动时序
types.ts         集中式类型定义（40+ 类型/接口）
commands/        9 条自定义命令 + chatSend 兼容回退
data/            51 物品家族 / 中文名映射（8 张分表合并）
interaction/     信物交互控制器 + 选区会话
organize/        SlotOrganizer 整理器 + 结果格式化
runtime/         运行时模型缓存（脏标记 + 惰性重建）
sorting/         分拣引擎 / 调度器 / 索引自愈 / 容量预警 / 事务日志 / 快照 / 粒子
storage/         DynamicProperty 持久化（仓库 / 统计 / 模组配置）
ui/              12 个 UI 模块（@yinxe/toolkit 的 ActionFormBuilder/ModalFormBuilder）
util/            日志 / 坐标 / JSON / 权限 / 钩子 / 容器扫描 / 模块开关
warehouse/       仓库 CRUD / 容器扫描 / 双箱探针 / 搜索 / 边界光幕 / 区域检查
tools/           6 个数据维护脚本（mjs）
tests/safety/    4 个安全测试 + MockContainer + 运行器
docs/            架构 / 路由 / 家族指南 / 设计规格与计划
```

---

## 2. 启动时序（main.ts）

两阶段引导 + 4 Phase：

- **Phase 1**（无状态基础设施）：Logger、DynamicPropertyStore、BootLogger
- **Phase 2**（有状态业务）：ModConfigStore → WarehouseRepository → WarehouseService → SearchService 等
- **Phase 3**（注册）：`system.beforeEvents.startup.subscribe` 中注册 9 条自定义命令；注册工具交互事件（beforeEvents.playerInteractWithBlock / afterEvents.itemUse / afterEvents.playerLeave）；注册方块放置/破坏事件维护；chatSend 兼容回退（运行时检测，v1.x 才有）
- **Phase 4**（延迟启动）：`system.run` 后启动 SortingScheduler 全局 20 tick 监控 interval
- BootLogger 缓存 Phase1-3 消息，done() 时 world.sendMessage 广播（版本号 + 构建时间 + 项目地址）

---

## 3. 数据模型（types.ts 核心）

- `ContainerRole`：`input | normal | misc | bulk`（无 disabled 角色；用 `enabled` 布尔表达关闭）
  - `ROLE_ORDER = ["input", "normal", "misc", "bulk"]`；漏斗固定 input 不可改
- `StoredContainer`：`{ id, dimensionId, primaryLocation, occupiedLocations[], role, enabled, capacityWarningEnabled, bulkTypeId?, discoveredAt, updatedAt }`
  - 容器 ID = `locationKey(dimensionId, primaryLocation)`，格式 `维度ID|x|y|z`（竖线分隔，避免维度冒号冲突），如 `minecraft:overworld|10|64|10`
  - 大箱子合并为一个逻辑容器，`occupiedLocations` 含两格坐标
- `WarehouseArea`：`{ min, max }` 归一化区域（components 各取 min/max）
- `WarehouseSettings`：`{ defaultNewContainerRole, defaultNewContainerEnabled, autoCreateCategories, enabled, processingSpeed, debug, showBoundary, autoSortThreshold, capacityWarning, enabledFamilies[] }`
  - `processingSpeed ∈ [4, 8, 16, 20, 30, 40]` tick
  - `autoSortThreshold ∈ [0, 20, 40, 60, 100]`（混乱度自动整理阈值，slider step 20）
- `WarehouseData`：`{ id, displayName, ownerId, dimensionId, area, settings, containers: Record<ContainerId, StoredContainer>, updatedAt }`
- `WarehouseRuntimeModel`：运行时模型（见 §5）
- `ContainerStats`：`{ containerId, blockType, role, totalSlots, usedSlots, totalItems, uniqueTypes, isWarning }`
- `SelectionSession`：createWarehouse / resizeWarehouse 两种选点会话
- 常量：`WAREHOUSE_NEARBY_MARGIN = 8`、`ROLE_LABELS / ROLE_DESCRIPTIONS`、`SPEED_LABELS`

---

## 4. 持久化层（storage/）

### DynamicPropertyStore
- 封装 `world.getDynamicProperty / setDynamicProperty / delete`，getJson/setJson（JSON 序列化）、safe 长度检查
- `DEFAULT_DYNAMIC_PROPERTY_SAFE_LENGTH = 24000`（UTF-16，用 `String.length` 度量）
- 超限拒绝写入并抛错

### WarehouseRepository（核心存储设计）
- 键空间：
  - `sw:index`：仓库 ID 列表索引（`{ version, warehouses[] }`）
  - `sw:warehouse:{id}:meta`：元数据（含 `containerShardCount`、`generation`）
  - `sw:warehouse:{id}:{gen}:containers:{shardIndex}`：容器分片
  - **世代号（generation）机制**：每次写容器时 generation+1，写失败不破坏旧世代 → 防崩溃部分覆盖；加载时取当前世代；孤儿世代可清理
- 分片：`CONTAINERS_PER_SHARD = 5`（单容器序列化约 1.4KB，5×1.4KB ≈ 7KB，远低于 24KB 上限，留足余量）
- `saveMetaOnly` / `saveContainers` / `loadAll / load(id) / deleteWarehouse`
- `normalizeWarehouseId`：`^[a-z0-9_-]{1,32}$`，小写、去首尾空白、非法字符直接拒绝（不自动替换）
- `DEFAULT_WAREHOUSE_SETTINGS`：`{ defaultNewContainerRole: "misc", defaultNewContainerEnabled: true, autoCreateCategories: false, enabled: true, processingSpeed: 8, debug: false, showBoundary: false, autoSortThreshold: 100, capacityWarning: true, enabledFamilies: [] }`
- 数据损坏保护：load 时 JSON 解析失败返回 undefined（不崩溃、不删除 DP），由调用方提示管理员

### WarehouseStatsStore
- 每容器一条 DP：`sw:warehouse:{wid}:cstats:{cid}`，独立于主存储（避免拖累仓库读写）
- 写穿透：分拣写入后立即 `refreshContainerStats` 重算单容器并写 DP
- 失效路径唯一：设置页"刷新存储统计" → `invalidateWarehouseStats` 清缓存 + 删 DP
- 崩溃重启后从 DP 恢复，无需全仓重扫

### ModConfigStore
- 全局配置 DP 键 `sw:mod_config`，内存缓存
- `ModConfig`：`{ tokenItemId, maxWarehouseVolume, maxContainers, maxWarehousesPerPlayer, globalSpeedLimit }`
- 默认：木锄 token、最大体积 16384（32×32×16）、100 容器/仓、1 仓/人、不限速
- `clampSpeed`：全局限速时对仓库速度取 max
- `TOKEN_OPTIONS`：13 种可选信物 + 关闭选项（label 带颜色码与中文名）
- 体积选项 16³/24×24×16/32×32×16（推荐）/48×48×16；容器选项 50/100（推荐）/200/512；限速 4/8/16/20/30/40

---

## 5. 运行时模型（runtime/）

### WarehouseRuntimeRegistry
- 内存缓存 Map<WarehouseId, WarehouseRuntimeModel>，**不自动淘汰**（MVP 决策，仓库数有限）
- 脏标记 + 惰性重建：`getOrBuild` 在 dirty 或缺失时重建
- 重建时保留 inputCursor 取模（`inputCursor % inputCount` 实现轮询负载均衡）

### WarehouseRuntimeModel（buildWarehouseRuntimeModel）
- `containersById`、`occupiedLocationIndex`（坐标键 → containerId，点击任一半边反查）、
- 按角色分组 ID 列表（input/normal/misc/bulk）、
- `itemTypeIndex`：typeId → 候选 normal 容器 ID 列表（**运行时优化，非事实来源**）、
- `familyTypeIndex`：familyId → 容器列表（家族聚集用）、
- `inputCursor`、`inputSlotCursors`（每个 input 容器的槽位游标）、`areaLoaded`（缓存区块加载状态）

---

## 6. 分拣系统（sorting/，核心复杂度所在）

### SortingScheduler —— 惰性生命周期
- 全局 20 tick interval 监控所有仓库
- 状态机：`inactive → activating → active → deactivating → inactive`
  - 玩家在仓库附近（`isNearAreaXZ`，中心 + 外接圆半径 + `PROXIMITY_MARGIN=8`）→ 激活
  - 无人 → 40 tick 延迟后停用（`DEACTIVATE_DELAY_TICKS=40`）
- 激活时创建该仓库的 interval（间隔 = processingSpeed tick），停用时清除
- 全局分拣开关（ModuleController `sw:sorting_enabled` DP）：关闭时清所有 interval + processWarehouse 快速返回

### SorterEngine —— 五级优先级路由
每轮处理一个 input 容器的一个非空 slot（槽位游标）：

1. **大宗已有同类**（bulk，已有该 typeId 的容器优先）
2. **普通已有同类**（normal，itemTypeIndex 候选）
3. **大宗空箱**（需 `bulkTypeId` 匹配才接受）
4. **普通空箱**（或 autoCreateCategories 时自动开新分类容器）
5. **杂项兜底**（misc）

细节：
- 目标选择时读取真实容器内容确认（索引仅作候选）；候选失效局部修正
- 家族聚集：enabledFamilies 开启时，同族物品优先路由到已有同族物品的容器（familyTypeIndex）
- 大宗容器按"箱内首个物品类型"匹配（`getBulkChestFirstType`），空箱需手动放物设定
- 双遍扫描：先尝试合并进已有同 typeId 槽位，再放空槽
- 转移使用 `container.addItem`（API 原生堆叠语义），返回剩余
- 分拣成功后：刷新该容器统计（写穿透）、播放粒子（SortEffects）、检查混乱度触发自动整理（threshold）、容量预警检查
- 输入容器槽位写回失败时 MoveJournal 回滚所有已写入目标；回滚失败则停用仓库（`settings.enabled = false` + saveMetaOnly + 日志）

### SortingIndexManager —— 索引自愈
- 维护 itemTypeIndex 的惰性校验 + 自动修复，三阶段：
  1. 校验候选（可访问性）
  2. 惰性清除失效候选
  3. 零延迟全量回退（重建索引）
- 目的：玩家手动改箱 / 容器损坏后索引与真实内容漂移的收敛

### CapacityWarningService —— 三级预警
- 黄色：单容器 usedSlots/totalSlots ≥ 90%（`CAPACITY_WARNING_THRESHOLD = 0.9`，stats.isWarning），提示具体容器 + 物品中文名；受容器级 `capacityWarningEnabled` 控制
- 红色：某角色容器组全部已满 → 物品降级提示（warnDowngrade）
- 深红：全仓满 → 无法分拣提示
- 红色/深红受仓库级 `settings.capacityWarning` 控制
- 冷却 `COOLDOWN_TICKS = 100`（约 5 秒），key 粒度：容器级 = containerId；降级 = `downgrade:{wid}`；全满 = `full:{wid}`
- 消息只发给同维度且距仓库 8 格内的玩家

### MoveJournal —— 单 tick 事务
- 内存事务日志：记录本次输入槽分拣写入过的所有目标容器完整快照（TargetSnapshot[]）
- `rollback()` 逆序恢复；失败返回错误（触发仓库停用）
- 生命周期仅当前 tick，不跨重启

### ContainerSnapshot / ContainerInventory
- `snapshotContainer(container, start, end)`：槽位范围 ItemStack clone 快照
- `restoreContainerSnapshot`：逐槽恢复，返回 ok/error
- ContainerInventory：`getContainerFromStored`（通过 dimension + primaryLocation 取 BlockInventoryComponent）、`findFirstNonEmptySlot`、`isContainerEmpty`、`getBulkChestFirstType`、`getFamilyPurity`、`containerHasType`

### SortEffects —— 粒子/视觉反馈
- 两个自定义粒子：`smartwarehouse:sort`（分拣中）、`smartwarehouse:deposit`（放入），RP particles/ 下
- 6 粒子环形旋转 + 渐变纹理（container_gradient.png / sort_gradient.png）+ 颜色变量（v.color_r/g/b）
- 角色颜色映射：normal 浅绿、misc 粉红、bulk 天蓝、input 金色；尺寸：单箱 0.96、大箱 1.08

### PlayerProximityTracker
- 每 tick 全量重建"玩家位置缓存"（Map<playerId, {x,z}>），`hasPlayerNearby(warehouse)` 用缓存判定
- `findVisitor(warehouse)` 找最近玩家（预警只发给附近玩家用）

---

## 7. 仓库业务层（warehouse/）

### WarehouseService（CRUD 中心）
- `createWarehouse`：归一化区域 → 限制校验（MAX_EDGE_LENGTH=32 / MIN_WAREHOUSE_SPACING=4，与现有仓库间距检查 `areasTooClose`）→ 扫描容器 → 写存储 → 建运行时模型
- `resizeWarehouse`：区域调整，保留原容器角色/状态（离开区域的容器移除，新容器用默认角色）
- `rescanWarehouse`：全量重扫 + 合并规则（diff 保角色）
- `previewRescanWarehouse`：diff 预览不写（added/removed/changed/unchanged）
- `deleteWarehouse`：清 DP（index/meta/分片/统计）+ 清运行时模型 + 移除边界光幕
- `renameWarehouse / updateSettings / setContainerRoleAndState`
- `findWarehouseAt(dimensionId, location)`：坐标 → 仓库（遍历）
- `markRuntimeDirty(warehouseId)` 回调机制
- 依赖注入：`ContainerScanner` 构造参数可注入（可测性），`onNotify` 回调

### ContainerScanner
- 遍历仓库区域所有方块（三轴循环），`tryGetBlock` 安全获取
- 支持容器白名单：箱子/陷阱箱/桶/漏斗/潜影盒（`SHULKER_BOX_IDS` 16+1 色）
- 大箱子：SafeProbe 探测另一半，`locationKey` 合并为一个逻辑容器（primary = x→z→y 排序更小者）
- 漏斗也纳入扫描（自动 input 角色）

### SafeProbe —— 双箱安全探针（安全加固产物）
- 用 `minecraft:structure_void` 临时物品放入空槽探测邻接箱子是否共享容器（不依赖容器 size 猜测）
- 优先找空槽（从 0 开始），无空槽用最后一格
- 写入前 clone 原件，`finally` 恢复 + `sameStack` 深度校验（typeId/amount/nameTag/lore/durability）
- 失败/恢复校验失败返回 undefined（不冒险）

### AreaCheck —— 区块加载预检
- `checkWarehouseAreaLoaded`：区域 8 角采样 `dimension.getBlock`，任一失败 → 未加载
- 结果缓存到 model.areaLoaded，`RECHECK_INTERVAL = 40` tick 重试
- 分拣入口先检查：未加载直接跳过本轮（不主动加载区块）

### BoundaryDisplay —— 边界光幕
- 12 条棱的 endrod 粒子线框，`STEP = 0.6` 格，每 `REFRESH_INTERVAL = 40` tick 刷新
- 临时显示（resize 预览/创建后）`TEMP_DURATION_TICKS = 200`（10 秒）
- 常显受 `settings.showBoundary` 控制；玩家在 `PROXIMITY_MARGIN=8` 内才渲染

### SearchService
- 只读全仓扫描：遍历容器 → 匹配 itemTypeIndex 查询 typeId → 输出 `ContainerSearchResult { containerId, itemTypeIds[], matchedItems[], matchedNames[] }`
- 查询委托 ItemNameMap.searchItems（typeId 精确/前缀/子串 + 中文名模糊 + 英文名模糊）
- `formatSearchResult` 聊天栏格式化；`getMarkerLocations` 返回匹配容器坐标

### ContainerId / WarehouseRescanDiff
- `makeContainerId`：primary 坐标 key；`makeOccupiedLocationKey`
- `diffRescanContainers`：比较新旧容器记录（role/enabled/occupiedLocations），分类 added/removed/changed/unchanged

---

## 8. 整理系统（organize/）

### SlotOrganizer —— 三段式 API（analyze → apply → organize）
- `analyze`（只读）：扫描槽位范围 → 按 typeId 排序 → 合并可堆叠（clone 保护）→ 构建 checksum（typeId → stacks/total）→ 混乱度评分
- `apply`（写入）：
  1. **写入前重新校验**：以当前容器实际内容为准重建 checksum，逐 typeId 核对 total 为零（不依赖 analyze 时快照，防间隔被改）
  2. 写入前 `snapshotContainer` 快照
  3. 逐槽 setItem，写入失败立即中断
  4. **写失败 → 恢复快照回滚**，返回错误结果
  5. 全部成功才清理旧槽位
  6. 触发 OrganizeHooks
- 混乱度评分（MessinessScore）：总分 0-1
  - 顺序 70%：非空物品间相邻逆序对 / (n-1)（只影响相邻，不级联）
  - 堆叠 30%：同种物品 ≥2 组未满堆叠才记入（1 组不算，正常使用状态）suboptimalStacks / nonEmptySlots
- 容器写锁：`tryLock/unlock/isLocked`，`LOCK_SAFETY_TICKS = 100` tick 超时自愈；分拣引擎跳过锁定容器
- `onDeposit`：分拣放入后调用，混乱度 > threshold 自动整理（threshold ≥ 1.0 永不）
- 背包整理：`analyze(container, { startSlot: 9, endSlot: 36 })` 快捷栏除外
- 兼容：漏斗（hopper）槽位固定为 input 不可改；整理支持任意 Container

### OrganizeFormatter
- 结果格式化为聊天行：混乱度分解、堆叠合并数（before→after）、种类数、按总量排序前 8 种物品、空容器/已整齐提示

---

## 9. 交互层（interaction/）

### ToolInteractionController —— 信物交互
- 事件分层（防抖设计）：
  - `beforeEvents.playerInteractWithBlock`：信物 + 非潜行 → 容器角色菜单 / 选点；信物 + 潜行 → 快速整理（容器或背包）
  - `afterEvents.itemUse`：对空右键兜底 → 主菜单（射线检测 maxDistance 6 先排除容器，潜影盒等可能不触发 interact 的容器走这条）
  - `DEBOUNCE_MS = 250`：`recentUseOn` 时间戳防抖，避免 interact 后紧跟的 itemUse 误弹菜单
- 点击容器：`findWarehouseAt` → occupiedLocations 反查 → 数据过期时提示 + 触发增量修复（rescan）
- 选点流程：非容器点击 → 会话记录 pointA → 第二点触发 create/resize（`system.runTimeout(1)` 延迟避免受限上下文）
- 离开事件清理：recentUseOn + 会话
- 快速整理：潜行 + 信物 + 右键容器 = 整理该容器；+ 右键非容器 = 整理背包（9-36 槽）

### SelectionSessionStore
- 全局 Map<playerId, SelectionSession>，轻量、无持久化、离开即清
- 会话类型：createWarehouse（名称/默认角色/默认启用）、resizeWarehouse（warehouseId）

---

## 10. UI 层（12 模块）

| 模块 | 内容 |
|---|---|
| MainMenu | 主菜单：容器搜索 / 管理仓库（智能定位附近所有仓直达设置）/ 仓库列表 / 创建仓库 / 帮助 / 设置（仅管理员）|
| WarehouseCreateFlow | ModalForm：名称 + 默认角色（默认 misc）+ 默认启用 → 写会话 → 提示选点 |
| WarehouseManageMenu | 仓库列表（管理员看全部 + ownerId 尾 8 位标识，非管理员只看自己的），按名称排序 |
| WarehouseSettingsMenu | 大表单：名称/默认角色/默认启用/处理速度/自动创建分类/启用/边界/自动整理阈值 slider/容量预警 + 操作区（刷新容器/修复/删除/刷新统计/家庭成员/调整区域，互斥选择 + 二次确认）|
| ContainerRoleMenu | 容器详情（类型/容量/混乱度/家族纯度/ID/状态/角色）+ 管理员 ModalForm（启用/角色/容量预警/立即整理）；漏斗只读提示；非管理员只读 |
| SearchUI | 搜索 ModalForm（关键词 + 按距离排序的仓库下拉）→ 结果聊天栏 + 紫色粒子标记（状态机：持锄续时 → 松锄 15 秒倒计时 → 3 秒宽限 → 消失，每 20 tick 刷新，同玩家新搜索清理旧会话）|
| FamilyConfigMenu | 51 家族逐个开关（ModalForm），保存 enabledFamilies |
| ConfigUI | 管理员面板：模组配置（信物/体积上限/容器上限/每玩家仓库数/全局限速）+ 全服统计（按玩家聚合 + 排名）+ 分拣总开关 |
| WarehouseStats | 统计缓存（内存 + DP 写穿透）、getWarehouseStats 聚合、Table 渲染（仓库/各角色容器数、TYPES、ITEMS、STORAGE 比例 + ⚠ 标记）|
| Table | 纯文本表格渲染器（§ 颜色码不计视觉宽度、对齐、列间隙）|
| NewPlayerGuide | 首次打开菜单自动推送欢迎引导（DP `smartwarehouse:onboarded:{playerId}` 标记已看）|
| HelpGuide | 4 章帮助（快速入门/容器角色/分拣机制/FAQ），聊天栏分页发送 |

---

## 11. 命令层（9 条）

全部经 `customCommandRegistry`（startup 事件）注册，`defineCommand`（toolkit）包装；权限 `CommandPermissionLevel.Any` + `cheatsRequired: false`，**权限在回调里用 canManageWarehouse 校验**：

| 命令 | 参数 | 权限 | 说明 |
|---|---|---|---|
| sw:create | 名称 + 2 坐标 | op | 命令式创建（默认 misc/启用）|
| sw:resize | 名称 + 2 坐标 | op | 调整区域 |
| sw:rescan | 名称 | op | 全量重扫 |
| sw:rescan_preview | 名称 | op | 预览变更不写 |
| sw:delete | 名称 | op | 删除仓库 |
| sw:organize | 无 | 所有人 | 整理背包（9-36 槽）|
| sw:menu | 无 | 所有人 | 打开主菜单 |
| sw:help | 无 | 所有人 | 帮助手册 |
| sw:search | 关键词 | op | 附近且属于该玩家的仓库搜索 + 粒子标记 |

兼容层：`chatCommands.ts` 运行时检测 `beforeEvents.chatSend`（v1.x 有、v2.x 移除），拦截 `/sw:menu`、`/sw:help` 兜底（高版本不会触发，因自定义命令先拦截）。

---

## 12. 数据层（data/）

### ItemFamilies（51 家族 / 1430+ 物品 / 覆盖率 90.8%）
- 互斥分类：一物品只属一家；类型化 `ItemFamily { id, displayName, items[] }`
- 由 `tools/generateItemFamilies.mjs` 生成 + `tools/annotateFamilies.mjs` 注入中文注释（勿手改，改生成器）
- 导出：`ALL_FAMILIES`、`getFamily(typeId)`、`getFamilyById`、`isInFamily`
- 家族清单（节选）：建筑 7（羊毛/地毯/玻璃/混凝土/粉末/陶瓦/釉陶瓦）、容器装饰 4（潜影盒/蜡烛/染料/捆包）、装备家具 2、木材 3、石材 5、矿石 3、装备武器 3、弹射道具 3、红石农业 3、自然生态 6、掉落 2、药水唱片 3、宝藏结构 3、锻造陶片旗帜 3、创造专属 1

### ItemNameMap / name-maps
- 8 张分表合并为 `itemsMap`（1396 条），优先级：direct > gaps > colors > woods > compounds > special > fallback
- 另有 effects/enchantments/entities 三张表
- `searchItems(query)`：typeId 精确/前缀/子串 + 中文名模糊 + 英文回退名模糊，多结果去重排序
- `NAME_INDEX`：中文名（小写）→ typeId 列表反向索引（模块加载时构建）

---

## 13. 安全机制汇总（2.0 必须保留的沉淀）

1. **世代号分片存储**：防崩溃部分覆盖（storage 层）
2. **SafeProbe**：双箱探测不吞物（临时物 + clone 恢复 + 深度校验）
3. **MoveJournal**：单 tick 分拣事务，失败回滚；回滚失败 → 停用仓库（宁可停也不丢）
4. **SlotOrganizer**：写入前重新校验 checksum + 快照回滚
5. **区块预检**：8 角采样 + 40 tick 缓存，未加载不碰
6. **漏斗/潜影盒白名单**：只认受支持容器类型
7. **DP 长度安全线**：24K UTF-16 上限
8. **错误边界**：所有方块/容器访问 try-catch；事件回调整体 try-catch；UI 回调 catch 发消息
9. **测试**：tests/safety 4 个测试（ContainerSnapshot / MoveJournal / SlotOrganizerRollback）+ MockContainer，`pnpm test:safety`（tsc 编译后 node 运行）

---

## 14. 已知问题 / 技术债（2.0 改进点）

### 架构级
1. **全局模块级状态**：SelectionSessionStore（Map）、SearchUI activeMarkerHandles、WarehouseStats containerCache、SortHooks/OrganizeHooks（静态数组）都是模块级单例——可测性差，2.0 可用已实现的 toolkit EventSignal 重构
2. **RuntimeRegistry 不淘汰**：模型永驻内存（仓库数量有限时可接受，但大服是隐患）
3. **PlayerProximityTracker 每 tick 全量重建缓存**：O(玩家数) 每 tick，可事件驱动（playerSpawn/playerLeave/位置 tick 缓存）
4. **WarehouseStats 与主存储分离**：两条 DP 键空间，统计缓存只在显式失效/写穿透时更新，存在窗口期
5. **commands/ui 耦合 service/repository 实例**：入口参数传递链长（main → menu → 子菜单），2.0 可做服务定位/组合根
6. **无数据迁移框架**：所有持久化对象 version:1 硬编码，repo 层无迁移逻辑（世代号只防覆盖不迁移）

### 细节级
7. **搜索无索引**：SearchService 全仓实时扫描（容器内物品逐槽读取），大仓慢
8. **粒子状态机**（SearchUI）：每 20 tick 读玩家物品栏判断持锄，且有 15 秒倒计时文案与消息不一致（消息说 10 秒，代码 DEFAULT_DURATION=15×20=300 tick）
9. **指令权限文案**：README 说 op 标签，代码用 `canManage`（PlayerPermissionLevel.Operator）——不一致但以代码为准
10. **chatCommands 兼容层**：v2.x 中 chatSend 不存在，该文件逻辑几乎不可达（仅为旧版兼容）
11. **漏斗**：`isSupportedContainerType` 包含 hopper，但漏斗 role 强制 input；扫描会把普通漏斗纳入（用户没料到时可能困惑）
12. **ownerId 用 player.id（UUID）**：显示时只取尾 8 位，跨会话 owner 映射无玩家名持久化
13. **容量预警阈值**：黄色 90%（isWarning），README/帮助文档写 80%+ 黄——文档与代码不一致（代码为准）
14. **整理阈值**：autoSortThreshold 默认 100（永不整理）但 slider 推荐 40——默认值与推荐不一致
15. **BoundaryDisplay**：粒子用 endrod + 2 秒刷新，多仓同屏性能存疑（无合并/降频）
16. **大箱子合并依赖 SafeProbe 写临时物品**：每扫一次都要写/恢复，高扫描频率下有性能与风险（有 sameStack 校验兜底）
17. **测试只覆盖纯逻辑**：MockContainer 无 Minecraft 运行时，MoveJournal/SlotOrganizer 的真实行为仍需游戏内验证
18. **构建时间戳**：BUILD_TIME 每次构建变化，产生无意义 git diff（版本文件提交会噪音）
19. **ItemFamilies 双源维护**：生成器 + 手工修改可能漂移（生成器覆盖手改）
20. **UI 全中文硬编码**：无 i18n 框架，文案散落各 UI 模块

---

## 15. 对 2.0 重写的初步启示（仅记录，不决策）

- 保留：五级路由模型、世代分片存储、MoveJournal/快照回滚、SafeProbe、索引自愈、惰性生命周期、区块预检、写穿透统计
- 候选改进：事件驱动替代轮询（toolkit EventSignal 已就绪）、模型淘汰/懒加载分级、搜索索引化、组合根 DI、迁移框架、阈值文档一致化、owner 名持久化、i18n 文案集中
- 待决策：是否保留"选点式区域创建"交互、是否继续用信物交互、是否继续分 BP/RP 双包
