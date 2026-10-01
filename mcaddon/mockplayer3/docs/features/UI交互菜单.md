# UI 交互菜单功能梳理

> 一句话:通过 /mp:menu 命令、手持信物右键和长按假人三种入口，提供创建、列表、上下线、行为设置、物品管理与管理员配置等全部面板式操作，玩家不记命令也能使用假人功能。

> mockplayer3 全部面板式交互（ActionForm / ModalForm / 确认框）的功能、入口、导航关系与守卫口径。文中「文件相对路径 + 函数/类/常量名」对应 `scripts/interface/` 下当前实现（基线：分支 `feat/mock-player-rewrite`，2026-09-29）。回收管线的完整流程另见同目录《资源回收.md》，本文只述其面板侧交互。

## 1. 触发入口（三条）

| 入口            | 条件                                                                                                                                 | 落点                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 命令 `/mp:menu` | 任何玩家                                                                                                                             | `showMainMenu`（`interface/Commands.Ui.ts` 的 `UI_COMMANDS` 中 `mp:menu` 项 → `interface/Panels/Menu.ts` 的 `showMainMenu()`） |
| 手持信物右键    | `config.tokenItem.enabled` 且物品 typeId 匹配（`Menu.ts` 的 `onTokenItemUse()`）；信物在 `TOKEN_ITEM_OPTIONS` 中选"无"时仅剩命令入口 | `showMainMenu`                                                                                                                 |
| 长按假人实体    | 桥接层 `engine/Bridges.ts` 的 `onInteractEntity` 捕获 `entityInteract`，`Menu.ts` 的 `onBotInteract()` 在 `system.run` 内重读潜行态  | **站立→BotPanel（操作面板）；潜行→BehaviorPanel（行为菜单）**                                                                  |

- 长按入口先做存在性预判（`findBotIdByName` + `record`），假人已不存在时回发红字早退；面板入口自身仍带完整解析与守卫（双保险）。
- 判定在桥后同步做、开表单必须 `system.run`——这是 Menu.ts 文件头的纪律注释。

## 2. 面板导航树

```
主菜单 MainMenu（Menu.ts）
├─ 创建模拟玩家 ──────────→ Create（ModalForm，单层）
├─ 模拟玩家列表 ──────────→ BotList ──点行──→ BotPanel(带返回=回列表)
├─ 在线管理 ──────────────→ Online（ModalForm 批量 toggle，单层）
├─ 帮助 ─────────────────→ HelpGuide（聊天分段长文，无表单）
└─ ⚙ 管理员菜单（仅管理员）→ Admin
    ├─ 全部假人列表 ──────→ BotList(返回=回 Admin)
    ├─ 全部假人在线管理 ──→ Online
    ├─ 全局配置 ──────────→ GlobalConfig（提交后回 Admin 根）
    ├─ 逐玩家配额 ────────→ 玩家行 → editPlayerQuota
    ├─ 逐玩家在线配额 ────→ 玩家行 → editPlayerOnlineQuota
    ├─ 管理员名单 ────────→ 移除确认框 / 添加表单
    └─ 返回（空按钮，顶层无上级）

BotPanel（假人操作面板，17 按钮）
├─ 行为菜单 / 潜行长按直达 → Behavior（ModalForm）
├─ 选择主手 ─────────────→ Mainhand（dropdown）
├─ 物品互换 ─────────────→ Swap（4 toggle）
├─ 回收资源 ─────────────→ Reclaim（8 toggle 勾选项）
├─ 丢弃物品 ─────────────→ Discard（8 toggle 槽位段）
├─ 投三叉戟 ─────────────→ Trident 选择器（多把时弹表单；仅主手一把直投）
├─ 投掷物认主 ───────────→ TridentClaim（聚集分组勾选）
├─ 查看数据 ─────────────→ Data（Modal 呈现，失败回退聊天）
├─ 修改名字 ─────────────→ Rename（单文本框）
└─ 删除假人 ─────────────→ Delete（MessageForm 确认框）
```

返回串联靠闭包：`BotList(player, onMainMenu)` 把上一层回调一路传进 `BotPanel(…, onBack)`（`BotList.ts` 的 `showBotList()` 行点击回调、`BotPanel.ts` 的 `showBotPanel()` 内「返回列表」按钮）。

