# MockPlayer — 模拟玩家

Minecraft Bedrock 模拟玩家（假人）Add-On，TypeScript + Minecraft Script API。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
# 构建
just-scripts build              # sync-version → tsc → esbuild bundle
just-scripts mcaddon            # 打 .mcaddon 发行包
just-scripts local-deploy       # watch 模式
just-scripts lint               # ESLint
just-scripts clean              # 清理

# core 单测（node:test + node:assert/strict）
pnpm run test:core   # tsc -p tsconfig.test.json → node --test .test-build/tests
```

---

## 架构（六边形分层，对齐 item-route）

```
scripts/
├── main.ts          # 4-Phase DI 组合根（只装配，不含业务）
├── core/            # 领域层：零 @minecraft 依赖，可 node 单测
│   ├── model/       # Types.ts — BotRecord/SerializedItemStack/常量（Vec3/Vec2 本地化；
│   │                #   normalizeBotName $ 前缀 + isValidBotName）
│   ├── events/      # EventSignal（零依赖信号）+ DomainEvents（raidStarted/raidVictory/
│   │                #   vaultOpened/认主/生命周期/行为/装备槽，BotEvents 聚合）
│   │                # + UiEvents（BotUiEvent：panelAction 14 动作 / behaviorSubmitted
│   │                #   行为菜单提交，负载可序列化）
│   ├── tags/        # BotTags — 标签定义/分组/四级解析（resolveTag）+
│   │                #   computeTagsFromBehaviorForm（表单 → 完整标签集纯函数）
│   ├── coords/      # Coordinate（容错坐标解析）+ Direction（旋转→方向）
│   ├── xp/          # XpMath — MC 经验公式
│   ├── format/      # Format（维度/罗马数字）+ EnchantZh（附魔中英映射）
│   ├── items/       # ItemRules（装备槽）/ ToolRules（工具识别/耐久/槽位搜索）
│   │                # MainhandPolicy（主手策略）/ TridentRules（三叉戟扫描）
│   ├── storage/     # BotStore 端口（泛型 TItem）+ Binding 绑定表 + InMemory 替身
│   ├── service/     # BotRegistry（注册表生命周期+恢复标记）/ ReclaimPlanner / RaidRules
│   ├── ai/          # **生物 AI 编排框架**（行为树节点/组合/装饰/黑板，零具体任务）
│   ├── tasks/       # **任务型模块**（VaultTask 宝库任务：感知端口 + 树装配，可单测）
│   └── index.ts     # barrel
├── mc/              # 适配层：只做 mcapi 副作用（IO/视觉/通知）
│   ├── bootstrap/   # context.ts — botStore/botRegistry 运行时单例（组合根装配）
│   │                # gametestContext — 测试维度注册 + 装置初始化（0,0,0 结构方块）
│   │                # uiDrivers — UI 领域事件订阅统一装配（18 模块）
│   ├── adapters/    # McBotStore（NBT 木桶阵列持久化）/ McItemCodec（预览序列化）/ PlayerGateway
│   │                # EntityTags / PoseGateway / McIntervalScheduler / EquipmentSlots
│   ├── features/    # 业务用例：决策调 core，副作用留本地（behavior/spawn/reclaim…）
│   ├── commands/    # mp:* 命令（薄壳；data 兼 UI 订阅 viewData）
│   ├── events/      # 世界事件订阅（薄壳）
│   ├── ui/          # toolkit 表单（**只发布 UI 领域事件，不 import 业务动作函数**；
│   │                #   表单提交后直接调 feature 的例外：mainhand/reclaim/trident/swap）
│   ├── ai/          # **AI 引擎**：BotBrain — 每假人每任务一棵行为树（惰性创建/防重入/
│   │                #   标签对账）+ startBrainEngine（10 tick 引擎 + UI 不在线提示）
│   ├── tasks/       # **任务执行**：McVaultPorts（宝库感知/导航/交互）+ McRaidPorts
│   │                #   （劫掠事件订阅/喝瓶/胜利处理/卡死提醒）
│   └── format.ts    # 带色文本格式化（§ 色码）
└── tests/           # node:test 单测（只测 core；mc 层靠游戏内冒烟）
    ├── helpers/     # factories（构造 BotRecord/物品）
    └── *.test.ts    # model/tags/coords/xp/items/services/storage/events/format
