// ─── core/ai — 行为树基础（Action/BehaviorTree/Status） ──
// ⚠️ 3.2.1：旧任务编排的组合器/装饰器（Sequence/Selector/Cooldown/
//   Condition/WaitForTicks/Blackboard）已随任务树架构退役——能力 = 扁平
//   工作流（Action 包装 async 循环），仅测保留的基础。

import { test } from "node:test";
import assert from "node:assert/strict";

import { Action, BehaviorTree, Status, type AiContext } from "../scripts/ai";

/** 构造上下文（tick 递增） */
function makeCtx(tick: number): AiContext {
  return { botName: "bot1", tick };
}

test("Action：同步返回 Success/Failure", async () => {
  const tree = new BehaviorTree(new Action(() => Status.Success));
  assert.equal(await tree.tick(makeCtx(1)), Status.Success);
  const fail = new BehaviorTree(new Action(() => Status.Failure));
  assert.equal(await fail.tick(makeCtx(1)), Status.Failure);
});

test("Action：支持异步（Promise 状态）", async () => {
  const tree = new BehaviorTree(
    new Action(async (ctx) => {
      await new Promise((r) => setTimeout(r, 1));
      return ctx.tick > 0 ? Status.Success : Status.Failure;
    })
  );
  assert.equal(await tree.tick(makeCtx(5)), Status.Success);
});

test("BehaviorTree：单根入口，一次 tick 委托 root", async () => {
  const calls: number[] = [];
  const tree = new BehaviorTree(
    new Action((ctx) => {
      calls.push(ctx.tick);
      return Status.Running;
    })
  );
  assert.equal(await tree.tick(makeCtx(10)), Status.Running);
  assert.deepEqual(calls, [10]);
});

test("Action：异常向上抛出（由调度层兜底隔离）", async () => {
  const tree = new BehaviorTree(
    new Action(() => {
      throw new Error("boom");
    })
  );
  await assert.rejects(() => tree.tick(makeCtx(1)));
});