## 3. 公共守卫与渲染口径（`Kit.ts`）

所有面板共用同一套"守卫缝"，规则零在 domain 层：

| 缝                     | 行为                                                                                                        | 出处                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `uiViewer(player)`     | `key = playerKey(玩家名)`、`isOp = 权限等级 ≥ 2`，与命令侧同构                                              | `Kit.ts` 的 `uiViewer()`             |
| `botStatus(record)`    | 在线/死亡实时判定：会话态优先，记录 `deathMark` 兜底                                                        | `Kit.ts` 的 `botStatus()`            |
| `resolveUiBotRecord`   | 按名解析记录，不存在时回发"已不存在"并返 null                                                               | `Kit.ts` 的 `resolveUiBotRecord()`   |
| `guardUiManage`        | 管理权三段：有权直通 → **无主自动认领**（旧版数据首次操作生效）→ 拒绝"只允许主人或管理员操作"               | `Kit.ts` 的 `guardUiManage()`        |
| `ensureUiBotAvailable` | 需在线操作的前置门，不在线/死亡回发提示                                                                     | `Kit.ts` 的 `ensureUiBotAvailable()` |
| `visibleRecords`       | `canView` 过滤 + 在线优先、再按名字排序                                                                     | `Kit.ts` 的 `visibleRecords()`       |
| `getStatusIcon`        | 死亡红 `[死亡]` / 离线黄 `[离线]` / 在线显模式中文名（none 黄、其余绿）；中文名一律 `Catalog.modeSpec` 派生 | `Kit.ts` 的 `getStatusIcon()`        |

渲染约定：颜色 token 与文案为玩家可读性既定口径；**ModalForm 深底禁暗色 token**（认主面板尤甚，`Panels/Trident.ts` 文件头纪律注释）；位置取整三分量；背包摘要前 3 种 `name×count` 超出显"还有N种"（`Kit.ts` 的 `invSummary()`）。

## 4. 各面板功能明细

### 4.1 主菜单 `Panels/Menu.ts 的 showMainMenu()`

五按钮：创建（绿）、列表、在线管理、帮助、⚙管理员菜单（金，仅 `isAdmin` 显示）。图标纹理路径为 RP 既定口径。

### 4.2 创建 `Panels/Create.ts`

ModalForm 五字段：名称（必填）、坐标（留空用玩家位置，解析失败**不阻断原地创建**仅 warn）、维度下拉（跟随玩家/主世界/下界/末地，非法维度回退玩家当前维度）、复刻体态 toggle（默认开：同步潜行+朝向）、自动重生 toggle（默认开）。提交流程：`lifecycle.create` → `setSwitch(autoRespawn/sneaking)` → **立即 `lifecycle.online`**；建档成功但上线失败时明示"已建档但上线失败"。

### 4.3 假人列表 `Panels/BotList.ts`

按钮平铺无分页；空列表回发提示不弹表单。行标签 = 状态徽标 + 名 + 维度中文名 + 主人列（`ownerLabel`：管理员显主人，普通玩家仅无主标出）。行图标按状态三分：死亡 kill_bot / 在线 toggle_online / 离线 bot_list。

### 4.4 Bot 操作面板 `Panels/BotPanel.ts`

入口守卫三段（存在→管理权→无主认领）；body 四行摘要，每行 `safe()` 兜底单行失败不拖垮表单：

1. **状态行**：存活/死亡 | 在线/离线 | 工作模式 | 潜行态；
2. **位置行**：在线读实体姿态，离线回家点标注；附重生点；
3. **持行**：在线 `liveSlots`（主手=选中槽 + 背包 filled/36 + 摘要）；离线 `vaultSlots` 缓存，主手显示为"副手缓存"（仓无选中槽概念）；
4. **归属行**：主人/无主、经验 `Lv+XP`、标签（剔 `BOT_MARKER_TAG` 与 `:idle`，最多展 2 个）。

17 个功能按钮（`BotPanel.ts` 中 `showBotPanel()` 的 `ActionFormBuilder.showQuick` 按钮段）：

