# Design

## Context

动机见 `proposal.md — Why`;行为契约见 `specs/teleporter/spec.md`。

现状与约束:

- `mods/teleporter` 现有传送是同步的:`scripts/mc/teleport.ts` 的 `teleportPlayerTo` / `teleportToSavedPoint` 返回 `boolean`,调用方拿到结果后立即累加计次并提示。七个调用点分布在 `mc/commands.ts`、`mc/warpService.ts`、`mc/requests.ts`、`mc/events.ts`、`mc/ui/deathPoints.ts`、`mc/ui/publicWarps.ts`、`mc/ui/playerTeleport.ts`。
- 分层约定:`scripts/core/` 是纯逻辑,不 import `@minecraft`,由 `node --test` 经 `tests/tsconfig.json` 编译到 `.test-build/` 后运行;`scripts/mc/` 是唯一接触 `@minecraft/*` 的适配层。
- 相机相关成员(`Camera.setCamera` / `fade` / `clear` / `setDefaultCamera` / `setFov`)全部标注「can't be called in restricted-execution mode」,必须走安全上下文。命令回调本身是只读上下文,现有代码已统一经 `@mc-toolchain/mod-common` 的 `runSafeDetached` 推迟。
- `PlayerInputPermissions.setPermissionCategory(InputPermissionCategory, boolean)` 可逐类开关输入,`InputPermissionCategory.Movement` 已覆盖跳跃、潜行、横向移动、上下载具。
- `TickingAreaManager.createTickingArea(identifier, options)` 可创建临时 ticking area 用于区块加载,按 identifier 释放。
- 没有「传送完成」事件,也没有「玩家相机是否被接管」的查询接口;`PlayerDimensionChangeAfterEvent` 只在真正跨维度时触发。
- 上游 `TeleportTransitionController` 是 1480 行的客户端渲染侧实现,依赖 `LocalPlayer`、`CameraType`、`Options.hideGui`、`Minecraft.getInstance().levelRenderer` 等客户端专有对象,无法逐行照搬;可移植的是**时序、缓动、位姿公式与音效点**这四样纯数值/纯事件的东西。

## Goals / Non-Goals

**Goals:**

- 让运镜的数值行为(阶段顺序、tick 数、高度、缓动曲线、抖动波形)与上游一致到「肉眼看不出差别」的程度,并且这部分能用 `node --test` 覆盖。
- 把「转场」做成传送的**执行方式**而非附加特效:位移提交点落在横越阶段,让拉远与横越的 2–4 秒成为落点区块的加载窗口。
- 七个调用点的改动只涉及「等待结果」,不重写各自的业务逻辑(计次、提示、鉴权、公共可见性判定)。
- 新增配置字段对老存档零迁移成本。

**Non-Goals:**

- 不移植上游的自定义音效模式(素材为 ZapSplat 付费授权,不可随 MIT 分发),只保留原版音效映射。
- 不移植上游的远景地形兼容(Voxy / Distant Horizons / Bobby)与区块逐块淡入,基岩版没有对应能力。
- 不移植上游的传送来源嗅探(`/tp`、`/execute run tp`、JourneyMap、Waystones、命令方块),本模组的传送入口是封闭且自有的。
- 不移植上游的 HUD 淡出与本地玩家模型隐藏:`Player.camera.setCamera` 切到自由相机后玩家模型本就不可见,HUD 淡出在基岩版需要 `hideGui` 之类的客户端选项,脚本 API 不提供。
- 不做运镜路径上的地形碰撞或高度自适应(上游也没有,相机可以穿山)。

## Decisions

### 用逐 tick 写 `minecraft:free` 位姿,而不是 `Camera.playAnimation` 样条

`Camera.playAnimation(CatmullRomSpline | LinearSpline, ...)` 看起来更省事,但只有两个缺点决定不能用:样条只能给定控制点,无法在曲线中途叠加**依赖 tick 编号的双正弦抖动**(抖动相位必须与 tick 对齐才能复刻上游波形);且样条播放期间无法按阶段插入音效与位移提交。逐 tick 写入则完全可控,代价是每 tick 一次 API 调用(20 次/秒/玩家,量级可忽略)。

替代方案:用 `easeTime` 让引擎在两次 `setCamera` 之间插值,只每 3–4 tick 写一次。已采纳为**补充**而非替代——每 tick 仍写入,但带上 `easeTime ≈ 1/20 秒` 与 `easeType: Linear`,让引擎在低帧率设备上补间,避免丢帧时出现硬跳。

