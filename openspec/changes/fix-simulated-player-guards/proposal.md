# Proposal

## Why

游戏内实测暴露了两类崩溃，根因相同：**模拟玩家（假人）在 `world.getPlayers()` / `getAllPlayers()` 里与真人同池返回，但成员属性大量缺失**。

- `[mc-toolchain/mod-common] 安全上下文回调执行失败: TypeError: cannot read property 'getComponent' of undefined` —— `teleporter` 的 `playerSpawn` 订阅。假人召唤同样触发该事件，`event.player` 可能是半初始化句柄；推迟若干 tick 后句柄已失效，内部 `getComponent` 的宿主成了 `undefined`。
- `[item-route] 视觉反馈失败: TypeError: cannot read property 'location' of undefined` —— `SortEffects` 直接遍历 `dim.getPlayers()` 并裸读 `p.location`。数组项可能是 `undefined` 或半初始化实体。

修复已落地为仓内统一的玩家守卫层，但**规格里几乎没有对应约束**：`mod-common` 只在「屏幕 HUD 逐玩家优先级仲裁」下写了一条「排除模拟玩家」，`item-route` 与 `teleporter` 一个字都没有，`auto-refill` 与 `spectator-mode` 虽有守卫条款但未写明判据、也未写明判据不得依赖 tag。更要紧的是，修复过程中撞到一条**架构级约束**没有落进任何规格：共享库不能在自己的返回值里泄漏 `Player` 类型，否则跨包类型冲突。

## What Changes

- `mod-common` 新增一条能力要求：提供**与 `Player` 类型无关**的玩家守卫工厂，由各模组绑定自己的 `Player` 类与在线枚举。守卫须提供可用性判定、假人判别、三级取名、安全枚举与单玩家调用隔离五件事，且判别 MUST NOT 依赖 tag。
- `mod-common` 的「排除模拟玩家」收窄为 HUD 的专属行为，并改为引用新的共享守卫，不再自带一套私有判别。
- `auto-refill` 的「模式与玩家守卫」补上判据：假人判别以 `getGameMode()` 抛错/缺失/返回 `undefined` 为准，MUST NOT 依赖 `mockplayer:tag:bot` 这类模组私有 tag（第三方假人模组不保证打我们的 tag）。
- `spectator-mode` 的「无效玩家对象守卫」改为复用共享守卫，并明确该模组的守卫绑定在本地完成。
- `item-route` 新增一条要求：所有玩家枚举与属性读取 MUST 经守卫，且位置/维度 MUST 在枚举时快照，调用方不得再裸读 `.location` / `.dimension`。
- `teleporter` 新增一条要求：`playerSpawn` 等可被假人触发的玩家事件，MUST 在事件入口与每个推迟回调的入口**各自**重新校验句柄，因为推迟期间假人可能已下线。

## Capabilities

### New Capabilities

无。本次不引入新能力，只是把已落地的行为写进既有能力的规格。

### Modified Capabilities

- `mod-common`: 新增「玩家对象守卫（真人/假人/坏句柄统一判别）」要求，含「共享库不得泄漏 Player 类型」的架构约束；现有「排除模拟玩家」收窄为 HUD 专属并改为消费共享守卫。
- `auto-refill`: 「模式与玩家守卫」补明假人判据，并禁止依赖模组私有 tag。
- `spectator-mode`: 「无效玩家对象守卫」改为复用共享守卫。
- `item-route`: 新增「模拟玩家与坏句柄容忍」要求，覆盖枚举、属性读取与位置快照。
- `teleporter`: 新增「假人可触发的玩家事件须双重校验」要求，覆盖事件入口与推迟回调入口。

## Impact

**代码（已落地，本变更负责把规格补齐）**

- `packages/mod-common/src/playerGuardCore.ts`（新增，纯核，可单测）
- `packages/mod-common/src/playerGuard.ts`（新增，只导出工厂）
- `packages/mod-common/src/HudManager.ts`（私有判别改为消费共享守卫）
- `packages/mod-common/src/index.ts`（导出守卫工厂）
- `packages/mod-common/tests/player-guard.test.ts`（新增 19 条用例）
- `mods/item-route/scripts/mc/util/playerGuard.ts`（新增绑定）
- `mods/item-route/scripts/mc/util/playerName.ts`（`namedPlayers` 返回位置快照）
- `mods/item-route/scripts/mc/effects/{SortEffects,WarehouseHUD,WarningRelay,NotifyRelay}.ts`
- `mods/item-route/scripts/mc/adapters/McProximityChecker.ts`
- `mods/item-route/scripts/mc/bootstrap/persistentBoundary.ts`
- `mods/item-route/scripts/mc/interaction/ToolInteractionController.ts`
- `mods/teleporter/scripts/mc/playerGuard.ts`（新增绑定）
- `mods/teleporter/scripts/mc/events.ts`（入口 + 两个推迟回调内各自校验）
- `mods/spectator-mode/scripts/mc/playerUtil.ts`（收敛到共享守卫）
- `mods/auto-refill/scripts/playerGuard.ts`（新增绑定）
- `mods/auto-refill/scripts/PlayerPolicy.ts`（删除 tag 白名单）

**跨包类型约束**

各模组钉的 `@minecraft/server` 版本不同（`teleporter` 2.3.0 / `item-route` 2.1.0 / `auto-refill` 2.1.0 / `spectator-mode` 2.1.0 / `mockplayer3` 2.8.0 / 根 devDependency 2.0.0），npm workspace 让每个包解析到自己那份声明，`Player` 类型跨包不兼容。共享库若在返回值里泄漏自己的 `Player`，模组侧会报 `Type 'Player' is missing the following properties from type 'Player': commandPermissionLevel, playerPermissionLevel, localizationKey`。

**测试环境约束**

`@minecraft/server` 在 Node 下不可加载，因此守卫实现 MUST 拆成「纯核 + 绑定」两层，纯核不 import 游戏运行时，才能被 `node --test` 直接覆盖。

**明确不改**

`mods/mockplayer3` 引擎内的 `bot.location` 等读取保持原样——那里的 `bot` 是模组自己创建并持有的 `SimulatedPlayer` 引用，不是从在线枚举来的，用真人守卫过滤会使假人逻辑整体失效。本变更不为它新增规格约束。
