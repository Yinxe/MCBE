// ─── core/ai — 生物大脑（共享记忆/感受器/目标选择器） ─────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Action,
  AiMemory,
  BehaviorTree,
  GoalSelector,
  SensorRunner,
  Status,
  type AiBrainContext,
  type AiGoal,
  type AiSensor,
} from "../scripts/ai";
import { threatAlive, type ThreatInfo } from "../scripts/rules/DefenseRules";

/** 当前运行目标名（函数调用绕开 TS 对 getter 的控制流收窄——assert 断言会收窄 readonly getter） */
function activeName(selector: GoalSelector): string | undefined {
  return selector.activeGoal?.name;
}

/** 构造大脑上下文（tick 递增） */
function makeCtx(memory: AiMemory, tick: number): AiBrainContext {
  return { botName: "bot1", tick, memory };
}

/** 简单目标：可激活开关 + 树内记录 tick 次数 */
function makeGoal(
  name: string,
  priority: number,
  opts: { enabled?: boolean; onActivate?: () => void; tickLog?: string[] } = {}
): AiGoal {
  const enabled = { value: opts.enabled ?? true };
  return {
    name,
    priority,
    canActivate: () => enabled.value,
    onActivate: opts.onActivate,
    tree: new BehaviorTree(
      new Action((ctx) => {
        opts.tickLog?.push(`${name}@${ctx.tick}`);
        return Status.Success;
      })
    ),
  };
}

// ─── 目标选择器：优先级调度 ─────────────────────────────

test("目标选择：高优先级抢占低优先级（onActivate 触发打断）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const activated: string[] = [];
  const threat = { on: false }; // 动态开关：模拟威胁出现
  selector.registerGoal(makeGoal("work", 10, { onActivate: () => activated.push("work") }));
  selector.registerGoal({
    name: "defense",
    priority: 1,
    canActivate: () => threat.on,
    onActivate: () => activated.push("defense"),
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  // tick 1：无威胁 → work 启动
  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");
  assert.deepEqual(activated, ["work"]);

  // tick 2：威胁出现 → defense 抢占 work
  threat.on = true;
  await selector.step(makeCtx(memory, 2));
  assert.equal(activeName(selector), "defense");
  assert.deepEqual(activated, ["work", "defense"]);
});

test("目标选择：高优先级不可激活 → 低优先级运行（让位）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  selector.registerGoal(makeGoal("work", 10));
  selector.registerGoal(makeGoal("defense", 1, { enabled: false }));

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");
});

test("目标选择：同优先级按注册序", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  selector.registerGoal(makeGoal("first", 5));
  selector.registerGoal(makeGoal("second", 5));

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "first");
});

test("目标选择：全部不可激活 → idle（不动作）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  selector.registerGoal(makeGoal("work", 10, { enabled: false }));
  selector.registerGoal(makeGoal("defense", 1, { enabled: false }));

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), undefined);
});

test("目标选择：运行中目标失效 → 释放；重新可激活 → 恢复", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const flag = { on: true };
  selector.registerGoal({
    name: "work",
    priority: 10,
    canActivate: () => flag.on,
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");

  flag.on = false;
  await selector.step(makeCtx(memory, 2));
  assert.ok(activeName(selector) === undefined, "失效应释放"); // 失效释放

  flag.on = true;
  await selector.step(makeCtx(memory, 3));
  assert.equal(activeName(selector), "work"); // 恢复
});

test("目标选择：同 tick 防重入（step 两次只调度一次）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const ticks: string[] = [];
  selector.registerGoal(makeGoal("work", 10, { tickLog: ticks }));

  await selector.step(makeCtx(memory, 5));
  await selector.step(makeCtx(memory, 5)); // 同 tick 重复调用
  assert.deepEqual(ticks, ["work@5"]);
});

