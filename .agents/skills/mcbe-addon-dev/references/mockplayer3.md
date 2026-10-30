# mockplayer3 代码地图与时序

配合 `../SKILL.md` 使用。本文件只回答“代码在哪、运行时按什么顺序走”；引擎事实与红线见 `mcaddon/mockplayer3/AGENTS.md`。

## 文件地图

### 入口与装配

| 文件                        | 作用                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `scripts/main.ts`           | 4-Phase 组合根：startup 注册命令/测试维度；worldLoad 后 `system.run` 装配；200t 兜底 |
| `scripts/Composition.ts`    | 唯一跨层依赖图：记录/存档/物品仓/实体操作/模式/生命周期/调度器的单例与能力注册       |
| `scripts/engine/Bridges.ts` | 把 ScriptAPI 事件转成 application 回调；before 回调只上达纯数据                      |

### domain（纯逻辑，零 `@minecraft`）

| 文件                                                     | 内容                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Record.ts`                                              | `BotRecord`、`WorkMode`、开关、家点、配置形状                                                 |
| `Catalog.ts`                                             | 模式目录唯一真源：label/help/requiresLeases/tier/experimental；命令、面板、启用判定全由此派生 |
| `Session.ts`                                             | 在线会话：sessionId、epoch、entityId、leases、capability、dirty                               |
| `Leases.ts`                                              | 资源租约：gaze/motion/hands/breaking；HOLD/AIM_ONCE；TTL                                      |
| `Capability.ts`                                          | 能力契约：id/requires/start/tick/stop                                                         |
| `State.ts`                                               | 生命周期状态迁移表与冻结窗/可 tick 判定                                                       |
| `Permissions.ts`                                         | 主人/管理员/查看者判定                                                                        |
| `ActionRules.ts` / `ActionCursor.ts` / `ActionStatus.ts` | 长流程指令模型、解析/归一化、执行游标、运行状态板                                             |

### engine（唯一直接调用 ScriptAPI）

| 文件                                                                             | 原子/职责                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `EntityGateway.ts`                                                               | 名字 ↔ botId ↔ entityId 解析与仲裁；`world.getPlayers/getEntity` 唯一出口 |
| `Spawner.ts` / `Rig.ts`                                                          | 假人生成/装置；低版本直生与 GameTest 路径                                 |
| `Lifecycle` 相关：`SaveGate.ts`、`RecordStore.ts`、`ItemVault.ts`、`Migrator.ts` | 恢复闸、档案落盘、物品仓、v2 迁移                                         |
| `EntityOps.ts`                                                                   | 生成/传送/物品导入导出/属性/装备                                          |
| `Mover.ts` / `StrollOps.ts`                                                      | 寻路与闲逛路线                                                            |
| `Placer.ts` / `Wielder.ts` / `Breaker.ts`                                        | 放置、主手/装备读写与补货、破坏                                           |
| `Gaze.ts`                                                                        | 视线租约与视角中性化                                                      |
| `TickingAreas.ts`                                                                | 常加载区域创建/清理                                                       |
| `ProjectileTracker.ts`                                                           | 投掷物认主/绑定                                                           |
| `Hooks.ts`                                                                       | engine → application 的副作用外发缝（报脏/领域事件）                      |
| `Clock.ts`                                                                       | 单一时钟：`onTick` / `runTimeout`                                         |
| `ScriptStore.ts`                                                                 | 指令表独立落盘（`mp:script:<botId>`）                                     |

### application（决策与节拍）

| 文件                | 作用                                                                     |
| ------------------- | ------------------------------------------------------------------------ |
| `Lifecycle.ts`      | 上线/下线/死亡/复活/重连/对账；管线串行化入口                            |
| `Mailbox.ts`        | 每假人 1 执行 + 1 排队；同标签合并，异标签替换                           |
| `Modes.ts`          | 模式切换：停旧 → 配置/实验闸 → 租约预取 → start → 状态迁移 → 写穿 → 广播 |
| `Scheduler.ts`      | 每 tick：租约过期 → WORKING 能力按 nextWakeAt 驱动 → 经验/滞留/存档冲刷  |
| `Runtime.ts`        | 记录、会话、配置、运行时状态表                                           |
| `WorkTransfer.ts`   | 作业中的物品/经验转移                                                    |
| `ScriptLibrary.ts`  | 指令表唯一读写口（读缓存/归一化写入/版本号/停止请求/状态板）             |
| `Capabilities/*.ts` | 各工作模式的相位机                                                       |

### interface（只翻译意图）

| 文件                                                | 作用                                                   |
| --------------------------------------------------- | ------------------------------------------------------ |
| `Commands.ts`                                       | 聚合 `ALL_COMMANDS`                                    |
| `CmdKit.ts`                                         | `CommandSpec`、参数/枚举注册、admin 权限包装、错误回显 |
| `Commands.<Group>.ts`                               | 生命周期/行为/导航/检查/管理/长流程/UI 命令组          |
| `Panels/`                                           | 面板；与命令共用 domain 解析                           |
| `Notify.ts` / `ClaimReport.ts` / `CompatWarning.ts` | 通知、认主汇报、兼容提示                               |

## 启动时序

```
system.beforeEvents.startup
  ├─ registerTestDimension(event)
  └─ registerCommands(event.customCommandRegistry, ALL_COMMANDS)

world.afterEvents.worldLoad
  └─ system.run(boot)
       ├─ initTestField()（装置）
       ├─ 旧档迁移（先于对账）
       ├─ lifecycle.startupReconcile()（持久声明一律落离线）
       ├─ tickingAreas.cleanupOrphans()
       ├─ installBridges(...)（实体/玩家/投掷物/物品/受伤/交互）
       ├─ clock.start()
       ├─ installNotify / CompatWarning / ClaimReport
       ├─ scheduler.start()
       └─ installVaultRelocation(...)

兜底：system.runTimeout(200t) 仍未 booted → 再走一次 boot
```

## 上线 / 恢复

```
online(botId)
  → 建 Session（epoch=0, state=SPAWNING）
  → spawner 生成 / GameTest 中转 / 低版本直生
  → handleSpawn → state=RESTORING
  → SaveGate 从档案/物品仓恢复
  → epoch≥1 → state=ACTIVE
  → modes.attachAfterRestore() 重新挂载 workMode 对应能力
```

- `RESTORING/DYING` 期间 SaveGate 挡常规写；epoch 是恢复是否完成的唯一判据。

## 模式切换（`Modes.change`）

```
Modes.change(botId, to, now)
  ├─ 无会话：只写 record.workMode（离线预置，下次上线生效）
  ├─ 有会话：
  │   ├─ 配置禁用 / experimental 总闸 → 拒绝
  │   ├─ state 不是 ACTIVE/WORKING → 拒绝
  │   ├─ stopCurrent()：cap.stop → capability=null → releaseBy(mode) → gaze 中性化
  │   ├─ cap.requires() 逐项 acquire；冲突 → dropToIdle + 拒绝（含持有者）
  │   ├─ 建 capability = { mode, phase:{name:"INIT",nextWakeAt:now}, data:{} }
  │   ├─ cap.start() 返回中文原因或抛异常 → dropToIdle + 拒绝
  │   └─ transitTo("startWork") → record.workMode=to → saveRecord → 广播
  └─ 任何失败分支都必须落空闲，不留 WORKING + capability=null
```

## 每 tick

```
Scheduler.tick(now)
  ├─ 每 20t：有滞留导出时 drainPendingExports
  └─ 逐 Session（try-catch 隔离）
       ├─ leases.expire(now)；gaze HOLD 过期 → gaze.stopHold
       ├─ state=WORKING 且 now≥phase.nextWakeAt → cap.tick(session, now)
       │    └─ 异常 → modes.forceIdle(session, now)
       └─ ACTIVE/WORKING：
            ├─ 每 100t 经验变化回写
            ├─ transfer.tick
            └─ saveGate.flushDue
```

能力 `tick` 的责任边界：续租 → 读相位/上下文 → 做一次决策或原子 → `setPhase` 写下一次唤醒 → 返回。不要在这里 `await`、循环等待或直接写 DP。

## 能力清单

| 模式                            | 文件                      | 租约                    | 备注                                          |
| ------------------------------- | ------------------------- | ----------------------- | --------------------------------------------- |
| `mine`                          | `Capabilities/Mine.ts`    | hands, breaking         | 定点挖掘，视角不动                            |
| `place`                         | `Capabilities/Place.ts`   | hands                   | LAY/STOP 双拍；主手耗尽按上次方块 typeId 补货 |
| `attack`                        | `Capabilities/Attack.ts`  | hands, motion           | 定点盲挥                                      |
| `follow`                        | `Capabilities/Follow.ts`  | motion                  | 距离带 3~128                                  |
| `fishing`                       | `Capabilities/Fishing.ts` | gaze, hands, motion     | 共享钓点池                                    |
| `wander`                        | `Capabilities/Wander.ts`  | motion                  | 走停节律；路线协程结果回写槽位                |
| `raid`                          | `Capabilities/Raid.ts`    | hands                   | 施加袭击之兆                                  |
| `vault`                         | `Capabilities/Vault.ts`   | gaze, hands, motion     | 扫描/寻路/开宝库                              |
| `custom`（存档归一为 `script`） | `Capabilities/Script.ts`  | hands, motion           | 长流程指令表；tick 只看门狗                   |
| `harvest_*`                     | `Capabilities/Harvest.ts` | hands, breaking, motion | 对象即模式                                    |

## 引擎原子契约

- 导出的单例：`placer`、`wielder`、`breaker`、`gaze`、`mover`、`entityOps`、`entityGateway`、`tickingAreas`、`saveGate`、`clock`、`projectileTracker`。
- 返回值是结果联合，不抛异常；常见值：`ok | offline | no-container | no-slot | no-match | verify-failed | no-target | unchanged`。
- 写后回读：容器/装备写后 1–2t 再校验；interact 节流 ≥4t；原子成功经 `Hooks` 报脏或发事件。
- `Placer.beginPlace/endPlace` 必须成对；`Wielder.refillMainhand` 只换空主手槽，同 typeId 搜索整包。
- 长流程专用原子：`Mover.navigateFar`、`Placer.placeAt`、`EntityOps.say/jump`；其余长流程动作复用既有原子。
- 修改原子时保持“调用方只处理结果、不处理异常”的契约；新增失败分支要同时更新调用方分支与测试。

## 持久化键

| 键                         | 内容                               |
| -------------------------- | ---------------------------------- |
| `mp:bot:<botId>`           | 假人档案                           |
| `mp:script:<botId>`        | 长流程指令表（独立键，坏档归一化） |
| `mp:item:<...>`            | 物品仓槽位                         |
| `mp:config`                | 全局配置                           |
| `mp:legacy:pending:<旧名>` | v2 物品迁移待处理标记              |

DP 实际命名空间由 manifest `module_name = "MockPlayer"` 决定；迁移检测必须按该命名空间枚举。迁移语义见模块 `AGENTS.md`。

## 测试映射

| 测试                              | 覆盖                                                              |
| --------------------------------- | ----------------------------------------------------------------- |
| `tests/domain.*.test.ts`          | `ActionRules`、`ActionCursor`、采集/钓鱼/劫掠等纯规则             |
| `tests/engine.*Sim.test.ts`       | 引擎原子在桩/仿真世界下的行为（如钓鱼模拟）                       |
| `tests/sim.*.test.ts`             | 跨层流程与迁移模拟                                                |
| `tests/stubs/MinecraftRuntime.ts` | `@minecraft/*` 自动桩；`then`/`Symbol.hasInstance` 例外见文件注释 |

命令：`pnpm run test:core`；类型：`npx tsc --noEmit -p tsconfig.json`。
