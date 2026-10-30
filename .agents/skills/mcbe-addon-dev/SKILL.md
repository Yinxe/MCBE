---
name: mcbe-addon-dev
description: MCBE Addon 开发工作流（本仓库）。修改 mcaddon/* 的 TypeScript 模组或排查游戏内问题时使用：先按分层模型读懂调用链，再按症状定位到具体层与文件，最后在正确层修复或新增能力。也覆盖 engine 原子、命令、持久化、测试与发版纪律。
---

# MCBE Addon：理解、定位、改动

## 何时使用

- 要改一个功能，但不确定代码在哪一层、该动哪个文件。
- 游戏内“没反应/不生效/报错”，需要缩到具体函数。
- 要新增工作模式、能力、引擎原子、命令或持久化结构。
- 要新建 Addon 或调整构建/测试。

先读本文件；需要具体文件地图时读 `references/mockplayer3.md`，需要 API/测试细节时读 `references/runtime-and-testing.md`。模块 `AGENTS.md` 是事实与红线，不与本文件重复。

## 1. 心智模型

所有功能都沿一条主链走，反向依赖不存在：

```
玩家 / 命令 / 面板
        │ 意图（只翻译，不做业务）
        ▼
interface ──→ application（Lifecycle / Modes / Scheduler）
                    │ 决策与节拍
                    ▼
              capability（相位机，无实例状态）
                    │ 一次原子操作
                    ▼
                 engine（唯一直接调用 ScriptAPI）
                    │
                    ▼
              @minecraft/server + DP

domain：被以上各层引用，自己不依赖任何层，零 @minecraft / 零 IO
```

一句话：**命令改意图，application 定流程，capability 管节拍，engine 做一次原子，domain 存规则。**

### 状态放在哪

| 状态                                         | 位置                                               | 生命周期 |
| -------------------------------------------- | -------------------------------------------------- | -------- |
| 假人档案（名字、主人、家点、workMode、配置） | `BotRecord`，由 `RecordStore` 落盘                 | 跨上下线 |
| 在线会话（epoch、租约、当前能力、脏字段）    | `Session`（`domain/Session.ts`）                   | 一次上线 |
| 模式私有状态（相位数据、在途目标）           | `session.capability.data[<能力名>]`，经 `ctxOf` 取 | 跟随会话 |
| 模式节拍                                     | `session.capability.phase.nextWakeAt`              | 跟随会话 |
| 世界物品                                     | 物品仓 + DP 键（`mp:item:*` 等）                   | 持久     |

### 生命周期

`REGISTERED → SPAWNING → RESTORING → ACTIVE ⇄ WORKING`，异常分支到 `DYING`（可 `respawn` 回 `RESTORING`）或 `OFFLINE`。`RESTORING/DYING` 是冻结窗，SaveGate 拒绝常规写；只有 `WORKING` 会被调度器驱动能力。

## 2. 读代码的顺序

不要从目录树随机翻。以下路径以 `mcaddon/mockplayer3` 为例；其他模块按“入口 → 决策 → 原子 → 适配”找对应文件。按“入口 → 决策 → 节拍 → 原子 → 适配”读：

1. `scripts/main.ts`：启动顺序、事件桥、装配时机。
2. `scripts/Composition.ts`：所有单例与能力注册；跨层依赖图只在这里。
3. `scripts/domain/Record.ts`、`Catalog.ts`、`Session.ts`、`Leases.ts`、`Capability.ts`：数据形状、模式目录、会话、租约、能力契约。
4. `scripts/application/Lifecycle.ts`、`Modes.ts`、`Scheduler.ts`：状态机、模式切换、每 tick 驱动。
5. 与功能同名或最近的 `scripts/application/Capabilities/<Xxx>.ts`：看相位机如何推进。
6. 它调用的 `scripts/engine/<Atom>.ts`：看一次原子操作的输入、结果与回读。
7. 对应 `scripts/interface/Commands.<Group>.ts` 或 `Panels/`：看用户意图如何进入。
8. `docs/features/<功能>.md` 与 `tests/`：确认产品语义与离线覆盖。

读一个能力时问五个问题：

- 谁创建/销毁它？→ `Modes.change` / `stopCurrent`。
- 它占什么资源？→ `requires()` 与 `leases.renew`。
- 它什么时候醒？→ `phase.nextWakeAt` 与各分支的 `setPhase`。
- 失败怎么表达？→ engine 结果联合 + 中文 `reason` / `autoStop`。
- 哪些状态要落盘？→ `saveGate.mark` / `record.*` / DP 键。

## 3. 定位 bug

### 3.1 先沿链取证据

按调用链逐段确认，不要跨层猜：

```
命令/面板
  → Lifecycle.<action>（权限、状态）
  → Modes.change（配置、实验闸、状态、租约、start 返回值）
  → Capability.tick（phase、nextWakeAt、前置条件、engine 返回值）
  → engine atom（结果联合）
  → Hooks / SaveGate（报脏、落盘）
  → DP / 世界观测
```

每段只回答一个问题：**意图有没有进来？决策有没有放行？节拍有没有到？原子返回了什么？状态有没有写出去？**

### 3.2 按症状定位

| 症状                           | 先看                                                                     | 常见原因                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 命令提示无权限/不存在/不可切换 | `interface/Commands.*` → `Lifecycle.changeWorkMode`                      | 主人/管理员校验、假人不在线、`state` 不是 `ACTIVE/WORKING`                                 |
| 模式切换被拒                   | `application/Modes.ts#change`                                            | 模式被管理员禁用、`experimental` 未开总闸、租约被占、`start` 返回中文原因                  |
| 模式已启动但假人不动           | 对应 `Capabilities/<Xxx>.ts#tick`                                        | `phase.nextWakeAt` 未到、前置条件不满足（空手/无目标/离线）、engine 返回失败后进入低息重探 |
| 定点放置/挖掘无落块            | `Place.ts` / `Mine.ts` 的 `track` 与 `engine/Placer` `Breaker`           | 主手不是方块/工具、准星无目标、支撑面被占、补货失败                                        |
| 假人不上线/重名/生成后消失     | `Lifecycle.handleSpawn`、`engine/Spawner`、`engine/Rig`、`EntityGateway` | 名字未释放 ≥20t、旋转锁回、装置未就绪、验名失败                                            |
| 上线后物品/状态被清            | `engine/SaveGate`、`Session.epoch`、`Composition.persist*`               | 恢复未完成就写、epoch 仍为 0、冻结窗未挡                                                   |
| 面板没反应/命令注册失败        | `interface/CmdKit.ts`、`Panels/`                                         | 枚举未先注册、`beforeEvents` 内触世界、未 `system.run`                                     |
| 游戏规则没恢复                 | `engine/Rig`                                                             | `finally` 写回被跳过、写回值取自当前值                                                     |
| 旧档迁移没触发                 | `engine/Migrator`、manifest `module_name`                                | 命名空间不一致、旧键枚举不到                                                               |
| 能力 tick 抛异常后模式自动停   | `application/Scheduler.ts`                                               | 能力内部异常 → `forceIdle`；修能力，不要关调度器异常隔离                                   |

### 3.3 修复放在正确的层

| 问题性质                                  | 落点                                     |
| ----------------------------------------- | ---------------------------------------- |
| 判定规则、解析、归一化、状态机错误        | `domain/`，补 `tests/domain.*.test.ts`   |
| 一次世界操作失败、回读不一致、结果码缺失  | `engine/` 原子，返回结果联合，不抛异常   |
| 多步流程、跨 tick、租约/相位/保存顺序错误 | `application/`（能力或 Lifecycle/Modes） |
| 命令/面板文案、参数、权限入口错误         | `interface/`，只翻译意图                 |

修复后必须回答：**同一 bug 能否在离线测试中复现？** 能，就补回归测试；不能，明确写“仅实机验证”，并给出验证步骤。

### 3.4 常见误判

- “没动作”可能不是 bug：能力在空手/无目标时按设计低息重探，等补货/目标出现即恢复。
- “tick 没跑”先查 `state === "WORKING"` 与 `now >= phase.nextWakeAt`，不是先查引擎。
- “保存没生效”先查 `epoch` 与冻结窗，不是先重写存储。
- “命令没注册”先查枚举注册顺序与命名空间，不是改命令名。
- 日志用 `console.warn("[mockplayer3] …")`；开启运行时 `debugLog` 可拿到更多装配/迁移信息。

### 3.5 完整追踪示例：place 已启动但不放块

1. 命令层：`mp:work <假人> place` 返回成功 → 意图已进入，排除权限与命令注册。
2. 决策层：日志出现“模式切换 … → place”，说明配置/实验闸/状态/`hands` 租约预取都通过 → 排除启动拒绝。
3. 节拍层：`Place.tick` 的 `LAY` 拍读 `placer.mainhandKind`：
   - `empty` 且 `ctx.blockTypeId` 未设：首次空手启动，按设计低息重探，不是 bug；给方块后应恢复。
   - `empty` 且 `blockTypeId` 已设：`refillMainhand` 返回 `no-match` → 背包没有同种方块，补料或换料。
   - `block`：`beginPlace` 返回 `no-target`/`unchanged` → 查准星目标、支撑面是否被占、方块是否可放置。
4. 原子层：`endPlace` 回读未落块 → 查 `Placer` 的支撑面校验与扣料语义，不要先改相位。
5. 修复落层：判定规则进 `domain`，方块写入/回读进 `Placer`，节拍与补货时机进 `Place`，命令层不加特判。

## 4. 新增能力

以新增工作模式 `example` 为例，完整接线如下。每一步都不可省：

1. **类型**：在 `domain/Record.ts#WorkMode` 加入 `"example"`。
2. **目录**：在 `domain/Catalog.ts#WORK_MODES` 加一项：
   `{ id: "example", label: "示例", help: "一句话行为", requiresLeases: ["hands"], tier: "base" }`。
   未验收的功能加 `experimental: true`，受管理员总闸约束。
3. **能力文件**：新建 `application/Capabilities/Example.ts`，实现 `Capability`：

```ts
export class ExampleCap implements Capability {
  readonly id = "example" as const;

  requires(): LeaseRequest[] {
    return [{ kind: "hands" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf<ExampleCtx>(cap.data, "example", () => ({ step: 0 }));
    cap.phase = { name: "WORK", nextWakeAt: now + 1 };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap) return;
    const ctx = ctxOf<ExampleCtx>(cap.data, "example", () => ({ step: 0 }));
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);

    const result = someAtom.doOnce(session.botId);
    // 只根据结果推进相位；不要在这里 await 或自旋
    setPhase(session, result === "ok" ? 5 : 20, "WORK", now);
  }

  stop(session: Session, _now: number): void {
    // 取消在途动作、恢复视角/潜行、释放占用；必须幂等
  }
}

function setPhase(session: Session, delay: number, name: string, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + delay };
}
```

4. **注册**：在 `Composition.ts` 的能力注册区加 `modes.register(new ExampleCap(...));`。未注册的模式会被 `Modes.change` 拒绝，不会静默启动。
5. **入口**：`mp:work` 的模式值表与帮助由 `Catalog` 派生，通常无需新命令；只有特殊语义才加 `Commands.*`，且处理器只调 `Lifecycle`/`Modes`。
6. **文档**：新增 `docs/features/example.md`，写清触发、相位、失败与恢复语义。
7. **测试**：纯规则进 `tests/domain.*.test.ts`；跨 tick/引擎模拟进 `tests/engine.*Sim.test.ts` 或 `tests/sim.*.test.ts`。
8. **验证**：`npx tsc --noEmit -p tsconfig.json` + `pnpm run test:core`；实机冒烟后再谈版本号。

能力铁律：

- 能力是全局单例，**零实例状态**；所有私有状态挂 `session.capability.data`。
- `tick` 同步、短、无 `await`、无自旋；等待只写 `nextWakeAt`。
- 占用的资源每拍 `renew`；`stop` 必须取消在途动作并恢复现场（视角、潜行、移动）。
- 可恢复的缺失（空手、无目标、离线）用低息重探或 `autoStop`，不要默默 `return` 让状态卡在 `WORKING`。
- 失败用 engine 结果联合分支处理；不要用异常做正常控制流。

## 5. 其他扩展点

- **engine 原子**：导出单例，方法完成“读 → 写 → 回读”，失败返回结果联合；成功后经 `engine/Hooks.ts` 报脏/发领域事件；不 import application。
- **命令**：在 `interface/Commands.<Group>.ts` 声明 `CommandSpec`，枚举必须先 `registerEnum` 且名带命名空间；处理器只做解析、校验、转交与回执。
- **持久化**：新键带模块前缀与 botId；读入归一化；跨版本“写成功才删旧键”；不把高频数据塞进整条读写的 `BotRecord`。
- **装配**：新单例进 `Composition.ts` 的 `services`；不要在模块内各自 `new`，避免双写者。

## 6. 代码与注释风格

- 注释只写事实与约束（几何、时序、不变量、失败语义），不写设计史、复核日期或归档对位。
- 台账只留可查的 F-NN；`ADR-N`/`D-0N`/`FR-xxx`/`NFR-xxx`/`章§` 不写，缺NN 只进提交信息。
- 一行一个事实，≤110 显示列（汉字计 2 列）；不用加粗、emoji、圈号等装饰。
- 平实中文：不自造比喻、不把状态压成单字账目；标准是没读过设计文档的人也能看懂。
- 导出符号的 JSDoc 保留 `@param`/`@returns`/`@throws`；`// eslint-disable*`、`// @ts-*` 等功能性指令逐字保留。
- 自检：`git grep -nE '(ADR-[0-9]|D-0[0-9]|FR-[A-Z][0-9]+|缺[0-9]{2}|用户(规格|实测) ?20[0-9]|吃额度|翻篇|收摊|吞界面|挡门|串账|黑标|前嫌|大赦|(贴靠|失败|在途|节流|许可)账|出账|入账|只认主手|不认就|拒收)' -- scripts tests`，命中的注释应为 0（字符串字面量与测试名除外）。

## 7. 验证与发版

```bash
npx tsc --noEmit -p mcaddon/<mod>/tsconfig.json
pnpm --filter <pkg> run test:core
git status --short        # 确认没有顺手改 manifest 版本
```

日常不要跑 `build`/`pack`（会改写 manifest）；版本红线见根 `AGENTS.md` 与模块 `AGENTS.md`。

改完自查：

- `domain/` 是否仍然零 `@minecraft`、零 IO？
- `application/` 是否没有直接 import `@minecraft`，也没有 import `interface`？
- 世界写操作是否都在 `system.run` 或事件回调内？
- 占用的租约是否每拍续、`stop` 是否释放并恢复现场？
- 新状态是否有明确的落盘点与读入归一化？
- 同一 bug 是否有离线回归测试，或明确标注仅实机验证？

## 参考

- `references/mockplayer3.md`：文件地图、上线/切换/tick/死亡时序、原子与 DP 键、测试映射。
- `references/runtime-and-testing.md`：ScriptAPI 上下文、命令模板、测试桩、构建配置、新模块脚手架。
- 根 `AGENTS.md`：仓库事实与红线；模块 `AGENTS.md`：模块事实与红线。
