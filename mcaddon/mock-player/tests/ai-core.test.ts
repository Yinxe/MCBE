// ─── 行为树框架测试（core/ai） ───────────────────────────
// 节点语义：Sequence/Selector 短路、running 保持、Condition、Cooldown、
// Blackboard、异步 Action、装饰器（Inverter/AlwaysSucceed/AlwaysFail/
// RepeatUntilSuccess）、RandomSelector、WaitForTicks。
// ⚠️ 三态统一用 Status 枚举（规范化契约），测试断言同样使用枚举值。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  Action, AlwaysFail, AlwaysSucceed, Blackboard, Cooldown, Condition, Inverter, RandomSelector,
  RepeatUntilSuccess, Selector, Sequence, Status, WaitForTicks, type AiContext, type Node,
} from "../scripts/legacy/ai";

function makeCtx(tick: number, blackboard = new Blackboard()): AiContext {
  return { botName: "bot1", blackboard, tick };
}

/** 记录执行并返回指定状态的动作 */
function tracedAction(log: string[], name: string, status: Status): Node {
  return new Action(() => {
    log.push(name);
    return status;
  });
}

// ─── Sequence ────────────────────────────────────────────

test("Sequence：全部成功才成功，按序执行", async () => {
  const log: string[] = [];
  const tree = new Sequence([
    tracedAction(log, "a", Status.Success),
    tracedAction(log, "b", Status.Success),
    tracedAction(log, "c", Status.Success),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Success);
  assert.deepEqual(log, ["a", "b", "c"]);
});

test("Sequence：中间 Failure 短路（后续不执行）", async () => {
  const log: string[] = [];
  const tree = new Sequence([
    tracedAction(log, "a", Status.Success),
    tracedAction(log, "b", Status.Failure),
    tracedAction(log, "c", Status.Success),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Failure);
  assert.deepEqual(log, ["a", "b"]);
});

test("Sequence：Running 短路（后续不执行，返回 Running）", async () => {
  const log: string[] = [];
  const tree = new Sequence([
    tracedAction(log, "a", Status.Running),
    tracedAction(log, "b", Status.Success),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Running);
  assert.deepEqual(log, ["a"]);
});

// ─── Selector ────────────────────────────────────────────

test("Selector：第一个非 Failure 胜出（短路）", async () => {
  const log: string[] = [];
  const tree = new Selector([
    tracedAction(log, "a", Status.Failure),
    tracedAction(log, "b", Status.Success),
    tracedAction(log, "c", Status.Success),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Success);
  assert.deepEqual(log, ["a", "b"]);
});

test("Selector：全部 Failure 才 Failure", async () => {
  const log: string[] = [];
  const tree = new Selector([
    tracedAction(log, "a", Status.Failure),
    tracedAction(log, "b", Status.Failure),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Failure);
  assert.deepEqual(log, ["a", "b"]);
});

test("Selector：Running 短路", async () => {
  const log: string[] = [];
  const tree = new Selector([
    tracedAction(log, "a", Status.Failure),
    tracedAction(log, "b", Status.Running),
    tracedAction(log, "c", Status.Success),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Running);
  assert.deepEqual(log, ["a", "b"]);
});

// ─── Condition / Action ──────────────────────────────────

test("Condition：谓词 true → Success，false → Failure", async () => {
  const tree = new Selector([
    new Condition(() => false),
    new Condition(() => true),
    new Action(() => {
      throw new Error("不该执行");
    }),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Success);
});

test("Condition.not()：取反便捷方法（等价 Inverter 包装）", async () => {
  const c = new Condition(() => true);
  assert.equal(await c.tick(makeCtx(0)), Status.Success);
  assert.equal(await c.not().tick(makeCtx(0)), Status.Failure); // 取反
  const c2 = new Condition(() => false);
  assert.equal(await c2.not().tick(makeCtx(0)), Status.Success); // 双重语义
  // 与 Inverter 行为一致
  const c3 = new Condition(() => true);
  assert.equal(await new Inverter(c3).tick(makeCtx(0)), await c3.not().tick(makeCtx(0)));
});

test("Action：支持异步（Promise 状态）", async () => {
  const tree = new Sequence([
    new Action(async (): Promise<Status> => Status.Running),
    new Action(async (): Promise<Status> => {
      throw new Error("不该执行");
    }),
  ]);
  assert.equal(await tree.tick(makeCtx(0)), Status.Running);

  const ok = new Sequence([
    new Action(async (): Promise<Status> => Status.Success),
    new Action(async (): Promise<Status> => Status.Success),
  ]);
  assert.equal(await ok.tick(makeCtx(1)), Status.Success);
});

// ─── Cooldown ────────────────────────────────────────────

test("Cooldown：子节点失败后冷却期内直接 Failure（子节点不再执行）", async () => {
  let calls = 0;
  const child = new Action(() => {
    calls++;
    return Status.Failure;
  });
  const tree = new Cooldown(child, 40);
  const ctx = makeCtx(100);
  assert.equal(await tree.tick(ctx), Status.Failure);
  assert.equal(calls, 1);
  assert.equal(await tree.tick(makeCtx(110)), Status.Failure); // 冷却中
  assert.equal(calls, 1); // 未执行子节点
});

test("Cooldown：冷却到期后重试；成功不重置计时", async () => {
  let calls = 0;
  const child = new Action(() => {
    calls++;
    return calls === 2 ? Status.Failure : Status.Success;
  });
  const tree = new Cooldown(child, 40);
  assert.equal(await tree.tick(makeCtx(100)), Status.Success); // 成功
  assert.equal(await tree.tick(makeCtx(130)), Status.Failure); // 失败（calls=2）
  assert.equal(await tree.tick(makeCtx(160)), Status.Failure); // 冷却中
  assert.equal(await tree.tick(makeCtx(170)), Status.Success); // 到期重试（calls=3）
  assert.equal(calls, 3);
});

// ─── Inverter ────────────────────────────────────────────

test("Inverter：Success ↔ Failure，Running 保持", async () => {
  const inv = new Inverter(new Action(() => Status.Success));
  assert.equal(await inv.tick(makeCtx(0)), Status.Failure);
  const inv2 = new Inverter(new Action(() => Status.Failure));
  assert.equal(await inv2.tick(makeCtx(0)), Status.Success);
  const inv3 = new Inverter(new Action(() => Status.Running));
  assert.equal(await inv3.tick(makeCtx(0)), Status.Running);
});

// ─── AlwaysSucceed / AlwaysFail ──────────────────────────

test("AlwaysSucceed：子节点失败也强制成功（可选步骤包装）", async () => {
  const node = new AlwaysSucceed(new Action(() => Status.Failure));
  assert.equal(await node.tick(makeCtx(0)), Status.Success);
});

test("AlwaysFail：子节点成功也强制失败", async () => {
  const node = new AlwaysFail(new Action(() => Status.Success));
  assert.equal(await node.tick(makeCtx(0)), Status.Failure);
});

// ─── RepeatUntilSuccess ──────────────────────────────────

test("RepeatUntilSuccess：子节点 Failure → Running（跨 tick 重试），直到 Success", async () => {
  let calls = 0;
  const node = new RepeatUntilSuccess(
    new Action(() => {
      calls++;
      return calls < 3 ? Status.Failure : Status.Success;
    }),
  );
  assert.equal(await node.tick(makeCtx(100)), Status.Running); // 第 1 次失败 → 保持
  assert.equal(await node.tick(makeCtx(110)), Status.Running); // 第 2 次失败 → 保持
  assert.equal(await node.tick(makeCtx(120)), Status.Success); // 第 3 次成功
  assert.equal(calls, 3);
});

test("RepeatUntilSuccess：maxAttempts 到达仍失败 → Failure", async () => {
  let calls = 0;
  const node = new RepeatUntilSuccess(
    new Action(() => {
      calls++;
      return Status.Failure;
    }),
    3,
  );
  assert.equal(await node.tick(makeCtx(100)), Status.Running);
  assert.equal(await node.tick(makeCtx(110)), Status.Running);
  assert.equal(await node.tick(makeCtx(120)), Status.Failure); // 达到上限
  assert.equal(calls, 3);
});

// ─── RandomSelector ──────────────────────────────────────

test("RandomSelector：随机执行其中一个子节点（结果 ∈ 子节点集合）", async () => {
  const node = new RandomSelector([
    new Action(() => Status.Success),
    new Action(() => Status.Failure),
  ]);
  const seen = new Set<Status>();
  for (let i = 0; i < 20; i++) {
    seen.add(await node.tick(makeCtx(i)));
  }
  // 两种结果都出现过（随机分布，证明两个子节点都可能被选中）
  assert.ok(seen.has(Status.Success));
  assert.ok(seen.has(Status.Failure));
});

test("RandomSelector：空子节点列表 → Failure", async () => {
  const node = new RandomSelector([]);
  assert.equal(await node.tick(makeCtx(0)), Status.Failure);
});

// ─── WaitForTicks ────────────────────────────────────────

test("WaitForTicks：等待 N tick 后 Success（期间 Running 保持，完成后可重新计时）", async () => {
  const node = new WaitForTicks(20);
  const bb = new Blackboard();
  assert.equal(await node.tick(makeCtx(100, bb)), Status.Running);
  assert.equal(await node.tick(makeCtx(110, bb)), Status.Running);
  assert.equal(await node.tick(makeCtx(119, bb)), Status.Running); // 未到
  assert.equal(await node.tick(makeCtx(120, bb)), Status.Success); // 到点
  // 完成后清理黑板键 → 再次等待重新计时
  assert.equal(await node.tick(makeCtx(121, bb)), Status.Running);
  assert.equal(await node.tick(makeCtx(150, bb)), Status.Success);
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
    return Status.Success;
  });
  const reader = new Action((ctx) => (ctx.blackboard.get<number>("v") === undefined ? Status.Failure : Status.Success));
  const tree = new Sequence([writer, reader]);
  assert.equal(await tree.tick(makeCtx(7, bbA)), Status.Success);
  assert.equal(await new Sequence([reader]).tick(makeCtx(9, bbB)), Status.Failure); // 另一棵树黑板无值
  assert.equal(bbA.get<number>("v"), 7);
  assert.equal(bbB.get<number>("v"), undefined);
});
