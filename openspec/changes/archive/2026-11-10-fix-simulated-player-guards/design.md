# Design

## Context

动机见 `proposal.md` 的 Why 一节；行为契约见本 change 的 5 份 delta spec。

塑造本设计的三条既有事实：

1. **各模组的 Script API 版本不一致。** `teleporter` 2.3.0、`item-route` 2.1.0、`auto-refill` 2.1.0、`spectator-mode` 2.1.0、`mockplayer3` 2.8.0、根 devDependency 2.0.0。npm workspace 不做版本提升，每个包解析到自己那份 `@minecraft/server` 声明，两个 `Player` 类型互不兼容。
2. **测试进程加载不了游戏运行时。** `@minecraft/server` 在 Node 下 `require` 即失败（`Cannot find module '@minecraft/server'`）。仓内既有先例是 `runSafeCore.ts`（纯核）+ `runSafe.ts`（绑定）的两层拆法。
3. **假人判据必须跨模组成立。** 第三方假人模组不会打我们的 tag，`mockplayer:tag:bot` 只对 `mockplayer3` 自己有效。

## Goals / Non-Goals

**Goals:**

- 一个仓内唯一的假人/坏句柄判别入口，所有模组共用同一结论。
- 判别逻辑可在无游戏进程的 Node 环境单测。
- 共享库与模组之间不产生 `Player` 类型冲突，且这条约束不靠人记——靠 API 形状强制。

**Non-Goals:**

- 不接管模组自己创建并持有的假人引用（`mockplayer3` 引擎内的 `bot` 属于此列，读其 `location` 是其核心业务，用真人守卫过滤会使功能整体失效）。
- 不统一各模组的 `@minecraft/server` 版本。那是独立议题，本次只在类型层面隔离。
- 不为假人补齐属性。假人缺属性是运行时事实，守卫的职责是识别与跳过，不是模拟。

## Decisions

### D1：守卫拆成纯核 + 绑定两层

`playerGuardCore.ts` 导出 `createPlayerGuard(isInstance)`，接受一个实例判定谓词，返回全套守卫函数；`playerGuard.ts` 只导出工厂，不 import 游戏运行时。

**为什么**：`isInstance` 是唯一需要 `@minecraft/server` 的依赖（`p instanceof Player`）。把它参数化后，纯核零游戏依赖，`node --test` 可直接加载；测试注入 `p => p instanceof FakePlayer` 即可覆盖全部分支。

**否掉的替代**：让测试 mock `@minecraft/server` 模块。否掉的理由是 mock 整个官方 API 面（`Player`、`world`、`EntityComponentTypes`…）维护成本高且与真实类型漂移；参数化一个谓词只需一行。

### D2：共享库不导出绑定好的守卫实例

`index.ts` 只导出 `createPlayerGuard` / `createWorldPlayerGuard` 两个工厂，每个模组在自己的 `playerGuard.ts` 里绑一份。

**为什么**：这是本次唯一踩到运行时错误才发现的约束。最初 `index.ts` 直接导出 `isUsablePlayer`、`safePlayers` 等现成函数，`item-route` 一消费就报：

```
error TS2739: Type 'Player' is missing the following properties from type 'Player':
commandPermissionLevel, playerPermissionLevel, localizationKey
```

因为 `safePlayers` 的返回类型里带着 mod-common 自己那份 `Player`（解析到根 `node_modules` 的 2.0.0），而 item-route 的 `Player` 来自 2.1.0。把工厂参数化后，返回类型由调用方的 `P` 决定，冲突消失。

**否掉的替代**：把 `@minecraft/server` 提成 peerDependency 并统一版本。理论正确，但要动 6 个包的依赖声明并重新验证全部模组，风险远大于本次目标；且版本统一后仍会有人再钉不同版本，API 形状强制比约定可靠。

### D3：假人判据用 `getGameMode()` 探测

`isSimulatedPlayer` = 对象可用 且（`getGameMode` 不是函数 或 调用抛错 或 返回 `undefined`）。

**为什么**：假人不实现游戏模式，这是官方实现层面的空缺，跨任意假人模组成立。而 tag 是模组私有约定，第三方不会遵守。

**代价**：每次判别要调一次 `getGameMode()`，抛错路径有异常开销。实测场景下玩家数量是个位数到几十，且只在事件回调与 HUD 渲染时触发，可接受。

**否掉的替代**：`instanceof SimulatedPlayer`。否掉因为它要求 `@minecraft/server-gametest`，且第三方假人未必是官方 `SimulatedPlayer`。

### D4：`namedPlayers` 返回位置快照而非玩家对象

`item-route` 的 `namedPlayers` 现在返回 `{ player, name, dimensionId?, position? }`，`dimensionId` 与 `position` 是枚举时一次性读好的副本。