| 按钮                      | 行为要点                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安全上线/下线（一键两态） | 已在线=下线 `lifecycle.offline(botId,"command")`；上线先播报"正在安全上线"                                                                                                            |
| 传送过去                  | **离线/死亡先安全上线**再 `tpPlayerTo`；上线失败则拒绝传送                                                                                                                            |
| 同步姿态                  | 假人→玩家位置+朝向+潜行：先 `gaze.releasePose` 解姿态保护（否则挡新朝向落库），传送后 `forceLook` 持续注视维持朝向（一次性约 2s 被引擎回正），**同步即家点真源更新**（`setHomeHere`） |
| 选择主手                  | → Mainhand                                                                                                                                                                            |
| 物品互换                  | → Swap                                                                                                                                                                                |
| 回收资源                  | → Reclaim                                                                                                                                                                             |
| 丢弃物品                  | → Discard                                                                                                                                                                             |
| 行为菜单                  | → Behavior                                                                                                                                                                            |
| 使用物品                  | `panelOps.useItemOnce` 一次性右键主手物品；反馈仅两种："饱食度已满无法进食"、"主手物品当前不可用"；used/offline 静默                                                                  |
| 交互                      | `handler.interactSight` 官方头部射线一次性交互面前目标，无消息反馈                                                                                                                    |
| 设置重生                  | `lifecycle.setRespawnHere(viewer, botId)` 到操作者当前位置                                                                                                                            |
| 修改名字                  | → Rename                                                                                                                                                                              |
| 投三叉戟                  | → Trident 选择器                                                                                                                                                                      |
| 投掷物认主                | → TridentClaim                                                                                                                                                                        |
| 查看数据                  | → Data                                                                                                                                                                                |
| 击杀假人                  | 需在线且未死亡，`ops.kill`                                                                                                                                                            |
| 删除假人                  | → Delete 确认框                                                                                                                                                                       |

按钮直调 services，不经事件总线；"返回列表"走上层闭包。

### 4.5 行为菜单 `Panels/Behavior.ts`

ModalForm：自动重生 toggle、潜行 toggle、**工作模式下拉（单选互斥）**。下拉项 = `WORK_MODES` 按 `config.workModeEnabled` 过滤（"无"恒在），已禁用模式不出现；列色：无=灰、劫掠=黄、钓鱼=青、其余玩家黄。采集对象即模式（`harvest_*` 各占一项）；节拍配置不入面板。
提交纪律：**开关先写 → 后切模式**（模式切换即存盘）；切入 follow 先 `setFollowTarget(viewer.key)`（Follow 能力启动前提），切出则**待模式切换成功后**才清 null——切换被拒时保留关系（与 `mp:work` 命令路径一致）；`system.run` 内重读 live 记录防面板期间被删。成功消息在操作之后发；离线假人切模式为**预置**，播报"下次上线生效"（`session()` 有无区分在线文案）。

### 4.6 在线管理（批量）`Panels/Online.ts`

打开时快照每个可见假人的初态在线与否，逐行 toggle（标签含状态徽标/名/主人/位置/标签）。提交**逐条 diff 只处理变化项**，无变化零操作；行级 `guardUiManage`（含无主认领）不过则跳过该行；批量顺序 `await` 上下线（安全上下线内置排队，无需外部冷却）；单条异常捕获不中断后续。

### 4.7 回收资源 `Panels/Reclaim.ts`

**离线也可开**（预览走仓快照）。八字段勾选：xp/主手/副手/头/胸/腿/靴/背包，**仅"回收背包"默认勾选**；每段上方 label 预览（`formatItemPreview` 附魔+耐久）。主手预览双路：在线=选中槽（并从背包列表剔除防双计）、离线=首个非空。提交组 `ReclaimSelection` 调 `lifecycle.reclaim`，成功按 `items/overflow/xp(Lv)` 拼明细，全零报"背包是空的"。管线细节（邮箱串行、滞留导出改期、仓回写等）见《资源回收.md》。

### 4.8 丢弃物品 `Panels/Discard.ts`