```

### AI 编排层（1.1.57，core/ai + core/tasks）

**分层**（任务型模块与生物 AI 分开定义）：

| 层 | 位置 | 职责 |
|----|------|------|
| 编排框架 | `core/ai/` | 行为树节点（零 @minecraft，可单测）：组合 Sequence/Selector/RandomSelector、装饰 Cooldown/Inverter/AlwaysSucceed/AlwaysFail/RepeatUntilSuccess、叶子 Condition/Action、等待 WaitForTicks、黑板 Blackboard、入口 BehaviorTree |
| 任务模块 | `core/tasks/` | 具体任务：感知快照类型 + 端口接口 + 树装配（VaultTask 宝库 / RaidTask 劫掠；砍树/钓鱼照此模式）。**决策纯声明，注入 Fake 端口可单测** |
| 引擎 | `mc/ai/BotBrain.ts` | 每假人**每任务**一棵树（vault/raid 可共存）：惰性创建、防重入（协程 tick 未完成跳过）、不可用（离线/死亡）跳过、标签对账（移除标签 → 停止导航+清黑板；**宝库重连中跳过**）。`startBrainEngine()` 10 tick 引擎 + UI 不在线提示 |
| 任务执行 | `mc/tasks/` | 端口实现：世界感知（getBlocks/背包扫描/效果查询）、导航、交互、通知（McVaultPorts / McRaidPorts） |

**核心机制**：
- **Selector 无记忆抢占**（goal 反应式选择，仿 Bedrock priority 组件）：每 tick 从第一个子节点重评，条件满足的分支胜出、条件变化立即切换。failure 是决策信号（降级下一个分支），不是异常
- **黑板**：每树独立实例，键值共享（如 vaultTarget / vaultKnowledge）——任务间状态、重连保留（实体换新黑板不丢）
- **感知驱动决策**：`sense()` 一次返回完整感知快照（背包有哪种钥匙 + 周围有哪种宝库，分类排序），core 纯函数 `selectVaultTarget` / `diagnoseVaultIdle` 决策（优先不详宝库 / 缺因通知），mc 只做副作用
- **长动作 = 协程式 Action**（Promise await）：导航等异步叶子内部自检查取消条件；引擎层防重入
- **三态语义**：success / failure / running（保持待续）；装饰器改变子节点结果或重试语义

**宝库任务决策树**（参考示例）：
```
Selector（每 tick 重评）
├─ 开箱：有目标 + 距离近 + 交互冷却过 → interactVault（总量基准回读，持续点击不放弃）
├─ 寻路：有目标 + 距离远 → navigateToVault（协程，目标消失/停滞即弃）
├─ 感知：无目标 → sense + selectVaultTarget（**优先不详宝库**；失败冷却 40tick）
└─ idle：按 diagnoseVaultIdle 原因通知（缺钥匙/缺宝库/缺不详钥匙/缺普通钥匙——
    普通宝库只能用普通钥匙）
