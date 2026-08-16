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

## 架构（六边形分层，对齐 item-route）

```
scripts/
├── main.ts          # 4-Phase DI 组合根（只装配）：startup 注册命令 → worldLoad 挂载
│                    #   机制（initTridentTracker / initRaidMode）+ AI 引擎（startBrainEngine）
├── core/            # 领域层：零 @minecraft 依赖，可 node 单测
│   ├── ai/          # AI 编排框架（行为树：节点/组合/装饰/黑板/Status 枚举，零具体任务）
│   ├── tasks/       # 任务型模块（VaultTask 宝库 / FishingTask 钓鱼：感知快照+端口契约+树装配）
│   └── model/events/tags/coords/items/storage/service/xp/format
├── mc/              # 适配层：只做 mcapi 副作用
│   ├── ai/          # BotBrain：AI 引擎（每假人每任务一棵树 + 10tick 驱动 + 标签对账）
│   ├── tasks/       # 任务执行（VaultPorts / FishingPorts：感知/导航/交互/事件订阅）
│   └── bootstrap/adapters/features/commands/events/ui
└── tests/           # node:test（只测 core；mc 层靠游戏内冒烟）
```

### 依赖纪律（core 层强约束）
- **core 零 `@minecraft/*`、零 `@yinxe/toolkit` 导入**（grep + tsconfig.test.json 双重兜底）
- core 类型本地化：`Vector3/Vector2` → `Vec3/Vec2`；`EquipmentSlot` 枚举 → 字符串槽名（mc 边界转换）
- 领域事件负载只用可序列化 string/number；端口（BotStore/IntervalScheduler）定义 + InMemory 实现在 core，mc 实现同接口

### 测试纪律
- core 纯逻辑必须有单测（任务树注入 Fake 端口断言场景序列）；mc 层靠游戏内冒烟

### AI 编排层（core/ai + core/tasks + mc/ai + mc/tasks）
- **Selector 无记忆抢占**（goal 反应式，仿 Bedrock priority）：每 tick 从根重评，条件变化立即切换；`failure`=降级下一个分支（决策信号非异常），`running`=动作进行中（防重复启动）
- **三态 Status 字符串枚举**（Success/Failure/Running）——所有节点统一返回，不用裸字符串
- **黑板**：每树独立实例（按假人隔离），任务共享状态；重连保留（引擎重连中不清树）
- **感知驱动决策**：`sense()` 一次返回完整感知快照（core 纯类型），决策纯函数（selectVaultTarget / diagnoseVaultIdle）在 core 可单测，mc 只翻译副作用
- **事件 ↔ 树桥接**：事件订阅（effectAdd/UI）更新 mc 状态/黑板，树每 10tick 读取决策——事件管感知实时性，树管决策时机（分钟级等待零轮询）
- **新任务接入**：① core/tasks/XxxTask.ts 端口+树装配 ② mc/tasks/McXxxPorts.ts 副作用 ③ BotBrain 注册（tickXxxBrain + reconcileXxxBrains + startBrainEngine 标签分发）④ Fake 端口单测

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

### 标签系统
- 标签 = 假人行为的持久开关（互斥组 EXCLUSIVE / 独立开关 STANDALONE / 可共存 COEXIST）
- **标签修改唯一渠道 `setTags`**（UI 命令全走它）：实体同步 syncEntityTags + 持久化统一
- AI 引擎按标签分发任务树；**移除标签 = 行为立即停止**（BotBrain 对账清树，重开重新开始）

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
- tag 编码：`mp:owner:`（第一任投掷者）/ `mp:owner2:`（第二任认主者）/ `mp:item:`（附魔耐久编码）；规则层 `core/items/TridentClaimRules` 零 mc 可单测
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
- `botTagsChanged`（setTags 唯一渠道落库后发布）：挂 raid 标签 → 启动；移除 → 停止
- `botOnline`（上线/复活/重启后）：带 raid 标签 → 启动循环；`botOffline` → 清周期等待
- 开启时无瓶 → 通知（节流）+ 低频重试排程（补瓶后自动喝）

核心规则（用户拍板，全部保留）：
- **喝瓶周期：只在启动/胜利后喝**——`raidWaiting` 标记（drink 成功写、胜利处理/下线清）；兆头消失/袭击中都不重复喝（不浪费药水）
- **基岩版机制**：不祥之兆 100 分钟（不在村庄/试炼之地挂着不转化）；在村庄/试炼之地内喝 → 转化袭击之兆（30 秒）→ 袭击；**已有凶兆不自动转化，需重开模式再喝**（用户实测）
- **唯一玩家提醒**：喝瓶 30 秒未转化为袭击之兆 → 通知"假人不在村庄/试炼之地范围"（一次性，只发消息）
- 带袭击之兆/袭击中是正常状态，不报警；胜利处理幂等（事件时刻防重）+ 喝瓶前防御清理残留英雄
- 无药水自动关模式（走 setTags 唯一渠道移除标签）
- 决策纯函数在 rules/RaidRules（`canDrinkRaid` / `diagnoseRaidIdle`，可单测）；领域事件
  （RaidEvents：raidStarted / raidVictory / raidPhase）内聚在 raidMode.ts

**袭击阶段通知**（2.0.0，事件驱动）：
- 阶段序列（全部事件驱动，仅核心流程）：预触发（袭击之兆转化）→ 开始（buff 结束检查）→ 胜利（村庄英雄）→ 停战（40 分钟超时，一次性检查）
- **阶段变化通知玩家**：主人（不受距离限制）+ 附近 64 格玩家，Set 去重（主人在附近不重复发送）
- ⚠️ 阶段仅通知/日志，不干预核心流程（raidStarted 以袭击之兆转化为准，bad_omen 不算劫掠开始）

---

## 宝库模式（core/tasks/VaultTask + mc/tasks/McVaultPorts）

核心规则：
- **感知驱动**：sense() 返回背包钥匙分类 + 附近宝库分类（普通/不详，按距离排序）
- **目标选择**：优先不详宝库（有不祥钥匙时）；普通宝库**只能使用普通钥匙**（不详钥匙不可替代）
- **缺因诊断**（idle 通知精确原因）：缺钥匙 / 缺宝库 / 缺不详钥匙 / 缺普通钥匙
- **防假成功**：交互后回读钥匙总量基准（< 基准才判定成功）；**持续点击直到真消耗，不判断宝库已开过**（重连新实体可重复开）；宝库被拆（typeId 验证失败）→ 清目标重扫不卡死
- **重连循环**：开箱成功 → safeReconnect → 黑板目标保留 → 重连后继续同一宝库

---

## 领域事件

**BotEvents**（core/events/DomainEvents）：生命周期 / 认主 / 宝库 / 行为 / 标签变更
```
生命周期：botOnline / botOffline / botDeath / botRespawn
标签变更：botTagsChanged（setTags 落库后发布——标签驱动模块按需订阅）
认主：    tridentClaimed / tridentOwnerChanged
宝库：    vaultOpened
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
