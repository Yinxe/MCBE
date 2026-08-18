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
│                              #   旧 AI 引擎（legacy BotBrain）→ 生物 AI 引擎（新框架）
├── ai/                        # 生物 AI 框架（驱动 features/ai 的能力状态机）
│   └── Behavior.ts            # BehaviorRunner：能力 = 感知-决策-同步短步（step 无循环
│                              #   无 await）；同目录 Memory / SharedMemory（跨假人共享+
│                              #   过期：独立每秒扫描 / fixed 定时 / renewing 延长默认）/
│                              #   Goal / GoalSelector / Sensor /
│                              #   Status / Tree / ResourceLock / Action。零 @minecraft 可单测
├── bootstrap/                 # 启动初始化（装配 + 统一入口 + 迁移）
│   ├── context.ts             # 运行时装配上下文：mc 层单例（botRegistry / botStore /
│   │                          #   configStore / saveCoordinator / inventoryStorage）
│   ├── save.ts                # SaveCoordinator：全部持久化**写**的唯一入口
│   ├── migration.ts           # 数据迁移（旧版本升级通道，幂等）
│   └── uiDrivers.ts           # UI 领域事件订阅装配（各模块 registerUiSubscriptions 聚合）
├── bot/                       # 假人 OOP 封装（基于机器人的面向对象）
│   ├── Bot.ts / BotCore.ts    # Bot 类：能力即方法（navigateTo/swapMainhand/...）；
│   │                          #   BotCore = 纯逻辑基座（可单测），Bot = mc 委托扩展
│   └── PlayerGateway.ts       # SimulatedPlayer 解析唯一入口（含缓存/名称占用/区块检测）
├── events/                    # 事件订阅与事件声明
│   ├── DomainEvents.ts        # BotEvents 领域事件（生命周期/认主/行为/标签/工作模式）
│   ├── EventSignal.ts         # 事件信号实现（core 零依赖）
│   ├── UiEvents.ts            # BotUiEvent（UI 只发布事件，零功能 import）
│   └── *.ts                   # world 事件订阅薄壳（playerJoin/playerLeave/entityDie/...）
├── features/                  # 核心功能封装（副作用层）
│   ├── ai/                    # 生物 AI 行为：brainEngine（10 tick 对账 + 驱动）+ capabilities
│   │                          #   （wander 闲逛 / mine 定点挖掘 / place 定点放置 /
│   │                          #   attack 定点攻击 / fishing 自动钓鱼——共享钓鱼点池 +
│   │                          #   占用/连续失败不可用标记，规则在 rules/FishingPool）
│   ├── basic/                 # 基础**原子性**功能（单动作不可细分）：blocks（破坏/放置）/
│   │                          #   items（背包/主手/使用/装备）/ fishing（发杆/收竿）/
│   │                          #   control / move（导航，发布 botMoved 事件）/
│   │                          #   PositionTracker（订阅 botMoved → lastPoint 落库）/
│   │                          #   PoseGateway（体态）/ sneak / teleport / EntityTags
│   ├── manage/                # 假人生命周期管理（create/delete/kill/online/offline/spawn/
│   │                          #   reclaim/rename/spawnPoint/spawnMode/gametestContext...）
│   ├── raid/                  # 劫掠模式（事件驱动轻量模块：无树、无端口、零轮询）
│   ├── flow/                  # **工作流（flow）**：一组原子功能（basic）组合的流程——
│   │                          #   fishingFlow（钓鱼流程）、fishingHookTracker（感知基础）、
│   │                          #   treeScan（woodcut 扫描壳）；barrel 统一出口
│   ├── state/                 # ⚠️ 定位待确认：旧标签行为引擎（behavior，TAG 驱动
│   │                          #   autoMine/autoPlace/...）+ 跟随（follow）+ 标签渠道（setTags）
│   ├── trident/               # ⚠️ 三叉戟 mc 副作用（投掷/认主标记/上线夺回）
│   └── inventoryStorage.ts    # ⚠️ 库存存储（事件驱动增量保存 + 对账兜底；位置待定）
├── interaction/               # 交互层：命令 + UI
│   ├── commands/              # /mp:* 命令注册（lifecycle / navigation / behavior /
│   │                          #   activity / inspect / system）
│   └── ui/                    # ActionForm 面板（bot / panels/*）+ 格式化 / 帮助
├── legacy/                    # 旧时代遗留（保留运行，部分功能未重写）
│   └── ai/                    # 行为树框架（VaultTask / FishingTask 端口契约 + 树装配）+
│                              #   BotBrain 引擎（10 tick 驱动宝库/钓鱼树；劫掠已剥离）+
│                              #   任务 mc 适配（VaultPorts / FishingPorts，随旧架构退役）
├── rules/                     # 规则模块（纯逻辑，零 @minecraft 可单测）
│   ├── coords/ items/ format/ tags/ tree/ utils/ xp/
│   └── DefenseRules / FishingRules / RaidRules / Types
└── service/                   # 服务模块（core 纯逻辑 + 端口）
    ├── BotRegistry / BotVisibility / QuotaRules / ReclaimPlanner /
    │   RecordMigration / ModConfigRules
    └── port/                  # 端口定义（BotStore / IntervalScheduler / Binding）+
                               #   mc 实现（McBotStore / McConfigStore / LegacyCodec）