八段 toggle：主手/热栏(0-8)/背包(9-35)/副手/头/胸/腿/靴，标签带快照摘要。**打开时离线也可看**（全"空"快照），提交时不在线才报错。勾选翻译为槽位集合（主手=selected），提交前用现态 `liveSlots` 复核可丢弃件数，为 0 早退；防吞算法在 engine `PanelOps.discardSlots`，回执 `dropped/failed`（失败件物品保留）。

### 4.9 物品互换 `Panels/Swap.ts`

与操作者真人互换，四 toggle（主手/副手/装备/背包）直选，标签带假人现状（装备 `n/4(部位:类型)`、背包 `n/36`）。"背包含主手"的执行序由 engine `swapWithPlayer` 承载；全部操作同一 `system.run` 防竞态；**提交侧复核管理权**（面板打开期间可能易主）。回执播报已互换项 `r.done.join("、")`。

### 4.10 选择主手 `Panels/Mainhand.ts`

dropdown 列出可上主手的物品（`[热栏n]/[背包n]` + 名×数量 + 耐久 + 附魔换行）。"固定:无"项显隐规则：主手已空恒显，否则仅存在**非主手空位**时显（清空主手需背包有空位，绝不吞物品）。仅一项可选时报"背包中没有其他物品可供选择"。结果语只映射 engine `Wielder` 回执。

### 4.11 投三叉戟 `Panels/Trident.ts 的 showTridentSelector()`

需在线。`scanTridents` 无三叉戟报错；**仅主手一把时快速路径直接投掷不弹表单**；多把则逐把 toggle（默认勾主手），标签 = 槽位tag + nameTag/“三叉戟” + 附魔中文 + 耐久 `(cur/max)` 或 `(∞)`。`tridentOps.throwTridents` 回执三态：already-throwing（投掷链占用）/ not-online / 成功。

### 4.12 投掷物认主 `Panels/Trident.ts 的 showTridentClaimUI()`

需在线且**假人须有主人**（无主拒绝——没有主人体系）。`scanOwnProjectiles` 扫 `CLAIM_SCAN_RADIUS` 内自家投掷物（家族名集合 = 主人 key ∪ 同主假人名）；按类型分组后 `clusterPoints` 小半径链式聚集成分组，`neighborDensity` 归一为概率分档显示（≥60% 绿 / ≥30% 黄 / 其余青）。summary 行报总数与组数。已认主显 `✔已认主`，被他人认过显 `⇄覆盖<名>`；勾选即认主为**第二任**（可覆盖）。提交期间 `setClaimOperator(player.name)` 抑制对操作者的重复汇报；回执 `claimed/selected` 及失败件数。Modal 深底禁暗色 token 与粗体。

### 4.13 查看数据 `Panels/Data.ts`

Modal 优先 + 聊天兜底：行数组先构建（两呈现共用），每节 `pushSafe` 容错，单项失败只显"无法统计"，表单必定弹出。内容分节：

- 头部：标题 + **区块加载探测**（当前/重生点各自"已加载/未加载"）+ 状态/主人/实体ID + 维度 + 潜行/在线/死亡 + 标签与工作模式；
- 位置详情：实体姿态（在线时）/家点/重生点，各带偏航俯仰角；
- 经验：`Lv` + 本级进度 `progress/nextNeed`（`XpMath.totalXpForLevel`）+ 总经验；
- 效果：在线取实体现值，离线取记录快照；
- 在线：视角方块（`panelOps.viewTarget`）、装备六件（主手 `▶` 标记选中槽）、背包 36 格逐件（热栏/背包两段）；
- 离线：仓缓存装备+背包前 10 格，超出提示 `/mp:storage`；主手"离线（选中槽未知）"。
  呈现按 `━━` 分节符切 Modal label 段；关闭后可重开刷新。`/mp:data` 命令走同一 `sendData`（`Commands.Ui.ts` 的 `UI_COMMANDS` 中 `mp:data` 项，经 `ctx.bot` 管理守卫）。

### 4.14 修改名字 `Panels/Rename.ts`

单文本框（默认现名，提示自动加 `sim-` 前缀）。校验全在 `Lifecycle.rename`（规范化/占用/在线禁改），本层零规则只渲染回执；提交时重读记录 + 管理守卫；改名成功才播报。

