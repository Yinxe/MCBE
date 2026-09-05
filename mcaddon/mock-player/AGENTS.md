# MockPlayer — 模拟玩家

Minecraft Bedrock 模拟玩家（假人）Add-On，TypeScript + Minecraft Script API。

> 通用代码规范请参考根目录 `CLAUDE.md`。

---

## 开发命令

```bash
just-scripts build / mcaddon / local-deploy / lint / clean
pnpm run test:core   # core 单测（tsc -p tsconfig.test.json → node --test）
```

---

## 架构（顶层目录语义）

```
scripts/
├── main.ts                    # 4-Phase 启动装配（组合根，只装配不写业务）：startup 注册
│                              #   命令/测试维度 → worldLoad 恢复持久化 → 数据迁移 →
│                              #   标签行为引擎 → 三叉戟/钓鱼钩/战利品追踪 → 劫掠模式 →
│                              #   任务注册 + 任务运行时（workMode → 任务协程，事件驱动）
├── bootstrap/                 # 启动初始化（装配 + 统一入口 + 迁移）
│   ├── context.ts             # 运行时装配上下文：mc 层单例（botRegistry / botStore /
│   │                          #   configStore / saveCoordinator / inventoryStorage / botLifecycle + lifecycleContext）
│   ├── save.ts                # SaveCoordinator：全部持久化**写**的唯一入口
│   ├── migration.ts           # 数据迁移（旧版本升级通道，幂等）
│   └── uiDrivers.ts           # UI 领域事件订阅装配（各模块 registerUiSubscriptions 聚合）
├── bot/                       # 假人 OOP 封装（基于机器人的面向对象）
│   ├── Bot.ts / BotCore.ts    # Bot 类：能力即方法（navigateTo/swapMainhand/...）；
│   │                          #   BotCore = 纯逻辑基座（可单测），Bot = mc 委托扩展
│   └── PlayerGateway.ts       # SimulatedPlayer 解析唯一入口（含缓存/名称占用/区块检测）
├── errors/                    # 自定义异常体系（BotError/ActionError/CancelledError/
│                              #   FlowError + describeError）——basic 动作统一错误通道；
│                              #   引擎异常内部消化转 ActionError（reason 码 + cause 根因）
├── runtime/                   # 任务运行时（事件驱动，替代旧 10 tick 生物 AI 引擎）
│   ├── BotTask.ts             # BotTask 契约（timed/event/natural）+ BotTaskManager
│   │                          #   （workMode 对账：启动/停止/切换，每假人至多一个任务）+
│   │                          #   startBotTaskRuntime（botWorkModeChanged/上下线/死亡
│   │                          #   事件驱动，零常驻轮询）+ 共享记忆过期扫描
│   └── SharedMemory.ts        # 跨假人共享记忆（TTL：fixed 定时 / renewing 延长默认；
│                              #   独立每秒扫描）——共享钓鱼点池/树资源池的存储层。纯 TS 可单测
├── events/                    # 事件订阅与事件声明（薄壳，生命周期已内聚至 lifecycle）
│   ├── DomainEvents.ts        # BotEvents 领域事件（生命周期/认主/行为/标签/工作模式）
│   ├── EventSignal.ts         # 事件信号实现（core 零依赖）
│   ├── UiEvents.ts            # BotUiEvent（UI 只发布事件，零功能 import）
│   └── *.ts                   # world 事件订阅薄壳（itemUse/playerInteract 等非生命周期；playerJoin/Leave等已迁移）
├── lifecycle/                 # 假人生命周期编排（OOP + 事件驱动，组件化）
│   ├── BotLifecycle.ts        # 编排器：per-bot队列/hook调度/事件广播，组件通过 DI 注入
│   ├── LifecycleContext.ts    # DI 容器：registry/store/config/save/inventory/reconnecting
│   ├── LifecycleEvents.ts     # 生命周期领域事件（before/after/fail + auxCompleted）
│   ├── LifecycleComponent.ts  # 组件接口：id/priority/onRegister/10+生命周期钩子
│   └── components/            # 单一职责组件（按 priority 升序执行）
│       ├── QuotaComponent(10) / NameGuard(11) / Spawn(20) / Session(30) / Death(40)
│       ├── Inventory(60) / Position(70) / TickingArea(80,共享排队+单块保活) / AutoOnline(85) / Cleanup(90) / Logging(200)
│       └── SharedTickingQueue # 共享常加载队列（单名 mockplayer:aux:shared，FIFO，用完即释）
├── features/                  # 核心功能封装（副作用层，生命周期相关已薄壳化至 lifecycle）
│   ├── basic/                 # 基础**原子性**功能（单动作不可细分）：blocks（破坏/放置）/
│   │                          #   items（背包/主手/使用/装备）/ fishing（发杆/收竿）/
│   │                          #   control / move（导航，发布 botMoved 事件）/
│   │                          #   PositionTracker（DEPRECATED→PositionComponent）/
│   │                          #   PoseGateway（体态）/ sneak / teleport / EntityTags。
│   │                          #   ⚠️ 动作统一契约：async + runActionNextTick（system.run
│   │                          #   下一 tick 执行，成功 resolve(true)，引擎异常内部消化
│   │                          #   转 ActionError）；读函数保持防御默认值不参与异常
│   ├── manage/                # 假人生命周期管理（DEPRECATED薄壳，委托 botLifecycle；保留 create/delete等兼容）
│   │                          #   单例辅助（auxiliary→TickingAreaService）/ spawnMode→SpawnComponent / gametestContext
│   ├── flow/                  # **工作流（flow）**：单次编排（fishingFlow 钓鱼流程 /
│   │                          #   woodcutFlow 单树砍伐 / pickupFlow 磁吸拾取 / treeScan 扫描壳 /
│   │                          #   fishingHookTracker 感知基础 / raidMode 事件驱动劫掠）+
│   │                          #   tasks/（循环任务：timed 定时 mine/place/attack；
│   │                          #   natural 自然流程 wander/fishing/woodcut——共享池在
│   │                          #   rules/FishingPool 与 rules/woodcut/TreePool）；barrel 统一出口
│   ├── state/                 # 行为引擎（behavior：体态控制+周期持久化）+ 跟随兼容门面（follow）+ 标签渠道（setTags）
│   ├── trident/               # 三叉戟 mc 副作用（投掷/认主标记/上线夺回）
│   └── inventoryStorage.ts    # 库存存储（DEPRECATED订阅已迁移至 InventoryComponent，存储实现保留）
├── interaction/               # 交互层：命令 + UI
│   ├── commands/              # /mp:* 命令注册（lifecycle / navigation / behavior /
│   │                          #   activity / inspect / system）
│   └── ui/                    # ActionForm 面板（bot / panels/*）+ menuTrigger 单例（木棍唯一注册）+ 格式化 / 帮助
├── rules/                     # 规则模块（纯逻辑，零 @minecraft 可单测）
│   ├── coords/ items/ format/ tags/ tree/ utils/ xp/
│   └── FishingRules / RaidRules / Types
└── service/                   # 服务模块（core 纯逻辑 + 端口）
    ├── BotRegistry / BotVisibility / QuotaRules / ReclaimPlanner /
    │   RecordMigration / ModConfigRules
    └── port/                  # 端口定义（BotStore / IntervalScheduler / Binding）+
                               #   mc 实现（McBotStore / McConfigStore / LegacyCodec）
```

