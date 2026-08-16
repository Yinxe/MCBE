// ─── core/ai — BehaviorRunner（新框架 v3 执行层） ────────
// 覆盖：注册/优先级排序/同名忽略、选择与切换语义（旧 reset + 新 onActivate）、
// 延续条件失效释放、卸载（unregister/unregisterAll）必须 reset 运行中行为
// （审核 S1：行为关闭 → reset 中止后台协程的 runner 侧保障）、step 异常自愈。

import { test } from "node:test";
import assert from "node:assert/strict";

import { AiMemory, BehaviorRunner, type Behavior, type BehaviorContext } from "../scripts/ai";

/** 构造行为：可激活开关 + 事件日志（reset 计数 = 中止语义断言核心） */
function makeBehavior(
  name: string,
  priority: number,
  opts: { enabled?: boolean; tickLog?: string[]; resetLog?: string[]; stepThrows?: boolean } = {}
): Behavior {
  const enabled = { value: opts.enabled ?? true };
  return {
    name,
    priority,
    canActivate: () => enabled.value,
    step: (ctx) => {
      if (opts.stepThrows) throw new Error("boom");
      opts.tickLog?.push(`${name}@${ctx.tick}`);
    },
    reset: () => opts.resetLog?.push(name),
  };
}

/** 构造大脑上下文（tick 递增） */
function makeCtx(tick: number): BehaviorContext {
  return { botName: "bot1", tick, memory: new AiMemory() };
}

// ─── 注册：优先级排序 + 同名忽略 ────────────────────────

test("register：同名忽略；按优先级升序（数字小优先）选择", () => {
  const runner = new BehaviorRunner();
  const low = makeBehavior("work", 10);
  const high = makeBehavior("defense", 1);
  runner.register(low);
  runner.register(high);
  runner.register(makeBehavior("work", 5)); // 同名：忽略（保持原优先级）
  runner.step(makeCtx(1));
  assert.equal(runner.activeBehavior?.name, "defense"); // 优先级 1 < 10
});

// ─── 切换语义：旧行为 reset + 新行为 onActivate ─────────

test("切换：高优先级出现 → 旧行为 reset + 新行为 onActivate", () => {
  const runner = new BehaviorRunner();
  const resets: string[] = [];
  const activated: string[] = [];
  const threat = { on: false };
  runner.register(makeBehavior("work", 10, { resetLog: resets }));
  runner.register({
    name: "defense",
    priority: 1,
    canActivate: () => threat.on,
    step: () => undefined,
    reset: () => resets.push("defense"),
    onActivate: () => activated.push("defense"),
  });

  runner.step(makeCtx(1)); // work 激活
  assert.equal(runner.activeBehavior?.name, "work");

  threat.on = true;
  runner.step(makeCtx(2)); // 切换 → work.reset + defense.onActivate
  assert.equal(runner.activeBehavior?.name, "defense");
  assert.deepEqual(resets, ["work"]);
  assert.deepEqual(activated, ["defense"]);
});

// ─── 延续条件失效：canActivate false → reset 释放 ───────

test("延续条件失效：active.canActivate 变 false → reset + 释放", () => {
  const runner = new BehaviorRunner();
  const resets: string[] = [];
  const work = makeBehavior("work", 10, { resetLog: resets });
  const idle = { value: false };
  runner.register({
    ...work,
    canActivate: () => idle.value,
  });
  idle.value = true;
  runner.step(makeCtx(1));
  assert.equal(runner.activeBehavior?.name, "work");

  idle.value = false; // 行为条件失效（如 aiBehavior 记忆被清/切换 none）
  runner.step(makeCtx(2));
  assert.equal(runner.activeBehavior, undefined);
  assert.deepEqual(resets, ["work"]); // 必须 reset（中止后台协程）
});

// ─── 卸载：unregister 运行中 → reset（审核 S1 runner 侧） ─

test("unregister：运行中行为 → reset + 释放（行为关闭必须中止）", () => {
  const runner = new BehaviorRunner();
  const resets: string[] = [];
  const work = makeBehavior("work", 10, { resetLog: resets });
  runner.register(work);
  runner.step(makeCtx(1));
  assert.equal(runner.activeBehavior?.name, "work");

  runner.unregister("work"); // 对账卸载（行为切换/关闭）→ 必须 reset
  assert.equal(runner.activeBehavior, undefined);
  assert.deepEqual(resets, ["work"]);
});

test("unregisterAll：运行中行为 → reset + 清空（假人下线/切 none）", () => {
  const runner = new BehaviorRunner();
  const resets: string[] = [];
  runner.register(makeBehavior("work", 10, { resetLog: resets }));
  runner.register(makeBehavior("defense", 1, { resetLog: resets }));
  runner.step(makeCtx(1));
  assert.equal(runner.activeBehavior?.name, "defense");

  runner.unregisterAll();
  assert.equal(runner.activeBehavior, undefined);
  assert.deepEqual(resets, ["defense"]); // 仅运行中的 reset（未激活的不需要）
});

// ─── step 异常自愈：reset + 不阻断调度 ─────────────────

test("step 抛异常：reset + 释放，下一周期可重新调度", () => {
  const runner = new BehaviorRunner();
  const resets: string[] = [];
  const bad = makeBehavior("bad", 10, { stepThrows: true, resetLog: resets });
  runner.register(bad);
  runner.step(makeCtx(1)); // step 抛 → 内部 reset + 释放（不向外抛）
  assert.equal(runner.activeBehavior, undefined);
  assert.deepEqual(resets, ["bad"]);

  runner.step(makeCtx(2)); // 后续周期正常（不再崩）
  assert.equal(runner.activeBehavior, undefined);
});

// ─── onActivate 异常：不阻断调度 ────────────────────────

test("onActivate 抛异常：不阻断后续 step", () => {
  const runner = new BehaviorRunner();
  runner.register({
    name: "bad",
    priority: 1,
    canActivate: () => true,
    onActivate: () => {
      throw new Error("boom");
    },
    step: () => undefined,
    reset: () => undefined,
  });
  runner.step(makeCtx(1)); // onActivate 抛 → 内部捕获，active 仍推进
  assert.equal(runner.activeBehavior?.name, "bad");
});