```

### 纯/副作用分层界限（tsconfig.test.json 权威）
- **可 node 单测（零 `@minecraft/*`、零 `@yinxe/toolkit` 导入）**：`ai/`、`rules/`、`service/`
  （含 port 接口）、`bot/BotCore.ts`、`legacy/ai/*`（除 BotBrain.ts）、
  `events/DomainEvents + EventSignal + UiEvents`
- **mc 副作用层**：`bootstrap/`、`features/`、`interaction/`、`bot/Bot.ts + PlayerGateway`、
  `events/` 订阅薄壳、`main.ts`
- 类型本地化：`Vector3/Vector2` → `Vec3/Vec2`；`EquipmentSlot` 枚举 → 字符串槽名（mc 边界转换）
- 领域事件负载只用可序列化 string/number；端口（BotStore/IntervalScheduler）接口 + mc 实现同界

### 测试纪律
- 纯层逻辑必须有单测（tests/*.test.ts，Fake/InMemory 替身断言场景序列）；mc 层靠游戏内冒烟

### 两套 AI 引擎（并存）
- **新框架（ai/ + features/ai，生物 AI）**：Behavior 状态机 + BehaviorRunner 优先级抢占；
  brainEngine 每 10 tick 注入 ctx.bot / ctx.shared 驱动；能力形态 = 常驻协程（mine：token 可取消）或
  同步短步（wander / place / attack）；私有记忆经 AiMemory（brain.memory）注入，
  **跨假人共享记忆经 SharedMemory 全局单例（ctx.shared）注入——所有假人都能读写**，决策在行为内
- **旧框架（legacy/ai/BotBrain，宝库/钓鱼任务）**：行为树（Sequence/Selector/黑板/Sense）
  + 端口契约；VaultPorts / FishingPorts 任务适配同在 legacy/ai/；劫掠已剥离为
  事件驱动模块 features/raid（无树、无端口、零轮询）

### 目录语义与定位修正（用户拍板；✅=已办，其余待重构）
| 目录 | 现状 | 定位判定 |
|---|---|---|
| `features/task/` | ✅ 已改名 **`features/flow/`** | 概念 = **flow（流程）**——一组原子功能组合而成的工作流；fishingFlow 为范例 |
| 原子能力归位 | ✅ fishing.ts（发杆/收竿）已入 **basic** | 原子性功能应在 **basic**（如飞行 fly 原子能力 → basic；飞行 flow 才属 flow 模块） |
| task 内工具集 | treeScan（树资源坐标集扫描） | 规则/算法部分已抽 **rules/tree**（规则化已达成）；mc 扫描壳属 woodcut flow 的一部分，留在 flow |
| Ports 命名 | ✅ FishingPorts / VaultPorts 已移入 **legacy/ai/** | 旧时代遗留命名（legacy 树任务端口的 mc 适配），随旧架构退役清理 |
| `features/trident/` | 投掷 / 认主标记 / 上线夺回（mc 副作用） | 规则在 rules/items（TridentRules / TridentClaimRules）；本体属规则 + 工作流一小部分 |
| `features/inventoryStorage.ts` | 库存增量保存 + 对账兜底 + 恢复 | 位置不对，属数据/持久化层，待挪出 features |
| `features/state/` | behavior（TAG 行为引擎）/ follow / setTags | 旧标签行为体系遗留，用途待确认（可能收编或淘汰） |

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
- AI 任务的 UI 反馈（不在线提示）在 `startBrainEngine` 注册

### 工作模式（record.workMode，用户拍板）
- **互斥单选**：一个假人一个工作模式——none / wander（闲逛模式）/ mine（定点挖掘模式）/
  place（定点放置模式）/ attack（定点攻击模式）/ raid（劫掠模式）/ fishing（自动钓鱼模式）/
  woodcut（自动砍树模式）。互斥由单字段天然保证
- 各引擎按值认领：wander/mine/place/attack/fishing/woodcut → 生物 AI 引擎；raid → 劫掠模块
- **修改唯一渠道 `setWorkMode`**：落库 + 发布 `botWorkModeChanged`（驱动模块按值启动/停止，
  替代旧 10 tick 标签轮询）；UI 提交前先 setTags 校验通过再 setWorkMode（防部分应用）
- ⚠️ 自动钓鱼：新版走 workMode="fishing"（生物 AI + 共享钓鱼点池）；旧 TAG_FISH_MODE
  驱动路径（legacy 树）保留兼容——两套并存，按启用方式二选一
- **共享钓鱼点池选点规则（新版 workMode="fishing"，rules/FishingPool）**：
  假人只能从池里选**自身 16 格内**（SPOT_MAX_DISTANCE）且**点位半径 1 格内无
  其他实体**（现场实时判定 isSpotUsable）的有效钓鱼点；池内**有效点**不足
  下限（POOL_MIN_USABLE=3）→ 下次寻找的假人主动扫描发现新点并合并进池共享

### 自动砍树（新版 workMode="woodcut"）
- **共享树资源池（rules/woodcut/TreePool）**：所有砍树假人共用 SharedMemory
  `"woodcut:pool"` 池（renewing TTL，活跃即延长）——一个假人发现的树全体可见；
  **只认领附近 16 格**（TREE_POOL_MAX_DISTANCE）、**多假人不抢夺**（claimTree 独占）、
  **处理完移除**（removeTree）、可认领树资源不足（POOL_MIN_TREES=3）→ 主动扫描
  发现新树并合并进池共享（mergeScannedTrees）
- **单树砍伐计划（rules/woodcut/ChopPlan）**：按模式编排有序目标——原木模式
  （圆木 + 挡叶/障碍 blocker + 圆木卡叶清理）+ 收集模式（圆木 + 整树树叶），
  附拾取范围；"超出挖掘范围→靠近再挖"由 mc flow（woodcutFlow）
- **工具策略（rules/woodcut/WoodcutRules）**：原木模式只用斧头策略（品阶优先 /
  效率>耐久>精准>时运）；收集模式树叶用树叶策略（精准锄头 > 剪刀 > 任意精准工具，
  强制应用——全背包扫描取最优，即使主手是精准斧头）
- **独立拾取 flow（features/flow/pickupFlow + rules/pickup/PickupPlan）**：可复用
  拾取子流程——工作范围 + 目标 typeId 白名单（core 纯规划），先破**卡落遮挡**
  （掉落物卡树叶 → 破除让掉落物掉下）再就近逐个拾取；背包满回调 / 不可达回调
  由调用方处理。chopOneTree 已接入本 flow
- **砍树子模式枚举（运行时可选）**：`/mp:woodcutmode <bot> <logs|collect>` 持久化
  到 `BotRecord.woodcutMode`（缺省 logs），引擎注入大脑记忆驱动能力
- **测试命令 `/mp:woodcut [radius] [mode]`**：扫描树资源并展示最近一棵树的砍伐计划
  （flow 诊断；mode=logs 原木模式 / collect 收集模式）

### 标签系统
- 标签 = 假人行为的持久开关（共存 COEXIST / legacy 组 LEGACY：宝库/钓鱼/control 等旧标签）
- **标签修改唯一渠道 `setTags`**（UI 命令全走它）：实体同步 syncEntityTags + 持久化统一 +
  发布 `botTagsChanged`；**移除标签 = 行为立即停止**（BotBrain 对账清树，重开重新开始）
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

## 劫掠模式（features/raid/raidMode.ts，事件驱动轻量模块）

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

## 宝库模式（legacy/ai/VaultTask 契约 + legacy/ai/VaultPorts）

核心规则：
- **感知驱动**：sense() 返回背包钥匙分类 + 附近宝库分类（普通/不详，按距离排序）
- **目标选择**：优先不详宝库（有不祥钥匙时）；普通宝库**只能使用普通钥匙**（不详钥匙不可替代）
- **缺因诊断**（idle 通知精确原因）：缺钥匙 / 缺宝库 / 缺不详钥匙 / 缺普通钥匙
- **防假成功**：交互后回读钥匙总量基准（< 基准才判定成功）；**持续点击直到真消耗，不判断宝库已开过**（重连新实体可重复开）；宝库被拆（typeId 验证失败）→ 清目标重扫不卡死
- **重连循环**：开箱成功 → safeReconnect → 黑板目标保留 → 重连后继续同一宝库

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

- 生产端：生命周期（playerJoin/playerSpawn/entityDie/offlineBot/playerLeave）、行为（botActions）、认主（tridentTracker/tridentClaim）、宝库（VaultPorts 开箱）、劫掠（raidMode effectAdd + 阶段扫描）
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