### 纯/副作用分层界限（tsconfig.test.json 权威）
- **可 node 单测（零 `@minecraft/*`、零 `@yinxe/toolkit` 导入）**：`errors/`、`rules/`、`service/`
  （含 port 接口）、`bot/BotCore.ts`、`runtime/SharedMemory.ts`、
  `events/DomainEvents + EventSignal + UiEvents`
- **mc 副作用层**：`bootstrap/`、`features/`、`runtime/BotTask.ts`、`interaction/`、
  `bot/Bot.ts + PlayerGateway`、`events/` 订阅薄壳、`main.ts`
- 类型本地化：`Vector3/Vector2` → `Vec3/Vec2`；`EquipmentSlot` 枚举 → 字符串槽名（mc 边界转换）
- 领域事件负载只用可序列化 string/number；端口（BotStore/IntervalScheduler）接口 + mc 实现同界

### 测试纪律
- 纯层逻辑必须有单测（tests/*.test.ts，Fake/InMemory 替身断言场景序列）；mc 层靠游戏内冒烟

### 任务运行时（runtime/，替代已移除的生物 AI）
- **架构决策（用户拍板 2026-08-30）**：生物 AI 方案（感知-决策每 10 tick 高频计算）
  易导致游戏挂起崩溃，**整体放弃**；scripts/ai、features/ai、legacy/ai、rules/DefenseRules
  已删除。改为「任务运行时」：任务 = 纯 async 协程（CancelToken 协作式取消），
  **生命周期事件驱动**（botWorkModeChanged / botOnline / botOffline / botDeath → 对账），
  无任何常驻轮询
- **任务两类（flow/tasks，全部工作模式独立调度 loop）**：`timed` 定时触发的循环
  （mine/place/attack——连续动作节奏机）；`event` 基于事件的循环（raidMode 自订阅
  事件，独立模块）；`natural` 基于自然复杂流程的循环（wander/fishing/woodcut/follow）
- **统一规范（flow/tasks/spec.ts，用户拍板：循环任务禁止各写各的 while 面向过程）**：
  全部循环任务经 `defineLoopTask` 声明为**阶段机**——任务只写阶段表（每阶段 label +
  run(ctx)，返回下一阶段 id 或 TASK_DONE），运行骨架统一承担：循环分派（按阶段流转）、
  异常消化（warn + 退避重跑当前阶段，连续失败达上限终止）、流转日志（`阶段 find →
  navigate`，可排查卡点）、收尾（停动作 + cleanup 释放认领 + 收口令牌）。约定：
  节奏用 `ctx.wait(ticks)`（取消即唤醒）；阶段间状态放 `ctx.data`（createData 声明），
  不藏闭包；预期瞬态失败就地 warn，意外异常直接抛交骨架退避
- **每假人至多一个任务**（workMode 单选互斥天然保证）；同假人停止/启动经 per-bot 链串行
  （防切换竞态）；任务异常由运行时兜底记日志并终止，取消（CancelledError）静默收尾
- **任务自然完成（TASK_DONE）→ workMode 归零 "none"**（BotTaskManager 统一收口：
  持久化 + 日志；已切走其他模式则不动）——记录/UI 与实际一致，根治 reconcile
  空转重启秒退任务的状态漂移；取消退出（stop/切换/下线/死亡）**不**归零
  （任务只是暂停，模式保留等补启）。跟随目标字段写入必须在 setWorkMode 事件
  发布**前**完成（命令/UI 均按此顺序；followTask 对"目标字段迟到"另有短等容错）
- **跨假人共享数据**走 `SharedMemory` 全局单例（taskManager.shared，注入 ctx.shared）——
  共享钓鱼点池 `"fishing:pool"` / 树资源池 `"woodcut:pool"`（池键永不过期；
  认领/复活/新鲜度由条目级时间戳承担，见下）
- **统一资源模型（rules/resource/ResourcePool，用户拍板：共享/认领/扫描隔离机制
  只实现一遍，不同资源声明差异规则，杜绝共抢）**：泛型核心 + `PoolPolicy` 策略插件。
  统一状态机：`free →（claim 独占认领，带 claimedAt）→ occupied →（release）→ free`；
  `occupied →（markFail 连续失败达上限 / exhaust 放弃）→ unavailable`（墓碑：带
  unavailableAt，复活期后惰性复活；merge 同 key 保留——"移除"只用于资源真的没了）；
  `任意 →（remove 资源耗尽/消失）→ 池移除`。策略差异点：`keyOf`（定位键）/
  `centerOf`+`distance`（距离基准：钓鱼=站立点+水平，树=基座+3D）/`compare`
  （排序：钓鱼=星级降序→距离升序，树=距离升序）/`maxFailStrikes`（0=无失败标记）/
  `extraUsable`（如维度一致）/`claimLeaseTicks`（认领租期）/`unavailableTtlTicks`
  （墓碑复活期）/`dataTtlTicks`（free 新鲜期）。FishingPool / TreePool 是「策略 +
  类型化薄壳」；选点约束（center/maxDistance/isValid 现场回调/excludeKeys 排除集）
  与扫描合并（占用/墓碑保留，其余同 key 用扫描值刷新+打 scannedAt）为公共语义。
  ⚠️ **认领有效性 ≠ 池整体 TTL（2026-09 设计修正）**：认领是"持有者生命周期"的
  函数——读时惰性判定（`PoolReadOptions.nowTick` 时钟 + `holderActive` 任务活性
  查询：租约过期 / 持有者任务已不在跑 → 视为 free；持有者本人读自己恒可用），
  不靠整池 renewing TTL 续命（长作业 chop/fish 期间不写池，旧模型会丢认领导致
  双占；树池无现场校验兜底，损害全额兑现）。释放带占用者校验（`expectClaimant`，
  防误释他人认领）；预重扫回写只替换自己仍持有的条目（防 stomp-write）
- **任务能力增强（2026-09-03 用户规格：挖掘/放置/攻击/跟随完善）**：
  - **mine（⚠️ 无意识挂机语义，2026-09-03 用户拍板）**：用户预先调整好假人
    姿态与视角（控体态/转头）后开启——**视角 = 任务输入，任务绝不改动姿态/视角**
    （`breakBlockOnce skipLook: true`——不 faceTowards 不扭头，与"智能挖掘会
    自己瞄准"的本质区别）；沿当前视线射线持续挖：probe 每轮重读视线第一块
    实心方块，挖穿后射线自然伸到下一块（连续挖掘）；视线被插方块遮挡 →
    blocked 回探测沿新视线挖（不隔山打牛）。工具策略保留（引擎版）：
    `ensureTool` → decideTool(MINE_TREE)；`expectedTypeId` 定点守卫
    （changed 回探测重选，绝不挖类型不符方块）
  - **place**：主手方块自动补位——主手空/不可放置（`BlockTypes.get(typeId)` 判定）→
    从背包找第一个可放置方块换上；背包没有 → 通知 + 低息等待
  - **attack**：probe（`getEntitiesFromViewDirection` 视线最近实体）→ strike
    （`attackEntity` 定向连击同一目标，失效/击杀回探测）；武器策略
    （rules/items/MineToolRules：剑 > 同品阶斧 + 锋利加分）
  - **follow**：收编任务运行时（follow/catchup 两阶段：寻路跟随 + 近距守候，
    全程 `lookAtEntity` 注视——BUG2 语义保留）；目标持久化
    `record.followTargetId/followTargetName`（ID 失效按名重找，重启恢复）；
    目标离线/超距 128 格 → 自然完成；trident 投掷期 `pauseFollowTask/
    resumeFollowTask` 协作（任务自旋等待不寻路）；旧 state/follow 的
    10 tick 共享轮询引擎（followMap + 常驻 runInterval）已删除，文件仅剩兼容门面
- **原子工具（flow/tasks/loops）**：waitTicksCancellable（取消即唤醒）/
  createThrottledNotifier（附近 16 格玩家通知节流）
- ⚠️ `@yinxe/workflow`（packages/workflow）**未接入**也不计划接入：毫秒延迟/独立取消
  令牌/步骤粒度与游戏 tick 语义不匹配（适配壳即仪式感）；包保留在仓库供将来
  非游戏绑定的离散步骤编排使用

### 目录语义与定位修正（用户拍板；✅=已办，其余待重构）
| 目录 | 现状 | 定位判定 |
|---|---|---|
| `features/task/` | ✅ 已改名 **`features/flow/`** | 概念 = **flow（流程）**——一组原子功能组合而成的工作流；fishingFlow 为范例 |
| 原子能力归位 | ✅ fishing.ts（发杆/收竿）已入 **basic** | 原子性功能应在 **basic**（如飞行 fly 原子能力 → basic；飞行 flow 才属 flow 模块） |
| task 内工具集 | treeScan（树资源坐标集扫描） | 规则/算法部分已抽 **rules/tree**（规则化已达成）；mc 扫描壳属 woodcut flow 的一部分，留在 flow |
| 生物 AI 移除 | ✅ scripts/ai + features/ai + legacy/ai + DefenseRules 已删除 | 高频计算致游戏挂起崩溃（用户拍板）；能力改写为 flow/tasks 循环任务 |
| `features/trident/` | 投掷 / 认主标记 / 上线夺回（mc 副作用） | 规则在 rules/items（TridentRules / TridentClaimRules）；本体属规则 + 工作流一小部分 |
| `features/inventoryStorage.ts` | 库存增量保存 + 对账兜底 + 恢复 | 位置不对，属数据/持久化层，待挪出 features |
| `features/state/` | behavior（体态控制+周期持久化）/ follow（兼容门面）/ setTags | behavior 仅保留控制模式同步与周期持久化；follow 调度已收编 flow/tasks/followTask（本文件只剩启停门面：写目标字段 + setWorkMode） |

---

## 关键约定

### 消息着色 / 命令
- 着色：`§a` 成功 / `§c` 错误 / `§e` 假人名 / `§7` 辅助 / `§b` 状态变更 / `§f` 坐标
- 命令前缀 `mp:`，在 `system.beforeEvents.startup` 注册；受限 API 用 `system.run()` 包装
- 面向玩家消息用中文；调试日志用英文；日志格式 `[MockPlayer] 消息`（console.warn）

### 假人命名
- 全入口统一 `normalizeBotName`：无前缀自动加 `$`（防与未上线真人撞名）；创建/重命名双重真人冲突检查

### UI 事件驱动（BotUiEvent 双领域事件）
- **UI 只发布事件，零功能 import**：面板按钮 → `panelAction`；行为菜单提交 → `behaviorSubmitted`（setTags 先落库再发布）
- 功能模块各自 `registerUiSubscriptions()` 分散订阅，`bootstrap/uiDrivers.ts` 统一装配
- 任务侧 UI 反馈（不在线提示等）在各任务模块内注册（features/flow/raidMode 等）

### 自定义异常体系（errors/，用户规格：动作消化引擎异常抛自定义异常）
- **basic 动作统一契约**：async + `runActionNextTick`（features/utils）——system.run 推迟
  下一 tick 执行、成功 resolve(true)；引擎异常**内部消化**转 ActionError（reason 码
  busy/far/blocked/offline/unavailable/failed + cause 根因），ActionError 原样透传不二次包装
- **BotError 家族**：`ActionError`（动作失败）/ `CancelledError`（取消——控制流信号，
  收尾静默不告警）/ `FlowError`（流程编排失败）；日志统一 `describeError(e)`
- **调用方约定**：await 感知结果或 void+.catch（未接住的拒绝=unhandledrejection）；
  结果枚举（NavigateResult / FishingOutcome / WoodcutOutcome / BreakResult / SwapResult）
  是**领域结果**不是异常——保持返回值语义，不强行抛出
- 读函数（hasFishingRod/inventoryContainerOf 等）保持防御默认值（false/undefined），不参与异常体系

### 工作模式（record.workMode，用户拍板）
- **互斥单选**：一个假人一个工作模式——none / wander（闲逛模式）/ mine（定点挖掘模式）/
  place（定点放置模式）/ attack（定点攻击模式）/ raid（劫掠模式）/ fishing（自动钓鱼模式）/
  woodcut（自动砍树模式）。互斥由单字段天然保证
- 各驱动模块按值认领（事件驱动，无轮询）：wander/mine/place/attack/fishing/woodcut →
  任务运行时（runtime/BotTask → flow/tasks 协程任务）；raid → 劫掠模块（事件订阅）；
  follow → 任务运行时（followTask）；none → 空档不启任务
- **修改唯一渠道 `setWorkMode`**：落库 + 发布 `botWorkModeChanged`（任务运行时/劫掠按值
  启动/停止）；UI 提交前先 setTags 校验通过再 setWorkMode（防部分应用）
- **管理员启用门槛**：工作模式还须在全局配置启用（configStore.isWorkModeEnabled，
  adminMenu 可开关）——任务运行时对账时双重校验
- **共享钓鱼点池选点规则（新版 workMode="fishing"，rules/FishingPool）**：
  假人只能从池里选**自身 16 格内**（SPOT_MAX_DISTANCE）且**点位半径 1 格内无
  其他实体**（现场实时判定 isSpotUsable）的有效钓鱼点；池内**有效点**不足
  下限（POOL_MIN_USABLE=3）→ 下次寻找的假人主动扫描发现新点并合并进池共享；
  align/navigate 失败的点进本轮排除集（防释放后重选回同一个坏点打转，钓到鱼清空）；
  三振出局的点立墓碑（复活期 10 分钟后惰性复活，不再"永不复活"）

### 自动砍树（新版 workMode="woodcut"）
- **共享树资源池（rules/woodcut/TreePool）**：所有砍树假人共用 SharedMemory
  `"woodcut:pool"` 池（池键永不过期）——一个假人发现的树全体可见；
  **只认领附近 16 格**（TREE_POOL_MAX_DISTANCE）、**多假人不抢夺**（claimTree 独占，
  读时活性判定防长作业丢认领双占）、认领前现场校验基座仍是原木（池数据陈旧
  的最后一道门；不在的树真移除+排除再试）、**砍光移除**（removeTree）/
  **放弃立墓碑**（exhaustTree：留顶剪枝的高树顶还在世界里，保留条目防重扫
  复活永动机，复活期后惰性复活）、可认领树资源不足（POOL_MIN_TREES=3）→
  主动扫描发现新树并合并进池共享（mergeScannedTrees，占用/墓碑保留）
- **砍伐前 7×7×7 重扫（features/flow/treeScan.rescanTree7x7）**：认领后以**树中心
  （底部坐标）**为中心 7×7×7 重扫圆木/树叶，`refreshTreeResource` 更新树资源清单
  并写回共享池，再生成计划（清单不失真）
- **单树砍伐计划（rules/woodcut/ChopPlan）**：分阶段——**树桩(1×2×1)→主干(底→顶，
  大树 4 列)→散落圆木(移到正下方破除)→[收集]全部树叶→卡叶清理**；拾取范围 =
  树中心 7×7 水平 + 整树高度
- **砍伐执行（features/flow/woodcutFlow）**：先导航到树中心附近移动进入 → 破树桩 →
  向上垂直砍主干（每根用 **breakBlockAt"直到破坏方块"模式**：看向目标 + 持续挖到被破坏）；
  目标**超出挖掘距离**（far）→ **移动到目标正下方缩短距离再挖**；**任何移动前都
  停止正在挖掘的动作**（stopBreakingBlock）
- ⚠️ **定点破坏铁律（basic/blocks/blockBreak，根治"挖泥巴/挖坑"BUG）**：
  破坏执行只挖**目标坐标上类型已验证**的方块——`breakBlockAt` 不用视线射线替代目标
  （引擎 `SimulatedPlayer.breakBlock(location)` 本就按坐标定点破坏，射线替代是旧版
  根因：瞄准偏差命中地面 → 挖掉 → 视线跟随刚挖方块继续朝下 → 无限挖坑）；全程
  `expectedTypeId` 类型守卫（类型变化 → `changed` 不挖）。砍树流程破坏前另做
  `classifyTreeBlock` 木头/树叶 kind 校验（非木头绝不挖）；拾取卡叶破除同款树叶校验
- **收集模式树叶 fallback**：挖树叶前检查是否有合适树叶工具（剪刀/锄类/任意精准），
  **无则自动 fallback 圆木模式**（跳过树叶直接拾取，结果带回 fellBack 标记）
- **工具策略 = @yinxe/tool-strategy 引擎（2026-09-03 用户指引接入，替代三处
  自写加权评分——WoodcutRules.scoreAxe/scoreLeavesTool/pickBestTool、
  MineToolRules 全部已退役删除）**：
  - **rules/items/ToolStrategyTrees**：场景树编排——`MINE_TREE`（方块关键字 →
    镐/斧/锹/锄/剑档位）、`WOODCUT_TREE`（原木→效率斧 / 树叶→**档位手排**：
    精准锄>剪刀>任意精准>任意工具）、`decideWeapon`（剑>斧 + 锋利链）；
    `decideTool` 封装：耐久紧急候选排除 + 主手紧急强制换 + keep/swap 决策
  - **basic/items/ToolSnapshot.snapshotToolCandidates**：背包 profile 为引擎
    `ToolCandidate`（角色/品阶/耐久/附魔键映射 silk_touch→silk 等；非工具不入池
    ——BUG2 的"杂物兜底 axe"根因从数据层根除）
  - 引擎语义优势（此前加权评分表达不了）：**档位手排**（跨档交叉如
    `效率5铁斧 > 精准钻石镐 > 效率3铁斧`）、**附魔硬门槛**（require 等级区间）、
    **耐久维度**（sortBy durability + 紧急排除——快断工具不当选，此前完全没考虑）
  - 主手已最优 → keep 不折腾（BUG2 倒腾死锁天然消除：引擎 isCurrent 判定）
- **磁吸拾取（features/flow/pickupFlow.vacuumNearbyDrops，2026-09-03 用户规格——
  废弃旧"导航走近+等吸入"思路）**：砍树每棵树完成后、钓鱼每轮收竿后，扫描假人
  **半径 10 格**内感兴趣掉落物 → **teleport 到假人脚下** → 0.5 秒自动入包。
  零寻路零走动（旧思路导航逐个靠近——慢、卡地形、多目标来回跑）；旧
  runPickupFlow + rules/pickup/PickupPlan 已删除
  - ⚠️ **方块 id ≠ 掉落物物品 id**：树叶方块 oak_leaves 破坏掉的是**树苗
    sapling/苹果/木棍**——磁吸白名单必须按**物品 id** 列举（rules/woodcut/
    LootWhitelist：圆木本体+树苗+果实；rules/fishing/LootWhitelist：鱼获类）
- **砍树子模式枚举（运行时可选）**：`/mp:woodcutmode <bot> <logs|collect>` 持久化
  到 `BotRecord.woodcutMode`（缺省 logs），砍树任务每轮从记录读取
- **测试命令 `/mp:woodcut [radius] [mode]`**：扫描树资源并展示最近一棵树的砍伐计划
  （flow 诊断；mode=logs 原木模式 / collect 收集模式）
- **树扫描时机与节流（⚠️ 树坐标集扫描很贵 ~50ms ≈ 1 游戏刻）**：`find` 阶段只有当
  共享池里可认领树不足（< minPoolTrees）且**本会话还没扫过**时才**主动扫描一次**；
  这次扫描若没带来**新树**（没扫到/都在池里）→ 进 `exhausted` 终态：报告
  "自动砍树任务完成"并静止，**不再原地空扫描**；重新激活（切换 workMode /
  下线重连 → reset）才允许再扫一次

### 标签系统
- 标签 = 假人行为的持久开关（共存 COEXIST / legacy 组 LEGACY：宝库/钓鱼/control 等旧标签）
- **标签修改唯一渠道 `setTags`**（UI 命令全走它）：实体同步 syncEntityTags + 持久化统一 +
  发布 `botTagsChanged`；**标签驱动模块按需订阅**（替代旧引擎轮询对账）
- ⚠️ 互斥组 EXCLUSIVE / 独立开关组 STANDALONE 均已清空（行为/劫掠收编进工作模式）

### 物品组件类型化读取（ItemComponentRead）
- mc 层**共享工具** `features/basic/items/ItemComponentRead.ts`：收敛 durability /
  enchantable / inventory 组件的类型化读取（`readDurability` / `enchantableOf` /
  `inventoryContainerOf`）
- `@minecraft/server` 的 `getComponent<T>(id)` 按组件 ID 泛型映射到精确类型
  （ItemComponentReturnType<T>）——常见组件读取**无需 `as any`**，尽量复用本工具
- ⚠️ 特殊绕行保留：`getComponent("minecraft:effects")` 类型 map 缺 key（用局部接口）；
  SimulatedPlayer 特有方法（`setSpawnPoint` / `resetLevel` / `getBlockFromViewDirection`）
  需 `as any`；旧存档迁移探针 `(record as any).aiBehavior` 属合理惰性类型

### 持久化
- **所有持久化写经 `SaveCoordinator`**（唯一入口，禁直接写 store/registry）
- 背包/装备事件驱动增量保存（playerInventoryItemChange + 槽位事件）；死亡 = 存储时机点"有什么存什么"
- 数据迁移 `runMigrations` 为旧版本升级通道（记录归一化 + 旧 DP → NBT）

### 上线/下线/辅助常加载（详见 `docs/bot-lifecycle-tickingarea.md` 权威梳理）

- **上线 `safeOnline`**（唯一入口，永不 reject）：`checkOnlineQuota`（同时在线配额，管理员豁免）→ per-bot 队列串行 → `rawOnline`（`spawnBot` 全量走 `test.spawnSimulatedPlayer(0,8,0)` 中转再 `teleport` 目标，三层重名防护：`waitNameFree` 轮询+幽灵清理→串行锁→生成后 `bot.name` 校验重试，GameTest 未就绪回退模块直生）→ 非宝库则 `createSim4Area(mockplayer:aux:<name>, circle r=4, 圆形49块 4+1+4)` 常驻 → `delay 2t` 后 `sampleAndSendAscii` 几何渲染私信主人；`playerJoin` 再 `restoreInto` 真 ItemStack 回写 + `markRestored` + `botOnline` 事件
- **下线 `safeOffline`**（永不 throw）：宝库直落 `rawOffline`；非宝库先 `createSingleChunkArea(mockplayer:aux:<name>, Manager单chunk,255并发校验)` 预占位 → `rawOffline`（保存 `lastPoint/isSneaking` + `saveFullState(对账式指纹只写变化)` + `disconnect` + `saveRecord` + `botOffline`）→ `delay cooldown(1-5s可配)` 后 `removeSingleChunkArea` 幂等卸载；`playerLeave` 幂等兜底（`!online` 或 `entityId!=event.playerId` 跳过旧实体）+ `ownerOfflineAutoOffline` 联动
- **辅助双域隔离**：`Sim4`（`tickingArea/sim4.ts`，命令 `tickingarea add circle 4`，圆形49块 4+1+4，中转后常驻，上线后刷新） vs `SingleChunk`（`singleChunk.ts`，`Manager.createTickingArea` 单 chunk 矩形，255块列容量，下线前占位延迟卸载）；同名 `mockplayer:aux:<name>` per-bot，旧固定名已废弃；`auxiliary.ts` 单源：`isVaultMode/perBotQueue/cooldown/sampleAscii`（几何渲染，已修 `getBlock` 强拉载污染）
- **GameTest 装置**（`gametestContext.ts`）：`startup registerCustomDimension(mockplayer:test)` → `worldLoad initGameTestContext` `system.run` 40t后 `createEmpty void + register keepalive(maxTicks 2e9)` → `startGameTest` 创4区块列tick→ `getBlock(0,0,0)` 监测结构方块→ `runthis` 复用或 `buildGrassPad(5×5)`+`gametest run` 物化重试3次，几何必须 0,0,0（执行点 0,-1,-3+草坪y=-1）；初始化后移除 ticking 由 GameTest 保持常驻
- **重连 `safeReconnect`**：`reconnectingBots` 抑制消息 → `system.run(safeOffline+onOffline)` → `delay 1s` → `waitForNameAvailable` → `safeOnline+onOnline`；`autoOnline` 世界重启 60t后排队 `safeOnline` 失败置离线

---

## 玩家隔离与权限

- **主人**：`BotRecord.ownerName`（只存 name 不存 ID）；无主假人仅管理员可管理
- **管理员**：OP 或配置名单；`canManageBot` = 管理员或 owner 本人
- **配额**：每玩家配额（默认 5，管理员豁免）；按主人名下记录数统计
- **下线联动**：真实玩家 playerLeave → 名下全部在线假人安全下线

---

## 投掷物双任认主（三叉戟/箭）——自定义机制，非 AI 非工作流

- 纯事件驱动的世界机制（实体 tag + owner 归属），`main.ts` 直接 `initTridentTracker()` 独立初始化（幂等）
- tag 编码：`mp:owner:`（第一任投掷者）/ `mp:owner2:`（第二任认主者）/ `mp:item:`（附魔耐久编码）；规则层 `rules/items/TridentClaimRules` 零 mc 可单测
- 认主途径：spawn（投掷标记）/ load（加载回退）/ rebind（上线夺回）/ ui / offline-fallback（下线回退第一任）
- 领域事件 `tridentClaimed` / `tridentOwnerChanged`（唯一真源 DomainEvents）

---

## 劫掠模式（features/flow/raidMode.ts，事件驱动轻量模块——event 类任务范例）

用户拍板：劫掠只是"监听事件 → 喝药 → 监听事件 → 回药"的简单循环，**不配作为 task**
（旧 legacy/ai/RaidTask 行为树 + RaidPorts 端口契约已废除）。重写为纯事件驱动——
`effectAdd` 直接驱动状态流转：**无树、无端口、无 10 tick 感知轮询**。

循环（全部事件/时机驱动，零轮询）：
- ① 开启/上线/胜利后 → `startRaidCycle`：可喝（无兆头+有药水+未等待）→ 喝瓶协程
- ② 喝瓶成功 → 置 `raidWaiting`（等袭击/胜利——兆头消失也不重复喝）+ bad_omen 出现
- ③ bad_omen → 30 秒一次性转化检查（未转化 → 不在村庄提醒，只发消息）
- ④ raid_omen（村庄内转化）→ raidStarted + 阶段预触发 + 30 秒袭击开始检查
- ⑤ village_hero → raidVictory + 胜利处理（计胜/叠加主人/移除英雄）→ 清 raidWaiting → 回到 ①
- ⑥ 无药水 → 自动关模式（移除标签）；标签移除 → stopRaidMode

触发时机（事件钩子，替代旧引擎轮询对账）：
- `botWorkModeChanged`（setWorkMode 落库后发布）：workMode=raid → 启动；≠raid → 停止
- `botOnline`（上线/复活/重启后）：workMode=raid → 启动循环；`botOffline` → 清周期等待
- 开启时无瓶 → 通知（节流）+ 低频重试排程（补瓶后自动喝）

核心规则（用户拍板，全部保留）：
- **喝瓶周期：只在启动/胜利后喝**——`raidWaiting` 标记（drink 成功写、胜利处理/下线清）；兆头消失/袭击中都不重复喝（不浪费药水）
- **基岩版机制**：不祥之兆 100 分钟（不在村庄/试炼之地挂着不转化）；在村庄/试炼之地内喝 → 转化袭击之兆（30 秒）→ 袭击；**已有凶兆不自动转化，需重开模式再喝**（用户实测）
- **唯一玩家提醒**：喝瓶 30 秒未转化为袭击之兆 → 通知"假人不在村庄/试炼之地范围"（一次性，只发消息）
- 带袭击之兆/袭击中是正常状态，不报警；胜利处理幂等（事件时刻防重）+ 喝瓶前防御清理残留英雄
- 无药水自动关模式（setWorkMode("none") 唯一渠道）
- 决策纯函数在 rules/RaidRules（`canDrinkRaid` / `diagnoseRaidIdle`，可单测）；领域事件
  （RaidEvents：raidStarted / raidVictory / raidPhase）内聚在 raidMode.ts

**袭击阶段通知**（2.0.0，事件驱动）：
- 阶段序列（全部事件驱动，仅核心流程）：预触发（袭击之兆转化）→ 开始（buff 结束检查）→ 胜利（村庄英雄）→ 停战（40 分钟超时，一次性检查）
- **阶段变化通知玩家**：主人（不受距离限制）+ 附近 64 格玩家，Set 去重（主人在附近不重复发送）
- ⚠️ 阶段仅通知/日志，不干预核心流程（raidStarted 以袭击之兆转化为准，bad_omen 不算劫掠开始）

---

## 领域事件

**BotEvents**（events/DomainEvents）：生命周期 / 认主 / 宝库 / 行为 / 标签变更 / 工作模式变更
```
生命周期：botOnline / botOffline / botDeath / botRespawn
工作模式：botWorkModeChanged（setWorkMode 落库后发布——工作模式驱动模块按值启动/停止）
标签变更：botTagsChanged（setTags 落库后发布——标签驱动模块按需订阅）
认主：    tridentClaimed / tridentOwnerChanged
宝库：    vaultOpened
移动：    botMoved（move 发布 → PositionTracker 订阅：lastPoint 落库 + 持久化，解耦）
行为：    botMainhandChanged / botBlockBroken / botBlockPlaced / botItemUsed / botEntityAttacked
```

**RaidEvents**（features/raid/raidMode.ts 内聚）：`raidStarted` / `raidVictory` / `raidPhase`（阶段通知日志）

- 生产端：生命周期（playerJoin/playerSpawn/entityDie/offlineBot/playerLeave）、行为（botActions）、认主（tridentTracker/tridentClaim）、劫掠（raidMode effectAdd + 阶段扫描）
- 新领域事件一律经对应命名空间聚合导出

---

## 踩坑记录

见 `BLACKLIST.md`（spawnSimulatedPlayer、lookAtLocation、death/respawn 事件顺序、beforeEvents 权限限制等）。

## 依赖版本

| 包 | 版本 |
|---|------|
| @minecraft/server | 2.6.0（根 overrides 收敛 2.8.0；getBlocks 用 `BlockVolume` + `includeTypes`） |
| @minecraft/server-ui | 2.0.0 |
| @minecraft/server-gametest | 1.0.0-beta.1.26.0-stable |
| @minecraft/math | 2.2.7 |
| @minecraft/vanilla-data | 1.26.20 |
