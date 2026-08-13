// ─── 行为树框架测试（core/ai） ───────────────────────────
// 节点语义：Sequence/Selector 短路、running 保持、Condition、Cooldown、
// Blackboard、异步 Action。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Action, AlwaysFail, AlwaysSucceed, Blackboard, Cooldown, Condition, Inverter, RandomSelector,
  RepeatUntilSuccess, Selector, Sequence, WaitForTicks, type AiContext, type Status,
} from "../scripts/core/ai";

function makeCtx(tick: number, blackboard = new Blackboard()): AiContext {
  return { botName: "bot1", blackboard, tick };
}

/** 记录执行并返回指定状态的动作 */
function tracedAction(log: string[], name: string, status: Status): Action {
  return new Action(() => {
    log.push(name);
    return status;
  });
}

// ─── Sequence ────────────────────────────────────────────

test("Sequence：全部成功才成功，按序执行", async () => {
  const log: string[] = [];
  const tree = new Sequence([tracedAction(log, "a", "success"), tracedAction(log, "b", "success"), tracedAction(log, "c", "success")]);
  assert.equal(await tree.tick(makeCtx(0)), "success");
  assert.deepEqual(log, ["a", "b", "c"]);
});

test("Sequence：中间 failure 短路（后续不执行）", async () => {
  const log: string[] = [];
  const tree = new Sequence([tracedAction(log, "a", "success"), tracedAction(log, "b", "failure"), tracedAction(log, "c", "success")]);
  assert.equal(await tree.tick(makeCtx(0)), "failure");
  assert.deepEqual(log, ["a", "b"]);
});

test("Sequence：running 短路（后续不执行，返回 running）", async () => {
  const log: string[] = [];
  const tree = new Sequence([tracedAction(log, "a", "running"), tracedAction(log, "b", "success")]);
  assert.equal(await tree.tick(makeCtx(0)), "running");
  assert.deepEqual(log, ["a"]);
});

// ─── Selector ────────────────────────────────────────────

test("Selector：第一个非 failure 胜出（短路）", async () => {
  const log: string[] = [];
  const tree = new Selector([tracedAction(log, "a", "failure"), tracedAction(log, "b", "success"), tracedAction(log, "c", "success")]);
  assert.equal(await tree.tick(makeCtx(0)), "success");
  assert.deepEqual(log, ["a", "b"]);
});

test("Selector：全部 failure 才 failure", async () => {
  const log: string[] = [];
  const tree = new Selector([tracedAction(log, "a", "failure"), tracedAction(log, "b", "failure")]);
  assert.equal(await tree.tick(makeCtx(0)), "failure");
  assert.deepEqual(log, ["a", "b"]);
});

test("Selector：running 短路", async () => {
  const log: string[] = [];
  const tree = new Selector([tracedAction(log, "a", "failure"), tracedAction(log, "b", "running"), tracedAction(log, "c", "success")]);
  assert.equal(await tree.tick(makeCtx(0)), "running");
  assert.deepEqual(log, ["a", "b"]);
});

// ─── Condition / Action ──────────────────────────────────

test("Condition：谓词 true → success，false → failure", async () => {
  const tree = new Selector([
    new Condition(() => false),
    new Condition(() => true),
    new Action(() => {
      throw new Error("不该执行");
    }),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), "success");
});

test("Action：支持异步（Promise 状态）", async () => {
  const tree = new Sequence([
    new Action(async (): Promise<Status> => "running"),
    new Action(async (): Promise<Status> => {
      throw new Error("不该执行");
    }),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), "running");

  const ok = new Sequence([
    new Action(async (): Promise<Status> => "success"),
    new Action(async (): Promise<Status> => "success"),
  ]);
  assert.equal(await ok.tick(makeCtx(1)), "success");
});

// ─── Cooldown ────────────────────────────────────────────

test("Cooldown：子节点失败后冷却期内直接 failure（子节点不再执行）", async () => {
  let calls = 0;
  const child = new Action(() => {
    calls++;
    return "failure";
  });
  const tree = new Cooldown(child, 40);
  const ctx = makeCtx(100);
  assert.equal(await tree.tick(ctx), "failure");
  assert.equal(calls, 1);
  assert.equal(await tree.tick(makeCtx(110)), "failure"); // 冷却中
  assert.equal(calls, 1); // 未执行子节点
});

test("Cooldown：冷却到期后重试；成功不重置计时", async () => {
  let calls = 0;
  const child = new Action(() => {
    calls++;
    return calls === 2 ? "failure" : "success";
  });
  const tree = new Cooldown(child, 40);
  assert.equal(await tree.tick(makeCtx(100)), "success"); // 成功
  assert.equal(await tree.tick(makeCtx(130)), "failure"); // 失败（calls=2）
  assert.equal(await tree.tick(makeCtx(160)), "failure"); // 冷却中
  assert.equal(await tree.tick(makeCtx(170)), "success"); // 到期重试（calls=3）
  assert.equal(calls, 3);
});

// ─── Blackboard ──────────────────────────────────────────