test("目标选择：抢占时对旧目标调用 abort（协程取消钩子）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const aborted: string[] = [];
  const threat = { on: false };
  selector.registerGoal({
    name: "work",
    priority: 10,
    canActivate: () => true,
    abort: () => aborted.push("work"),
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });
  selector.registerGoal({
    name: "defense",
    priority: 1,
    canActivate: () => threat.on,
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");

  threat.on = true;
  await selector.step(makeCtx(memory, 2)); // defense 抢占 work
  assert.equal(activeName(selector), "defense");
  assert.deepEqual(aborted, ["work"]); // work 被 abort
});

test("目标选择：unregisterGoal 卸载能力（可插拔）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  selector.registerGoal(makeGoal("defense", 1));
  selector.unregisterGoal("defense");
  selector.registerGoal(makeGoal("work", 10));

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work"); // 防御已拔掉
});

test("目标选择：目标树异常不阻断调度（下轮继续）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  let fail = true;
  selector.registerGoal({
    name: "work",
    priority: 10,
    canActivate: () => true,
    tree: new BehaviorTree(
      new Action(() => {
        if (fail) throw new Error("boom");
        return Status.Success;
      })
    ),
  });

  await selector.step(makeCtx(memory, 1)); // 抛异常被吞
  fail = false;
  await selector.step(makeCtx(memory, 2)); // 恢复
  assert.equal(activeName(selector), "work");
});

// ─── 共享记忆 + 感受器 ─────────────────────────────────

test("共享记忆：跨目标读写 + 删除 + 清空", () => {
  const memory = new AiMemory();
  memory.set("threat", { entityId: "e1" });
  assert.deepEqual(memory.get<{ entityId: string }>("threat"), { entityId: "e1" });
  assert.equal(memory.has("threat"), true);
  memory.delete("threat");
  assert.equal(memory.has("threat"), false);
  memory.set("a", 1);
  memory.set("b", 2);
  memory.clear();
  assert.equal(memory.has("a"), false);
});

test("感受器：interval 未到不重跑；到期刷新写记忆", () => {
  const memory = new AiMemory();
  let runs = 0;
  const sensor: AiSensor = {
    name: "test",
    interval: 20,
    sense: (ctx) => {
      runs++;
      ctx.memory.set("seen", ctx.tick);
    },
  };
  const runner = new SensorRunner([sensor]);

  runner.step({ botName: "bot1", memory, tick: 1 });
  assert.equal(runs, 1);
  runner.step({ botName: "bot1", memory, tick: 5 }); // 未到 20 tick
  assert.equal(runs, 1);
  runner.step({ botName: "bot1", memory, tick: 21 }); // 到期
  assert.equal(runs, 2);
  assert.equal(memory.get<number>("seen"), 21);
});

// ─── 防御抢占场景（用户规格：威胁打断工作，安全后恢复） ──

test("防御抢占：威胁出现 → defense 打断 work；威胁清除（TTL 内）→ 恢复 work", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const activated: string[] = [];
  selector.registerGoal(makeGoal("work", 10, { onActivate: () => activated.push("work") }));
  selector.registerGoal({
    name: "defense",
    priority: 1,
    canActivate: (ctx) => {
      const t = ctx.memory.get<ThreatInfo>("threat");
      return !!t && threatAlive(t, ctx.tick);
    },
    onActivate: () => activated.push("defense"),
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  // 无威胁 → work 运行
  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");

  // 威胁感知写入记忆 → defense 抢占
  const threat: ThreatInfo = { entityId: "zombie-1", typeId: "minecraft:zombie", distance: 4, seenAtTick: 20 };
  memory.set("threat", threat);
  await selector.step(makeCtx(memory, 21));
  assert.equal(activeName(selector), "defense");

  // 威胁清除 → defense 让位 → work 恢复
  memory.delete("threat");
  await selector.step(makeCtx(memory, 22));
  assert.equal(activeName(selector), "work");
  assert.deepEqual(activated, ["work", "defense", "work"]);
});

test("防御规则：threatAlive 时效判定（TTL 40 tick）", () => {
  const threat: ThreatInfo = { entityId: "e", typeId: "minecraft:zombie", distance: 3, seenAtTick: 100 };
  assert.equal(threatAlive(threat, 139), true);
  assert.equal(threatAlive(threat, 140), false);
});

test("防御抢占：威胁 TTL 过期（感知停止）→ defense 让位", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  selector.registerGoal(makeGoal("work", 10));
  selector.registerGoal({
    name: "defense",
    priority: 1,
    canActivate: (ctx) => {
      const t = ctx.memory.get<ThreatInfo>("threat");
      return !!t && threatAlive(t, ctx.tick);
    },
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  // 威胁在 TTL 内 → defense
  memory.set("threat", { entityId: "e", typeId: "minecraft:zombie", distance: 5, seenAtTick: 100 });
  await selector.step(makeCtx(memory, 101));
  assert.equal(activeName(selector), "defense");

  // 超过 TTL（感知已停但记忆残留）→ defense 失效 → work
  await selector.step(makeCtx(memory, 200));
  assert.equal(activeName(selector), "work");
});

// ─── 3.3.8：目标生命周期补全（canContinue 中断 / Action 防重入） ──

/** 可开关 + abort 记录的目标（模拟持续行为：协程运行中条件变化） */
function makeToggleGoal(
  name: string,
  priority: number,
  enabled: { value: boolean },
  aborted: string[]
): AiGoal {
  return {
    name,
    priority,
    canActivate: () => enabled.value,
    abort: () => aborted.push(name),
    tree: new BehaviorTree(
      new Action(async () => {
        // 模拟持续协程：等待期间每轮自检开关（与工作流同构）
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 0));
          if (!enabled.value) return Status.Success; // 内部也自检退出
        }
        return Status.Success;
      })
    ),
  };
}