### 相机位姿计算放在 `core/transition.ts`,API 调用放在 `mc/transition.ts`

沿用现有分层:`core/transition.ts` 只接收「起点脚部坐标 / 落点脚部坐标 / 起点朝向 / 当前 tick / 配置」并返回 `{ position, yaw, pitch }`,不引用任何 `@minecraft` 类型(坐标用本地 `Vec3` 结构)。这样上游的 1480 行数值逻辑可以被单测直接钉住:阶段边界 tick、各阶段高度、缓动端点、抖动方向都能断言,而不需要启动游戏。

`mc/transition.ts` 只做四件事:驱动 `system.runInterval`、把位姿写进 `player.camera.setCamera("minecraft:free", ...)`、管理输入权限与音效、以及失败时的清理。

### 位移原语独立成 `mc/teleportPrimitive.ts`

`mc/teleport.ts` 需要调用转场,转场在横越阶段需要调用「把玩家挪过去」,直接互相 import 会形成循环依赖。把最底层的位移(`teleportImmediate(player, location, dimensionId)`)抽成独立模块,两侧都只依赖它,`mc/teleport.ts` 再重新导出以保持既有调用方的 import 路径不变。

### `teleportPlayerTo` / `teleportToSavedPoint` 改为返回 `Promise<boolean>`

转场是异步的,「是否传送成功」只有在转场结束(或降级)后才知道。改签名为 `Promise<boolean>` 是最小侵入的表达方式:调用方从 `const ok = teleport(...)` 变成 `const ok = await teleport(...)`,内部的计次与提示逻辑一行不动。转场关闭时该 Promise 立即 resolve,行为与今天完全一致。

替代方案:回调式 `teleportPlayerTo(player, target, onDone)`。否决原因是七个调用点里有四个本身已经在 `async` 函数内,`await` 比回调嵌套更短且不会漏掉错误分支。

### 跨维度用 `Camera.fade` 降档,而不是尝试跨维度运镜

相机是绑在玩家连接上的,玩家换维度时相机被引擎重置。上游能跨维度是因为它把相机挂在客户端 `LevelRenderer` 上。基岩版的可行做法只有淡入淡出:按 `fadeIn 0.2s / hold 0.15s / fadeOut 0.3s` 遮黑,在 hold 段内完成 `teleportImmediate`,恢复后玩家已在落点。判定依据是「起点维度 id ≠ 落点维度 id」,与风格无关——即使风格是电影感,跨维度也走这条路径。

### 转场是位移的包裹层,位移提交点由「横越起点」决定

`playTransition` 的契约是:调用它就代表「这次位移由我负责」。它在横越阶段的第一 tick 调用 `teleportImmediate` 完成位移,之后推近与入体阶段的相机坐标全部相对**落点**计算。这样:

- 拉远(39 tick)+ 等待(10 tick)+ 横越(20–60 tick)天然成为落点区块的加载窗口,不需要额外的等待逻辑;
- 相机在横越期间始终看向落点方向,不会出现「相机飞到一半玩家还在原地」的错位;
- 转场降级时只需补一次 `teleportImmediate` 即可保证传送不丢。

### 落点区块用临时 ticking area 预加载,失败不阻塞

运镜开始时在落点所在维度创建 identifier 为 `teleporter:transition/<玩家id>` 的 ticking area,范围取 3×3 区块(覆盖玩家视野中心),转场结束或被中断时释放。创建失败(名额已满、维度不可用)只记录日志,不抛错、不改变转场流程——预加载是**优化**,不是前置条件。这也让「加载失败仍完成传送」这条 spec 场景有直接对应的实现路径。

替代方案:靠 `Dimension.getBlock` 逐块探测触发加载。否决原因是每次探测都是一次跨边界调用,3×3 区块 × 数千方块不可接受。

### 输入冻结用 `Movement` 一类,而不是逐类开关

`InputPermissionCategory.Movement` 的文档明确「disabling this is equivalent to disabling jump, sneak, lateral movement, mount, and dismount」,一次调用即可,恢复时也只需一次。相机输入(`Camera`)单独关掉,防止玩家在自由相机下自行转视角。

冻结状态记录在转场会话里,恢复时**置回 true** 而非「置回原值」——本模组是唯一会关这些开关的地方,没有其它系统与之争抢;若将来出现争抢,再引入引用计数。

### 超时兜底与离线清理