```

**劫掠任务决策树**（事件驱动黑板 + 树决策，语义 713e8da：零巡检/零恢复）：
```
Selector（每 tick 重评）
├─ 胜利处理：带村庄英雄效果且事件窗口内 → handleVictory（计胜+叠加主人+移除英雄）
├─ 喝瓶：无坏兆/袭击兆 + 有药水 → drinkBottle（协程；无瓶自动关模式）
└─ 等待：袭击中静默 / 无药水通知（diagnoseRaidIdle）
```
- 事件感知：`effectAdd` 订阅（McRaidPorts）更新 `lastHeroTick` + 触发公共信号（raidStarted/raidVictory）+ **一次性卡死提醒**（1 分钟后仍带兆头仅发消息）；树每 10 tick 经 `sense()` 读取——袭击等待（分钟级）零轮询负担
- 胜利处理幂等：`handledHeroTick` 防 removeEffect 失败重复叠加；事件窗口 20 tick 防过期残留重复处理

**新任务接入指南**：① `core/tasks/XxxTask.ts` 定义感知快照 + 端口接口 + 树装配（复用 core/ai 节点）；② `mc/tasks/McXxxPorts.ts` 实现端口（世界副作用）；③ BotBrain 注册任务（tickXxxBrain + reconcileXxxBrains + startBrainEngine 标签分发）；④ `tests/` 注入 Fake 端口断言场景序列。核心约束：core 零 @minecraft、决策可单测、mc 只做副作用。

### 依赖纪律（core 层强约束）

- **core 零 `@minecraft/*`、零 `@yinxe/toolkit` 导入**（grep 校验 + tsconfig.test.json 单独编译进 node 测试双重兜底）
- core 类型本地化：`Vector3/Vector2` → `Vec3/Vec2` 数值接口；`EquipmentSlot` 枚举 → 字符串槽名（mc 边界经 `adapters/EquipmentSlots` 转换）
- 领域事件负载只用可序列化 string/number，不携带 mc 对象
- 端口（`BotStore`/`IntervalScheduler`）定义 + InMemory 实现在 core，mc 层实现同接口；core 服务构造注入端口，不自行 new 外部依赖

### 测试纪律

- core 纯逻辑必须有单测（node:test，`pnpm run test:core`）
- mc 适配/UI/交互层改动靠游戏内冒烟（不进 node 测试）

---

## 关键约定

### 消息着色
```
§a = 绿色（成功）   §c = 红色（错误）     §e = 黄色（假人名）
§7 = 灰色（辅助）   §b = 青色（状态变更）  §f = 白色（坐标）
```

### 命令
- 前缀 `mp:`（如 `/mp:create`, `/mp:list`）
- 在 `system.beforeEvents.startup` 注册
- 受限 API 用 `system.run()` 包装

### 假人命名（1.2.4）
- 全入口统一 `normalizeBotName`：去空白 + 无前缀自动加 `$`（"刷铁机" → "$刷铁机"，防与未上线真人撞名——真人默认名不带 $）
- `isValidBotName`（规范化后完整名）：非空、≤16 字符、不含 `:inv:` / `:equip:`（旧 DP 槽位 key 兼容）
- 创建/重命名双重真人冲突检查：输入原始名 + 规范化完整名都查 `isNameOccupiedInWorld`

### UI 事件驱动（1.2.6，BotUiEvent 双领域事件）
- **UI 只发布事件，零功能 import**：ui/bot.ts 面板按钮 → `BotUiEvent.panelAction.trigger({playerId, botName, action})`（14 动作）；ui/tags.ts 行为菜单提交 → **① setTags 先落库 ② 发布 `behaviorSubmitted`**（负载带表单快照 + tags）——订阅方按事件负载或 record.tags 判断结果相同，无时序依赖
- **功能模块各自 `registerUiSubscriptions()` 分散订阅**（sneak/spawnMode/useItem/onlineBot/teleport/spawnPoint/rename/killBot/follow + ui swap/mainhand/reclaim/tags/trident/tridentClaim/move + commands/data 共 17 个），`bootstrap/uiDrivers.ts` 统一装配（esbuild bundle 可达）
- setTags 不放事件（避免重复发布重复执行）；`syncEntityTags` 唯一实体同步渠道（自动 diff 增量）
- AI 任务的 UI 反馈订阅（宝库/劫掠不在线提示）在 `mc/ai/BotBrain.startBrainEngine`（引擎启动时注册）；create/online/menu/adminMenu 保持直接调用不事件化（UI 内部导航/纯展示例外）
- 表单布局：自动重生置顶 → 强加载第 2 → 潜行/使用物品/自动跳跃/自动跟随/劫掠 → 互斥行为下拉（仅选一项）；标签计算走 core 纯函数 `computeTagsFromBehaviorForm`

### 测试维度与常加载（1.2.0~1.2.3）
- 自定义维度 `mockplayer:test`：startup 事件注册（`registerTestDimension`，事件外抛错）+ worldLoad 后 `getDimension` 验证（失败回退 normal）
- 装置初始化（`bootstrap/gametestContext.ts`）：**结构方块必须位于 0,0,0**（强加载假人扭头完全正常的前提）；y=-1 层 5x5 草坪 + (0,-1,-3) 物化 + (1,0,-1) runthis 复用（不重复物化）；createTickingArea 4 区块列（覆盖负坐标）→ getBlock 探测 → 初始化完移除（运行中 GameTest 保持常驻）；register 后 40t 就绪延迟 + 物化重试 3 次；保存/恢复被篡改的游戏规则
- **常加载限制全解除**：chunkload 假人姿态/扭头/投掷三叉戟/宝库模式与 normal 完全一致（生成流程统一骨架 makeSpawnResult，差异仅生成 API 与生成点）

### 标签系统
- 共存标签：`bot` / `respawn` / `autoJump`
- 互斥标签：`idle` / `autoMine` / `autoPlace` / `autoAttack` / `control` / `autoUse` / `vaultMode`
- 独立开关标签：`raidMode`
- 新假人默认：`bot` + `respawn` + `idle`

### 持久化（McBotStore 实现 BotStore 端口）
- **记录**（BotRecord）：`world.setDynamicProperty` 单条 JSON（`mockplayer:players:<name>`）
- **绑定表**（StorageBinding）：独立 key `mockplayer:players:<name>:bind`（与记录解耦，记录覆盖不影响绑定；对象结构 key-value）
- **物品**（背包 36 格 + 装备 5 槽）：存 **`@yinxe/nbt-data-storage` 木桶阵列**（**自定义测试维度 `mockplayer:test` 锚点 (16,0,16) `baseY:0`**——baseY 显式指定（默认 120 悬空、anchor.y 被忽略），与装置 (0,0) 区块列相邻不重叠，玩家不可达；旧末地数据经 storageOf 绑定表 regionId 跨区域兼容）——**真实 ItemStack 完整 NBT**，潜影盒/收纳袋内容随物品原样存取
- **双向绑定**（`core/storage/Binding.ts` 纯逻辑 + `McBotStore` 维护）：
  - 首次写某格 → `region.put(item)` 分配槽位 → `storageBinding` 记录 slotId（惰性分配，复用库分配/回收语义，绝不与他人冲突）
  - 后续写该格 → `region.overwrite(slotId, item)` 原位覆写（slotId 不变）
  - **空位写占位**（`minecraft:structure_void`）**保持绑定**——槽位一旦绑定永不释放（存储永远是该假人的背包备份镜像），占位是真实物品（put 分配器探测为占用不会分给别人）；恢复时按 typeId 跳过占位
  - 读取格 → `region.get(slotId)`（O(1) 克隆）
  - 绑定表随记录持久化 → **改名零数据迁移**（旧 DP 槽位 key 迁移代码已删）；**仅删除假人（removeInventory）时 take 释放全部绑定槽**
- 无 `storageBinding` = 旧版记录/未绑定：`loadInventory` 返回 undefined（"无存档"契约），首次写时自动分配并清理该假人旧版 DP 背包 key（作废数据，不迁移）
- Entity `addTag` 不持久化，从 `BotRecord.tags` 恢复
- 恢复标记（BotRegistry.restoredBots）：防 spawnSimulatedPlayer 空背包覆盖持久化数据

### 库存存储（`mc/features/inventoryStorage.ts`，独立模块，事件驱动）
- **背包单格**：playerInventoryItemChange 薄壳 → `saveInventorySlot`（isRestored 守卫 + 变化日志；put 分配/overwrite/占位）
- **装备单槽**：`BotEvents.botEquipSlotChanged` 领域事件（**槽位粒度**，`core/events/DomainEvents.ts`）→ `handleEquipSlotChanged`：读实体该槽 → 与**内存指纹快照**（typeId|amount|damage|nameTag）对比 → **变化才覆盖写**（受伤但没变零写入）
  - 触发源：互换副手→仅 offhand；互换装备→仅 head/chest/legs/feet；穿卸甲→对应槽；**假人受伤（entityHurt）→ 全部 5 槽**（不判断掉血，护甲吸收也算，装备耐久可能损耗）
- **对账式兜底** `reconcile(player, record)`：读实体全部槽 → 指纹对比 → **只写变化的格/槽**（不再全量重写 41 格）——死亡（entityDie，事件驱动唯一盲区：掉落过程无事件）/下线（offlineBot）/离开（playerLeave）/回收前（reclaim）调用
- **恢复** `restoreInto(player, record)`：playerJoin / /mp:recover 复用（真实物品直写，占位跳过，恢复后同步指纹）
- vaultMode 周期**不再** saveFullState（钥匙消耗已实时保存）——事件驱动已覆盖在线变化，全量保存仅剩回收/互换背包等低频业务场景

### 死亡物品存储（entityDie = 数据存储时机点，事件驱动）
- **语义**：entityDie 回调时实体已处于死亡最终状态——普通物品已按游戏规则掉落（掉落物是物品离开假人的**唯一副本**），`keepOnDeath`（自带死亡不掉落）的物品仍在背包中。
- **做法**（全事件驱动，无对账保存）：
  - 背包：死亡掉落触发 `playerInventoryItemChange` → 实时单格保存（掉落 → 槽写占位；keepOnDeath 保留 → 无变化零写入）
  - **装备（4 槽 + 副手）：死亡掉落没有原版事件 → entityDie 显式触发全部 5 个 `botEquipSlotChanged`（via: "death"）** → 订阅方读死亡实体装备（deadEntity 组件仍可访问）→ 指纹对比保存——无论是否掉落（keepInventory 开启装备保留 → 指纹无变化零写入）
  - 经验：直接捕获写 record
- **竞态防护**：`record.death = true` 在保存**之前**设置——关闭 100tick 周期保存的窗口（behavior 引擎跳过死亡假人）。
- 正确性前提（由 `tests/inventory-lifecycle.test.ts` 锁定）：实体最终状态 = 引擎掉落后状态；若实测发现引擎在 entityDie 之后才掉落，需重新评估。

### 保存协调器（`mc/bootstrap/save.ts`，所有持久化**写**的唯一入口）
- 读操作（loadRecord/loadInventory/loadEquipment）直接走 `botStore`；**写操作一律走 `saveCoordinator`**，禁止直接调 botStore 写方法或 botRegistry.save
- 方法：`saveRecord`（记录写穿，周期路径 silent）/ `saveSlot`（背包单格，**带"什么变了"变化日志**）/ `saveInventory` / `saveEquipment` / `saveEquipSlot`（装备单槽，事件驱动）/ `saveFullState`（**物品对账 reconcile + 经验 + 记录**，含 isBotRestored 守卫）/ `removeInventory`
- 集中收益：恢复标记守卫、变化日志、静默策略、防刷物校验全部单点维护

### 保存时机点矩阵

| 时机 | 写什么 | 入口 |
|------|--------|------|
| 背包单格变化（playerInventoryItemChange） | 单格 + 变化日志（beforeItemStack） | saveSlot |
| 100tick 周期（behavior） | 位置/经验（silent）+ 装备（silent） | saveRecord / saveEquipment |
| 下线（offlineBot） | 背包+装备+经验+记录 | saveFullState |
| 死亡（entityDie，**存储时机点**） | 实体最终状态（有什么存什么） | saveFullState |
| 离开兜底（playerLeave） | 尽力保存 | saveFullState |
| 在线回收前（reclaim） | 全量 | saveFullState |
| 回收（在线/离线） | 转移后的剩余 | saveInventory/saveEquipment/saveRecord |
| 互换背包/装备（ui/equip） | 互换后状态 | saveInventory/saveEquipment/saveRecord |
| 创建/上线/重生/改名/标签/潜行/传送/重生点/劫掠开关 | 记录 | saveRecord |
| 删除/回收清空 | 背包+装备清理 | removeInventory |
| 配置修改（管理员菜单） | mockplayer:config | configStore（写穿） |

---

## 玩家隔离与权限

### 主人（ownerName）
- `BotRecord.ownerName` = 创建者玩家名（玩家重连实体 ID 会变但 name 稳定，**只存 name 不存 ID**）
- 存量假人无 ownerName = 无主，仅管理员可管理；无主假人不参与下线联动/认主/配额
- 假人面板显示主人；改名（rename）不影响 ownerName

### 管理员判定（`mc/commands/auth.ts`）
- `isAdmin(player)` = OP（toolkit `canManage`）**或** 配置名单 `config.admins` 内玩家
- `canManageBot(player, record)` = isAdmin 或 record.ownerName === player.name
- 权限应用：假人面板入口（ui/bot.ts）、在线管理 toggle（ui/online.ts）、全部修改类命令（delete/kill/control/sneak/tag add-remove/setrespawn/tp/tphere/move/offline/online/reclaim/follow/trident/recover）；只读命令（list/data/tags list）不限

### 配额（`core/service/QuotaRules` + `McConfigStore`）
- 全局配置单键 DP `mockplayer:config`：`{ defaultQuota: 5, quotas: {玩家: 数}, admins: [] }`
- 每玩家配额 = `quotas[name] ?? defaultQuota`；0 = 禁止创建；**管理员（OP 或名单）豁免配额**
- 配额按主人名下现存记录数（含离线）统计；删除/回收释放名额
- 管理员菜单：`/mp:admin` 或主菜单"⚙ 管理员菜单"（仅 isAdmin 可见）

### 下线联动
- 真实玩家 playerLeave → 该 ownerName 名下全部在线假人 `offlineBot` 安全下线（events/playerLeave.ts）
- 假人 playerLeave 走原假人路径（registry 命中），不受联动影响

---

## 投掷物双任认主（三叉戟/箭）

### tag 约定（`core/items/TridentClaimRules`）
- `mp:owner:<name>` — 第一任主人（实际投掷者，玩家或假人皆可）
- `mp:owner2:<name>` — 第二任主人（仅假人，可被后续假人覆盖复写）
- **不兼容旧格式 `mp:trid:<name>`**（旧三叉戟 tag 失效，不做迁移）
- 覆盖投掷物 typeId：`minecraft:thrown_trident` + `minecraft:arrow`（arrow 含药水箭，API 无法细分）

### 双认主机制（`mc/features/tridentTracker.ts`）
1. **投掷即标记**：entitySpawn 时以投射物 owner（投掷者）打第一任 tag（假人投掷 → 第一任即该假人）；反查表（entityOwnerMap，entityId→假人名）优先解析投掷者（实体无 name 兜底）
2. **fallback 认主**：entityLoad 时按优先级认主——**第二任在线 > 第一任在线**（`resolveClaimOwner` 纯函数）；都离线不动等上线夺回
3. **上线夺回**：假人上线（playerJoin/playerSpawn）→ `rebindBotTridents`，**先按优先级计算最优 owner，只有最优是自己才重设**（避免抢走"第二任是其他在线假人"的投掷物）
4. **下线回退**：假人下线（offlineBot/entityDie 死亡下线/playerLeave 兜底）→ `releaseBotTridents`，名下第二任=自己的投掷物**回退认主第一任**（第一任在线才认），避免 owner 悬空丢击杀经验；tag 保留，上线后 rebind 夺回
- rebind/release 扫描经 `findProjectilesByTag`（遍历 `TRACKED_PROJECTILE_IDS` 分类型查询），三叉戟与箭统一覆盖

### 认主领域事件（`core/events/DomainEvents`）
- `tridentClaimed`：所有认主动作完成触发（via: spawn/load/rebind/ui/offline-fallback，负载含 tridentId/claimedBy/第一二任）
- `tridentOwnerChanged`：**第二任覆盖复写时触发**（1任→2任 或 2任→新2任；负载含 firstOwner/previousSecondOwner/newSecondOwner）
- 生产端：tridentTracker（spawn/load/rebind/offline-fallback）+ tridentClaim（ui）；订阅方做通知/统计/联动

### 假人生命周期事件（`core/events/DomainEvents`）
- `botOnline`（加入世界/实体重建上线）/ `botOffline`（主动下线/死亡下线/离开兜底）/ `botDeath`（死亡标记，含位置）/ `botRespawn`（死亡重生）
- 生产端：playerJoin（botOnline）/ playerSpawn（botRespawn）/ entityDie（botDeath + 死亡下线 botOffline）/ offlineBot（botOffline）/ playerLeave（botOffline，幂等）
- **订阅驱动**（业务模块不硬编码互相调用）：
  - tridentTracker 订阅 botOnline/botRespawn → rebindBotTridents（夺回）；botOffline → releaseBotTridents（回退第一任）
  - 劫掠上线/重生续喝由 AI 引擎接管（树每 10 tick 按标签驱动，见编排层章节）

### 劫掠模式（`mc/tasks/McRaidPorts.ts` + `core/tasks/RaidTask.ts`，纯事件驱动 + 一次性提醒）
- 事件链：喝瓶（树）→不祥之兆（effectAdd → raidStarted 信号）→袭击胜利→村庄英雄（effectAdd → raidVictory 信号 + lastHeroTick）→树胜利处理（叠加给主人→移除英雄→自然喝下一瓶）
- ⚠️ **基岩版机制**：不祥之兆只持续 **30 秒**（0:30）——带兆头进入村庄才转化为袭击之兆（30 秒后袭击开始）；**30 秒内没进村庄 → 效果结束、袭击不触发**
- **一次性提醒双检查**（只发消息，零恢复动作）：
  - `scheduleBadOmenEndCheck`（喝瓶后 600 tick）：bad_omen 已结束且**未转化**（convertedToRaidTick 判定）→ 通知主人"**假人不在村庄范围内**，请带到村庄"
  - `scheduleRaidStuckCheck`（喝瓶后 1200 tick）：仍带 raid_omen（转化后袭击未开始）→ 提醒"请确认假人在村庄内且非和平难度"
- ⚠️ **语义（用户拍板 713e8da）：纯事件驱动，零巡检/零恢复机制**——袭击等待靠事件唤醒（树条件全 false 时等待分支无副作用）
- 喝瓶周期（用户规格 1.1.60）：**只在启动/胜利后喝**——黑板 `raidWaiting` 标记（drink 成功写、handleVictory 清），兆头消失也不重复喝
- 胜利处理幂等：`handledHeroTick` 防 removeEffect 失败重复叠加；喝瓶前防御清理残留村庄英雄（断 effectAdd 检测链兜底）
- 无药水自动关模式（disableRaidMode：移除标签即停用，树随后被引擎对账清理）
- 村庄英雄清除前 `grantVillageHeroToOwner` 叠加给主人：剩余时长相加、等级取高（`getEffect` 读 tick 后显式相加，不依赖引擎刷新语义）；主人不在线则不转移

### 假人行为事件（`core/events/DomainEvents`，`mc/events/botActions.ts` 生产端）
- `botMainhandChanged`（热栏槽位切换，含新主手物品）/ `botBlockBroken`（成功破坏方块，含方块/位置/破坏后物品）/ `botBlockPlaced`（成功放置）/ `botItemUsed`（成功使用物品）/ `botEntityAttacked`（造成伤害，含目标/伤害量）
- 生产端：订阅 playerHotbarSelectedSlotChange / playerBreakBlock / playerPlaceBlock / itemUse / entityHurt（damageSource.damagingEntity 是假人），全部过滤 BOT_TAG
- 新行为领域事件一律在此文件生产，订阅方只依赖领域事件

### 认主 UI（ui/tridentClaim.ts，面板"投掷物认主"按钮）
- 扫描假人 100 半径（当前维度）内**全部受跟踪投掷物（三叉戟 + 箭，分类型两次 getEntities 合并）**，过滤**自家**（第一/第二任 ∈ 家族集合 = 主人名 ∪ 主人名下假人名）
- **聚集分组展示**（`core/coords/Cluster.ts` `groupPointsByProximity` 纯函数）：同类型投掷物按**半径 3 格链式连通**聚为一组（A-B 邻、B-C 邻则 A/B/C 同组）；组按**组内数量降序**编号 —— **A01/A02...=三叉戟组、B01/B02...=箭组**（`GROUP_PREFIX`）
- 组内条目：图标（🔱/🏹）+ **展示名（自定义 nameTag/name 优先，否则"三叉戟"/"箭"）** + 附魔/耐久（`mp:item:` tag 解码，箭通常无编码 → 省略附魔段）+ 坐标 + **组内聚集概率**（组内邻居密度归一化，半径 3 判定，降序）
- 每条带认主状态徽标：✔ 已是本假人 / ⇄ 覆盖 {旧第二任}（`currentSecondOwner` 由扫描时解析 tag 提供）
- 批量 toggle 勾选 → 认主 = 写/覆盖第二任 tag + 重设 proj.owner（`claimTridents` 校验 `isTrackedProjectile`，三叉戟/箭均可认主）

### 认主集中汇报（`mc/features/claimReporter.ts`）
- 认主 / 回退 / 被覆盖等认主变更（load 认主、rebind 夺回、offline 回退、UI 认主与覆盖）**不再只有日志**：按目标真实玩家 + 假人聚合明细，同一 tick 内汇总为**一条**带 `[模拟玩家] 认主汇报` 前缀的多行消息（`queueClaimReport` → system.run flush），避免每把刷屏
- 汇报行（接收者视角，逐假人）：`· 假人A 认领 2 把三叉戟、1 支箭`（名下假人获得/夺回）；`· 假人B 回退 3 把三叉戟 → Steve`（下线降级回退第一任，`→ 你`=接收者重新获得）；`· 你的 2 把三叉戟被 假人C 认领（第二任）`（玩家投掷物被认走）；`· 假人D 的 1 把被 假人E 覆盖（第二任）`（名下假人被顶替）
- 投掷即标记（entitySpawn 首任 tag）属正常投掷行为，**不汇报**；UI 操作者已有表单结果直接消息，汇报排除操作者防重复

---

## 领域事件全景（13 个，负载全部可序列化）

```
生命周期：botOnline / botOffline / botDeath / botRespawn
认主：    tridentClaimed / tridentOwnerChanged
劫掠：    raidStarted / raidVictory
行为：    botMainhandChanged / botBlockBroken / botBlockPlaced / botItemUsed / botEntityAttacked
```

### 聚合导出约定
- 统一走 `BotEvents` 命名空间（`core/events/DomainEvents.ts` 内聚合对象，PascalCase 风格；core barrel 亦导出）：
  ```ts
  import { BotEvents } from "../../core";   // 或 "../../core/events/DomainEvents"
  BotEvents.botOnline.subscribe((e) => { ... });
  ```
- 事件类型按需单独导入（如 `import type { RaidVictoryEvent } from ".../DomainEvents"`）
- 生产端：生命周期（playerJoin/playerSpawn/entityDie/offlineBot/playerLeave）、行为（`mc/events/botActions.ts`）、认主（tridentTracker/tridentClaim）、劫掠（McRaidPorts effectAdd 订阅）、宝库（McVaultPorts 开箱成功）；新领域事件一律经 BotEvents 聚合导出

## 踩坑记录

见 `BLACKLIST.md`（处理 spawnSimulatedPlayer、lookAtLocation、death/respawn 事件顺序、beforeEvents 权限限制等坑点）。

---

## 依赖版本

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.6.0（根 overrides 收敛 2.8.0） |
| @minecraft/server-ui | 2.0.0 |
| @minecraft/server-gametest | 1.0.0-beta.1.26.0-stable |
| @minecraft/math | 2.2.7 |
| @minecraft/vanilla-data | 1.26.20 |
| @minecraft/core-build-tasks | 5.5.0 |