# 生物 AI（Bio AI）

> 本文档描述 `scripts/ai/` 框架与 `scripts/features/ai/` 引擎+能力的实现约定。新增/修改生物 AI 行为前必读。

---

## 1. 定位

生物 AI 是 **新框架** 的假人自主行为系统，替换 `legacy/ai/BotBrain` 行为树。特点：

* 每假人一个 `AiBrain`（私有记忆 + 行为运行器），10 tick 集中式心跳驱动
* 能力 = `Behavior` 状态机（感知-决策-同步短步），而非 `while(true)` 常驻循环
* 能力间 **单主目标优先级抢占**（`BehaviorRunner`），工作模式单选 `record.workMode` 驱动

旧引擎（`legacy/ai` 宝库/钓鱼树 + `features/state/behavior.ts` 标签行为）仍并存，仅 legacy 内部使用。

```
scripts/
├── ai/                         # 框架（本目录）：零 @minecraft，可单测
│   ├── Behavior.ts             # Behavior 接口 + BehaviorRunner 调度
│   ├── Memory.ts               # AiMemory 私有记忆（每大脑）
│   ├── SharedMemory.ts         # SharedMemory 跨假人共享（全局单例+过期）
│   ├── Goal.ts / GoalSelector.ts / Sensor.ts / Status.ts / Tree.ts ...
│   └── AGENTS.md               # ← 本文档
└── features/ai/                # 引擎 + 能力（mc 层，有副作用）
    ├── brainEngine.ts          # 大脑引擎（10 tick 对账+驱动+记忆注入）
    └── capabilities/           # 各工作模式能力
        ├── wander.ts           # 闲逛（状态机）
        ├── mine.ts             # 定点挖掘（常驻协程）
        ├── place.ts            # 定点放置（常驻协程）
        ├── attack.ts           # 定点攻击（常驻协程）
        ├── fishing.ts          # 自动钓鱼（状态机+共享池）
        └── woodcut.ts          # 自动砍树（已在代码层禁用，保留文件）
```

---

## 2. 核心调度：`features/ai/brainEngine.ts`

```ts
const BRAIN_ENGINE_TICKS = 10;
system.runInterval(() => {
  for (const record of botRegistry.onlineAlive()) {
    const behaviorName = enabledBehaviorName(record); // BEHAVIOR_BY_NAME[record.workMode]
    if (!behaviorName) { disposeBotBrain(record.name); continue; }
    let brain = brains.get(record.name);
    if (!brain) brain = { memory: new AiMemory(), runner: new BehaviorRunner() };
    brain.memory.set("workMode", behaviorName); // 记忆注入
    if (brain.behaviorName !== behaviorName) { // 仅变化时重建
      for (const [name, make] of Object.entries(BEHAVIOR_BY_NAME)) {
        if (name === behaviorName) brain.runner.register(make());
        else brain.runner.unregister(name);
      }
      brain.behaviorName = behaviorName;
    }
    const bot = resolveBotPlayer(record.name); // 唯一实体解析入口，带缓存
    brain.runner.step({ botName: record.name, tick: system.currentTick, memory: brain.memory, bot, shared: sharedMemory });
  }
}, BRAIN_ENGINE_TICKS);
```

* **集中式心跳**：单一定时器每 10 tick 遍历所有在线假人，不是每假人独立 `runInterval`。
* **每假人独立大脑**：`brains: Map<botName, AiBrain>`，`AiBrain = { memory, runner, behaviorName }`，互不干扰。
* **共享记忆**：`sharedMemory: SharedMemory` 全局单例，`ctx.shared` 注入所有假人（见 `SharedMemory.ts` 过期策略 `renewing/fixed`，`startSharedMemorySweeper` 每 20 tick 清过期）。
* **幂等**：`engineStarted / sharedMemorySweeperStarted` 守卫；`BehaviorRunner.register` 同名去重；`brain.behaviorName` 变化才重建行为；`disposeBotBrain` 在切 `none`/下线时 `reset()` 中断协程（审核 S1：不能 `continue` 了事，后台 `breakBlockAt` 需中断）。

`BEHAVIOR_BY_NAME` 当前（`woodcut` 已禁用）：
```ts
{ wander: makeWanderBehavior, mine: makeMineBehavior, place: makePlaceBehavior, attack: makeAttackBehavior, fishing: makeFishingBehavior }
```

---

## 3. 行为契约：`ai/Behavior.ts`

```ts
export interface Behavior {
  readonly name: string;
  readonly priority: number; // 小优先
  canActivate(ctx: BehaviorContext): boolean; // 同步短查，每周期一次
  onActivate?(ctx: BehaviorContext): void;    // 切换/首次激活时
  step(ctx: BehaviorContext): void;           // 同步短步 <1ms，无循环无 await
  reset(): void;                              // 中止/切换时清状态
}
```

`BehaviorRunner.step(ctx)` 流程：

1. `active && !active.canActivate` → `active.reset()` 释放
2. 高→低选第一个 `canActivate` 的行为为 `selected`
3. `selected !== active` → `active.reset()` + `selected.onActivate(ctx)` + `active = selected`
4. `active.step(ctx)`（`try/catch` 隔离，异常 `reset` 并置空，不阻断其他 Bot）