### 4.15 删除假人 `Panels/Delete.ts`

MessageForm 确认框（"背包、装备和经验将被回收 / 此操作不可撤销"）。确认后 `lifecycle.remove` = **全量回收**：下线 + 仓内物品与经验整体交付操作者，不逐项勾。与 `/mp:delete` 命令直通无确认为双口径，勿合并。

### 4.16 管理员菜单树 `Panels/Admin.ts`

根面板 body 汇总：默认/在线配额（`quotaLabel`：≥UNLIMITED=无限、0=禁止）、假人总数与主人/无主分布、管理员数、下线联动/实现性功能两开关态、当前信物。子面板：

- **全局配置**：下线联动、默认每人配额滑块 1-11（11=无限）、默认在线配额滑块 0-11（0=禁止）、信物下拉、**工作模式启用 toggle 表**（`MODE_META` tooltip 保留性能警示；默认口径与 `defaultEnabledModes()` 一致——**全部模式默认开启**，tooltip 统一写"默认开启"，面板提示行标注"默认全部启用，卡顿按需逐项关闭"）。提交纪律：只写变化项；**禁用模式即停假人**（true→false 的模式逐个 `changeWorkMode(none)`）；**在线配额降低即强制下线**（`enforceOnlineQuotas`）；完成后回根面板。假人功能方块误点拦截不再入本面板——名单写死在 `domain/ClickGuard.ts`，无开关。
- **逐玩家（在线）配额**：名单 = 已有个人配置者 ∪ 有假人主人者；行显 `当前持有/生效配额`；文本框留空=恢复默认（删个人项并**立即执行强制下线检查**）、0=禁止、≥999=无限归一。
- **管理员名单**：列出 `adminKeys`，点击二次确认移除；"+添加"表单按 `playerKey` 去重入单。名单内玩家无需 OP 即不受配额、可管理所有假人。
  本层规则零：强制下线与停假人都经 Lifecycle 执行。

### 4.17 帮助 `Panels/HelpGuide.ts`

聊天分段长文四段：功能介绍（开关+工作模式全表）、快速上手（创建/管理/长按/批量）、命令参考（与命令目录同步维护）、常见问题。无表单。

## 5. 命令 ↔ 面板的分工（`Commands.Ui.ts`）

命令=面板的一跳入口翻译，零业务规则：`mp:menu`→主菜单、`mp:admin`→管理员菜单（处理器内判权，拒绝文案与 CmdKit admin 位口径不同源）、`mp:trident <假人>`→三叉戟选择器、`mp:data <假人>`→数据面板。全量命令目录聚合于 `Commands.ts`，`mp:cmdlist` 渲染目录（取名避开原版 `/help` 冲突）。另：管理员诊断命令 `mp:fish`（`Commands.Admin.ts`）带**在位能力守卫**——假人工作模式运行中拒绝执行（提示"请先切回空闲再执行钓鱼诊断"并回显在位模式名），防诊断钓竿流程与在位能力争用同一动作租约。

## 6. 贯穿性纪律（多面板共同遵守）

1. **异步呈现**：表单回调/outcome 播报一律回 `system.run`；提交通常在 `system.run(async)` 内进行。
2. **提交重验**：面板打开是快照，提交时重读 `runtime.record`（已删早退）、复核在线态与管理权（Swap/Rename/Online 等"期间可能易主/被删"场景）。
3. **规则零**：interface 只翻译意图与渲染回执；校验/排队/停假人/强制下线全在 application+domain（`Lifecycle`、`Permissions`、`Catalog`）。
4. **单点失败隔离**：body 行级 `safe()`、数据面板节级 `pushSafe`、批量循环逐条 try-catch——任何一项异常不拖垮整表单/整批次。
5. **文案双口径勿合并**：表单成功语 vs 命令成功语、UI 删除有确认 vs 命令直通、`mp:admin` 拒绝语 vs CmdKit 拒绝语，均为有意分叉。
6. **模式中文名唯一真源**：一律 `Catalog.modeSpec(id).label`，面板不另立手写表。