test("目标生命周期：运行中条件失效 → abort 中断协程 + 释放（canContinue 缺省 = canActivate）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const enabled = { value: true };
  const aborted: string[] = [];
  selector.registerGoal(makeToggleGoal("work", 10, enabled, aborted));

  // tick 1：启动 work（协程挂起）
  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "work");

  // tick 2：条件失效（如 aiBehavior 切换）→ 必须 abort 中断，不能只释放
  enabled.value = false;
  await selector.step(makeCtx(memory, 2));
  assert.equal(activeName(selector), undefined);
  assert.deepEqual(aborted, ["work"]); // abort 被调用（协程真正中断）
});

test("目标生命周期：自定义 canContinue（运行中条件失效 → abort 中断；开关仍开则下轮重选）", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const aborted: string[] = [];
  const state = { on: true, threat: true }; // on=开始条件；threat=运行中延续条件
  selector.registerGoal({
    name: "defense",
    priority: 1,
    canActivate: () => state.on,
    canContinue: () => state.on && state.threat, // 威胁消失 → 中断
    abort: () => aborted.push("defense"),
    tree: new BehaviorTree(new Action(() => Status.Success)),
  });

  await selector.step(makeCtx(memory, 1));
  assert.equal(activeName(selector), "defense");

  state.threat = false; // 威胁消失（行为开关仍开）→ 中断
  await selector.step(makeCtx(memory, 2));
  assert.deepEqual(aborted, ["defense"]); // abort 被调用（协程真正中断）
  assert.equal(activeName(selector), "defense"); // canActivate 仍满足 → 下轮重选（持续仲裁）

  state.on = false; // 行为关闭 → 空闲
  await selector.step(makeCtx(memory, 3));
  assert.equal(activeName(selector), undefined);
});

test("Action 防重入：协程未完成时再次 tick → Running，不重复启动", async () => {
  const memory = new AiMemory();
  const selector = new GoalSelector();
  const starts: number[] = [];
  let release: (() => void) | undefined;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  selector.registerGoal({
    name: "slow",
    priority: 10,
    canActivate: () => true,
    tree: new BehaviorTree(
      new Action(async (ctx) => {
        starts.push(ctx.tick); // 记录启动 tick
        await gate; // 挂起直到手动释放
        return Status.Success;
      })
    ),
  });

  // tick 1：首次启动（协程挂起在 gate）
  const p1 = selector.step(makeCtx(memory, 1));
  // tick 2：再次推进 → 不能重复启动（starts 保持 1 个）
  await selector.step(makeCtx(memory, 2));
  assert.equal(starts.length, 1);

  // 释放协程 → 完成
  release!();
  await p1;
  // tick 3：协程已完成 → 可重新启动（新一轮）
  await selector.step(makeCtx(memory, 3));
  assert.equal(starts.length, 2);
  release!();
});