test("Blackboard：set/get/has/delete/clear", () => {
  const bb = new Blackboard();
  assert.equal(bb.get("k"), undefined);
  assert.equal(bb.has("k"), false);
  bb.set("k", 42);
  assert.equal(bb.get<number>("k"), 42);
  assert.equal(bb.has("k"), true);
  bb.set("k", "updated");
  assert.equal(bb.get<string>("k"), "updated");
  bb.delete("k");
  assert.equal(bb.has("k"), false);
  bb.set("a", 1);
  bb.set("b", 2);
  bb.clear();
  assert.equal(bb.has("a"), false);
  assert.equal(bb.has("b"), false);
});

test("Blackboard：多棵树实例隔离", async () => {
  const bbA = new Blackboard();
  const bbB = new Blackboard();
  const writer = new Action((ctx) => {
    ctx.blackboard.set("v", ctx.tick);
    return "success";
  });
  const reader = new Action((ctx) => (ctx.blackboard.get<number>("v") === undefined ? "failure" : "success"));
  const tree = new Sequence([writer, reader]);
  assert.equal(await tree.tick(makeCtx(7, bbA)), "success");
  assert.equal(await new Sequence([reader]).tick(makeCtx(9, bbB)), "failure"); // 另一棵树黑板无值
  assert.equal(bbA.get<number>("v"), 7);
  assert.equal(bbB.get<number>("v"), undefined);
});

// ─── Inverter ────────────────────────────────────────────

test("Inverter：success ↔ failure，running 保持", async () => {
  const inv = new Inverter(new Action(() => "success"));
  assert.equal(await inv.tick(makeCtx(0)), "failure");
  const inv2 = new Inverter(new Action(() => "failure"));
  assert.equal(await inv2.tick(makeCtx(0)), "success");
  const inv3 = new Inverter(new Action(() => "running"));
  assert.equal(await inv3.tick(makeCtx(0)), "running");
});

// ─── AlwaysSucceed / AlwaysFail ──────────────────────────

test("AlwaysSucceed：子节点失败也强制成功（可选步骤包装）", async () => {
  const node = new AlwaysSucceed(new Action(() => "failure"));
  assert.equal(await node.tick(makeCtx(0)), "success");
});

test("AlwaysFail：子节点成功也强制失败", async () => {
  const node = new AlwaysFail(new Action(() => "success"));
  assert.equal(await node.tick(makeCtx(0)), "failure");
});

// ─── RepeatUntilSuccess ──────────────────────────────────

test("RepeatUntilSuccess：子节点 failure → running（跨 tick 重试），直到 success", async () => {
  let calls = 0;
  const node = new RepeatUntilSuccess(
    new Action(() => {
      calls++;
      return calls < 3 ? "failure" : "success";
    }),
  );
  assert.equal(await node.tick(makeCtx(100)), "running"); // 第 1 次失败 → 保持
  assert.equal(await node.tick(makeCtx(110)), "running"); // 第 2 次失败 → 保持
  assert.equal(await node.tick(makeCtx(120)), "success"); // 第 3 次成功
  assert.equal(calls, 3);
});

test("RepeatUntilSuccess：maxAttempts 到达仍失败 → failure", async () => {
  let calls = 0;
  const node = new RepeatUntilSuccess(
    new Action(() => {
      calls++;
      return "failure";
    }),
    3,
  );
  assert.equal(await node.tick(makeCtx(100)), "running");
  assert.equal(await node.tick(makeCtx(110)), "running");
  assert.equal(await node.tick(makeCtx(120)), "failure"); // 达到上限
  assert.equal(calls, 3);
});

// ─── RandomSelector ──────────────────────────────────────

test("RandomSelector：随机执行其中一个子节点（结果 ∈ 子节点集合）", async () => {
  const node = new RandomSelector([
    new Action(() => "a" as Status),
    new Action(() => "b" as Status),
  ]);
  const seen = new Set<string>();
  for (let i = 0; i < 20; i++) {
    seen.add(await node.tick(makeCtx(i)));
  }
  // 两种结果都出现过（随机分布）
  assert.ok(seen.has("a"));
  assert.ok(seen.has("b"));
});

test("RandomSelector：空子节点列表 → failure", async () => {
  const node = new RandomSelector([]);
  assert.equal(await node.tick(makeCtx(0)), "failure");
});

// ─── WaitForTicks ────────────────────────────────────────

test("WaitForTicks：等待 N tick 后 success（期间 running 保持，完成后可重新计时）", async () => {
  const node = new WaitForTicks(20);
  const bb = new Blackboard();
  assert.equal(await node.tick(makeCtx(100, bb)), "running");
  assert.equal(await node.tick(makeCtx(110, bb)), "running");
  assert.equal(await node.tick(makeCtx(119, bb)), "running"); // 未到
  assert.equal(await node.tick(makeCtx(120, bb)), "success"); // 到点
  // 完成后清理黑板键 → 再次等待重新计时
  assert.equal(await node.tick(makeCtx(121, bb)), "running");
  assert.equal(await node.tick(makeCtx(150, bb)), "success");
});