**为什么**：原实现返回裸 `Player`，调用方各自 `.location.x` —— 这正是 `cannot read property 'location' of undefined` 的来源。快照把「读一次、可能失败」收敛到枚举处，调用方拿到的是普通对象字面量，后续异步流程不再碰玩家属性。

`position` 定为可选而非必选：取名与取位置是两件事，取名成功但位置读取失败时仍应保留该玩家（成员判定、消息播报不需要位置）。调用方据 `position === undefined` 显式跳过。

**否掉的替代**：位置读失败即丢弃该玩家。否掉因为它会把「瞬态读不到坐标」升级成「该玩家凭空消失」，成员判定与预警播报都会漏人。

### D5：推迟回调内二次校验

`teleporter` 的 `playerSpawn` 处理在事件入口校验一次，在两个 `system.runTimeout` 回调内部**各自再校验一次**。

**为什么**：入口校验通过只说明「此刻可用」。推迟 2~3 tick 期间假人可能已被移除、真人可能已断线，句柄失效后 `getComponent` 的宿主变 `undefined` —— 这正是报错的完整路径。入口校验 + 回调内校验是两道独立防线，缺任一道都复现原 bug。

### D6：命令入口拒绝假人而非推迟后静默丢弃

`item-route` 的 `registerPlayerCommand` 在 `registry.registerCommand` 回调入口就调用 `playerGuard.isSimulatedPlayer`，命中即返回 `{ status: Failure, message: "该命令不能由模拟玩家执行" }`，不进入 `runSafeDetached`。

**为什么**：早先的实现只在推迟回调内 `return`，结果是假人执行命令时玩家看不到任何反应，服务器也不留痕迹——比报错更难排查。命令返回值是玩家可见的唯一反馈面，入口拦截既阻断问题路径又给出可读原因。

**代价**：多一次 `getGameMode()` 探测（每条命令一次），可忽略。

### D7：命令处理器不裸读玩家名，改由上下文交付

`CommandContext` 新增 `playerName: string` 字段，由守卫的 `playerNameOf` 三级兜底（`name` → `playerName` → `nameTag`）解析后传入。`create` / `delete` / `rescan` / `rescanPreview` / `resize` / `search` 六条命令里原有的 `player.name` 全部替换为 `playerName`。

**为什么**：假人与半初始化实体的 `name` 可能抛错或为空，而成员判定、owner 记录都依赖这个名字。把解析责任收在单一入口，处理器就无法再犯同类错误。

### D8：位置/维度读取一律走 `safePlayerCall` 快照

凡命令或界面需要玩家坐标/维度，都写成 `playerGuard.safePlayerCall(player, p => ({ dimensionId: p.dimension.id, position: ... }))`，取到 `undefined` 时按「读不到位置」回退（提示重试或退回列表），MUST NOT 裸读 `player.location`。

**为什么**：实测报错 `cannot read property 'location' of undefined` 的触发点就在这里——推迟一 tick 后句柄失效，`player` 本身变成 `undefined` 宿主。快照把「一次可能失败的读取」和「后续多次使用」解耦。

## Risks / Trade-offs

- **`getGameMode()` 探测有异常开销** → 只在事件回调与 HUD 渲染路径调用，不在 tick 循环内逐玩家反复探测；`safePlayers` 每轮枚举每个玩家只探测一次。
- **快照会过期** → 快照在枚举时刻有效，若调用方把它存进长生命周期结构，坐标会失真。缓解：`namedPlayers` 的返回值只用于当前这一轮判定，不做缓存；这一点写进 `item-route` 侧注释。
- **共享库仍可能被误用为「直接 import 现成守卫」** → 现在没有现成实例可 import，误用在编译期就失败，比文档约定可靠。
- **各模组重复一份 4 行绑定** → 有意为之。绑定的本质就是「绑定到我这份类型」，集中化会重新引入 D2 的类型冲突。
- **`position` 可选带来调用方负担** → 每个消费点必须显式判空，否则 TS 报 `possibly 'undefined'`。这是编译期强制的，不会漏。

## Migration Plan

代码已落地（见 `proposal.md` 的 Impact）。本 change 的落地顺序：

1. 主 specs 按 5 份 delta 合并（`/opsx-archive` 时执行）。
2. 无回滚需要——守卫是纯增量防御，移除只会让旧 bug 复现，不影响既有正常路径。

## Open Questions

- `getGameMode()` 探测在极端情况下（某第三方假人模组实现了该方法但返回假值）可能误判为真人。当前无此案例，待出现再收紧。
- 各模组 `@minecraft/server` 版本最终是否统一，是独立议题，不影响本设计成立。