每个转场会话记录 `startTick` 与预期总时长。`system.runInterval` 的驱动里先检查:玩家句柄是否可用、玩家是否仍在原维度、tick 是否超过预期总时长的 2 倍 + 20。任一命中即走 `finish(reason)`:`camera.clear()`、恢复输入、释放 ticking area、清 Map 条目、`teleportImmediate` 到落点(若尚未提交)、resolve 挂起的 Promise。另外订阅 `playerLeave` 与 `entityDie` 主动清理。

这条兜底是 spec 里「异常后不永久冻结」的唯一实现手段,不可省略。

### 配置结构:总开关 + 风格 + 按维度的变焦表

```ts
transitionEnabled: boolean            // 默认 true
transitionStyle: "cinematic" | "fade" | "off"   // 默认 "cinematic"
transitionZoomHeights: {              // 三段高度,按维度
  overworld: [20, 40, 60]
  nether:    [20, 40, 60]
  end:       [20, 40, 60]
}
transitionZoomTicks: [13, 13, 13]     // 段时长,不分维度
transitionVolume: 0.5                 // 音效音量
```

`transitionEnabled=false` 与 `transitionStyle="off"` 语义等价(前者是后者的快捷方式),归一化时统一收敛到 `"off"` 以避免出现两个真值来源。字段名用完整单词(`transition` 而非 `fx`、`zoomHeights` 而非 `zh`),符合项目命名约定。

高度表按维度分三套但段时长共享,与上游一致:上游的 `zoomInStageTicks1..3` 也不分维度。

## Risks / Trade-offs

- **逐 tick `setCamera` 在低端设备上可能抖动或丢帧** → 每帧附带 `easeTime = 1/20` + `Linear` 让引擎补间;抖动幅度本身很小(偏航 <1°),丢一帧不会造成可感知跳变。
- **相机 API 属受限成员,误在只读上下文调用会抛错** → 所有转场入口都在 `runSafeDetached` 之内;`playTransition` 内部再做一次 `system.run` 兜底,确保即使被同步调用也不在只读上下文执行相机写入。
- **输入冻结未恢复会让玩家卡死** → 三重保障:`finish()` 统一恢复、超时兜底强制 `finish()`、`playerLeave` / `entityDie` 主动清理。
- **转场把「传送成功」的判定时点后移 1.5–4 秒** → 期间玩家看到的不是「无响应」而是正在播放的运镜,且输入已被冻结,不会误操作;提示文案统一改为转场结束后发出,避免「提示已到但人还在飞」。
- **落点区块在远距离横越时可能仍来不及加载** → ticking area 预加载缓解;接受「相机抵达时地形刚出现」的观感损失,不做逐块淡入(基岩版无此能力)。
- **工作区残留上次移植的编译产物(`lib/`、`.test-build/`),无对应 `.ts` 源码** → 以其为参考重写,重写完成后清理这些陈旧产物,避免与新实现混淆或误被测试跑到。
- **`transitionStyle="fade"` 与跨维度降档在观感上难以区分** → 这是有意为之:跨维度就是「只能淡入淡出」的特例,不需要第二套视觉语言。

## Migration Plan

1. 配置字段全部为新增且带默认值,`normalizeConfig` 对缺失字段回落默认,老存档直接可用,无需迁移脚本。
2. `teleportPlayerTo` / `teleportToSavedPoint` 的签名从同步改异步,属于**编译期**破坏性变更:七个调用点必须同时改,漏改会在 `tsc` 阶段报错而非运行时静默失败。这是一次性提交的原子改动。
3. 回滚策略:把 `transitionEnabled` 默认值改为 `false` 即可让全部入口退回即时位移,无需回退代码;若需完全回退,`mc/transition.ts` 与 `core/transition.ts` 是独立新增文件,删除后恢复 `teleport.ts` 的同步实现即可,其余调用点不受影响。
4. 分两步落地:先提交 `core/transition.ts` + 单测(纯逻辑,零风险),再提交适配层与调用点改造(有行为变化)。

## Open Questions

- 三段高度是否需要在管理界面暴露到「逐维逐段」的粒度?spec 只要求「管理员能调整」,界面层级可在实现时按表单可用空间决定;若过于拥挤,先只暴露主世界一套并给命令入口补全,不改变 spec。
- 音效音量是否需要独立于 `transitionVolume` 的「原版音效 / 关闭」二选一开关?当前设计只留音量,音量 0 即静音;若实测发现玩家更常想「静音但保留运镜」,可在实现时补一个布尔项,不影响 spec 的「音量 MUST 可配置」。
