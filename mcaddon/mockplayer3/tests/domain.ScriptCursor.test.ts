// ─── 编程模式·执行游标单测（顺序 / 循环 / 跳转 / 死循环护栏） ────────
// 游标是纯状态机：peek 停在待执行条，commit/skip 推进一步。
import test from "node:test";
import assert from "node:assert/strict";

import { ScriptCursor } from "../scripts/domain/ScriptCursor";
import { JUMP_STREAK_LIMIT } from "../scripts/domain/ScriptRules";
import type { ScriptProgram, ScriptStep } from "../scripts/domain/ScriptRules";

const say = (text: string): ScriptStep => ({ type: "say", text });
const program = (steps: ScriptStep[], loopCount = 1, onFail: ScriptProgram["onFail"] = "stop"): ScriptProgram => ({
  steps,
  loopCount,
  onFail,
});

test("编程游标·顺序执行：逐条停靠，跑完一轮即整段结束", () => {
  const cursor = new ScriptCursor(program([say("a"), say("b")]));
  const first = cursor.peek();
  assert.deepEqual(first, { kind: "step", index: 0, step: say("a"), cycle: 1 });
  cursor.commit();
  assert.deepEqual(cursor.peek(), { kind: "step", index: 1, step: say("b"), cycle: 1 });
  cursor.commit();
  assert.deepEqual(cursor.peek(), { kind: "cycle-end", cycle: 1, done: true });
  assert.equal(cursor.done, true);
  assert.deepEqual(cursor.peek(), { kind: "cycle-end", cycle: 1, done: true }, "结束后再取仍是结束");
});

test("编程游标·循环 N 次与一直循环", () => {
  const once = new ScriptCursor(program([say("a")], 2));
  once.peek();
  once.commit();
  const second = once.peek();
  assert.deepEqual(second, { kind: "step", index: 0, step: say("a"), cycle: 2 }, "第二轮从头来");
  once.commit();
  assert.equal(once.peek().kind, "cycle-end");
  assert.equal(once.done, true);

  const forever = new ScriptCursor(program([say("a")], -1));
  for (let i = 0; i < 5; i++) {
    assert.equal(forever.peek().kind, "step");
    forever.commit();
  }
  assert.equal(forever.done, false, "一直循环不会自己结束");
  assert.equal(forever.cycle, 5, "每跨一轮就 +1（5 次停靠＝已进入第 5 轮）");
});

test("编程游标·跳转：向后=跳过、向前=自定义循环，跳转本身不停靠", () => {
  const forward = new ScriptCursor(program([{ type: "jump", target: 3 }, say("skip"), say("hit")]));
  assert.deepEqual(forward.peek(), { kind: "step", index: 2, step: say("hit"), cycle: 1 });
  forward.commit();
  assert.equal(forward.peek().kind, "cycle-end");

  const backward = new ScriptCursor(program([say("body"), { type: "jump", target: 1 }]));
  assert.deepEqual(backward.peek(), { kind: "step", index: 0, step: say("body"), cycle: 1 });
  backward.commit();
  const again = backward.peek();
  assert.equal(again.kind, "step", "跳回第 1 条继续跑（自定义循环）");
  assert.equal(backward.cycle, 1, "自身跳转不推进整段轮次");
});

test("编程游标·护栏：跳转越界与互相指认的死循环都停下并给中文原因", () => {
  const outOfRange = new ScriptCursor(program([{ type: "jump", target: 9 }]));
  const r1 = outOfRange.peek();
  assert.equal(r1.kind, "error");
  assert.match((r1 as { message: string }).message, /超出范围/);
  assert.equal(outOfRange.done, true);

  const loop = new ScriptCursor(
    program([
      { type: "jump", target: 2 },
      { type: "jump", target: 1 },
    ])
  );
  const r2 = loop.peek();
  assert.equal(r2.kind, "error");
  assert.match((r2 as { message: string }).message, /死循环/);
  assert.match((r2 as { message: string }).message, new RegExp(String(JUMP_STREAK_LIMIT)));
});

test("编程游标·空脚本与 skip：空脚本直接判结束，skip 与 commit 同效", () => {
  const empty = new ScriptCursor(program([]));
  assert.deepEqual(empty.peek(), { kind: "cycle-end", cycle: 0, done: true });

  const cursor = new ScriptCursor(program([say("a"), say("b")]));
  cursor.peek();
  cursor.skip();
  assert.deepEqual(cursor.peek(), { kind: "step", index: 1, step: say("b"), cycle: 1 });
});