**铁律（3.3.10 vault / 3.3.24 fishing 曾因裸 `continue` 同 tick 死循环触发 Watchdog）：**

* `step` 内禁止 `while/for + await` / 裸 `continue` 自旋
* 长等待用阶段计数 `wait--`，长协程用**短命 Promise 轮询**，绝不阻塞 `brainEngine` 主调度

---

## 4. 两套 Loop 写法（新增能力二选一）

### A. 常驻协程型（一直持续到卸载）—— `mine/place/attack`

适用：挖掘/放置/攻击这类“激活就持续干活”的。

```ts
// capabilities/mine.ts 范式
let token: CancelToken|undefined, runLoop: Promise<void>|undefined;
const sharedBot = { current: undefined }; // 双通道实体
function startLoop(botName){
  if(runLoop) return; // 幂等：已有则复用
  const t=createCancelToken(); token=t;
  runLoop=runMineLoop(botName,sharedBot,t,config).catch(...).finally(()=>{if(token===t)token=undefined;runLoop=undefined});
}
async function runMineLoop(botName, sharedBot, token, config){
  while(!token.cancelled){
    const bot = sharedBot.current?.isValid ? sharedBot.current : resolveBotPlayer(botName); // 双通道
    if(!bot) { await waitTicks(idleRecheckTicks, token); continue; }
    const target = viewBlock(bot, distance);
    if(!target){ await waitTicks(idleRecheckTicks, token); continue; }
    const r = await breakBlockOnce(bot, target.location, {token, requireLineOfSight:true});
    if(r==="aborted") return;
  }
}
return {
  name:"mine", priority:10,
  canActivate: ctx=>ctx.memory.get("workMode")==="mine", // 不依赖视线
  step: ctx=>{ sharedBot.current=(ctx as AiBehaviorContext).bot; startLoop(ctx.botName); },
  reset: ()=> token?.cancel(), // signal 唤醒 + 每 tick 检测
}
```

要点：`canActivate` 只认 `workMode`，`step` 只做幂等起协程，频率由协程内 `pollTicks/intervalTicks/idleRecheckTicks` 自控，不受 10 tick 限制；`waitTicks` 用 `Promise.race(runTimeout, token.signal)` 实现取消立醒。

### B. 状态机型（阶段推进）—— `wander/fishing`

适用：游走/钓鱼这类“阶段感强”的。

```ts
// capabilities/wander.ts 范式
type Phase="idle"|"pick"|"walk"|"rest";
let phase:Phase="idle", wait=rand(intervalMin,intervalMax), run:Promise<...>|undefined;
return {
  name:"wander", priority:10,
  canActivate: ctx=>ctx.memory.get("workMode")==="wander",
  step(ctx){
    switch(phase){
      case "idle": if(--wait>0) return; phase="pick"; break;
      case "pick": startRun(ctx.botName); phase="walk"; break;
      case "walk": if(runResult===undefined) return; ... phase="rest"; wait=rand(...); break;
      case "rest": if(--wait>0) return; phase="idle"; break;
    }
  },
  reset(){ if(lastBot) lastBot.stopMoving(); phase="idle"; }
}
```

`fishing` 同款但多了 `SharedMemory` 共享池（`FISH_POOL_KEY` 占用/失败标记，见 `rules/FishingPool.ts`）。

---

## 5. 记忆与共享

* `AiMemory`：每大脑私有 `Map<string,unknown>`，引擎每周期 `set("workMode", behaviorName)`，能力 `canActivate` 自校验用。
* `SharedMemory`：全局单例 `sharedMemory`，`ctx.shared` 注入。支持 `set(key,value,ttlTicks,strategy,nowTick)`，`strategy="renewing"`（默认，更新延 TTL）/`"fixed"`，`sweepExpired(nowTick)` 每 20 tick 独立计时器清理，`get/has` 惰性兜底。

---

## 6. 新增一个智能行为的 checklist

1. 在 `rules/` 写纯逻辑（零 `@minecraft`，可 `test:core` 单测）
2. 在 `features/ai/capabilities/<name>.ts` 实现 `Behavior`，选 A 或 B 范式；配置收敛到 `XxxBehaviorConfig`；实体走 `sharedBot` 双通道
3. 在 `features/state/behavior.ts` 的 `WORK_MODES` 加值（UI 下拉与引擎同源）
4. 在 `features/ai/brainEngine.ts` 的 `BEHAVIOR_BY_NAME` 注册 `name: makeXxxBehavior`
5. `step` 保持 <1ms，无 `while+await`；长活协程用 `CancelToken`，短协程用 Promise 轮询
6. `reset` 必须清状态 + `token.cancel()` / `stopMoving()`

---

## 7. 已知约束与历史坑

* `woodcut` 已在代码层禁用：`brainEngine` 注释掉导入/注册，`WORK_MODES` 移除，`Behavior` 文件保留但不调度。
* `step` 禁止裸 `while(true) continue` 自旋（Watchdog）。
* `resolveBotPlayer` 是实体唯一入口（含名称占用/区块未加载处理），行为内不要 `world.getPlayers` 自行解析。
* 能力卸载必须中断后台协程（`token.cancel()` + `stopMoving/stopBreakingBlock`），否则 `disposeBotBrain` 后后台仍挖到目标消失才停。

