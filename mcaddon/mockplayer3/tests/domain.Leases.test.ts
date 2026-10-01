// ─── 租约表 + 会话单测：独占资源互斥 / TTL / AIM_ONCE 中性化 / epoch 守卫 ──────────
import test from "node:test";
import assert from "node:assert/strict";

import { LeaseTable, blockKey, GAZE_HOLD_TTL_TICKS } from "../scripts/domain/Leases";
import { Session } from "../scripts/domain/Session";

test("独占资源：gaze 他人申请返回 EBUSY+持有者（冲突可见，非静默覆盖）", () => {
  const t = new LeaseTable();
  assert.deepEqual(t.acquire("gaze", "mine", "HOLD", 0, GAZE_HOLD_TTL_TICKS), { ok: true });
  const busy = t.acquire("gaze", "vault", "HOLD", 10, GAZE_HOLD_TTL_TICKS);
  assert.equal(busy.ok, false);
  if (!busy.ok) assert.equal(busy.holder.owner, "mine");
  // 同主再取 = 续期语义，放行
  assert.deepEqual(t.acquire("gaze", "mine", "HOLD", 20, GAZE_HOLD_TTL_TICKS), { ok: true });
});

test("breaking 按格细粒度：同格互斥、异格并行", () => {
  const t = new LeaseTable();
  const k1 = blockKey(1, 2, 3);
  const k2 = blockKey(4, 5, 6);
  assert.ok(t.acquire("breaking", "botA", "HOLD", 0, 100, k1).ok);
  assert.equal(t.acquire("breaking", "botB", "HOLD", 0, 100, k1).ok, false);
  assert.ok(t.acquire("breaking", "botB", "HOLD", 0, 100, k2).ok);
  assert.equal(t.list().length, 2);
});

test("TTL：到期 expire 撤销并可被他人接管；renew 心跳续命", () => {
  const t = new LeaseTable();
  t.acquire("hands", "fishing", "HOLD", 0, 50);
  assert.deepEqual(t.expire(49), []);
  const expired = t.expire(50);
  assert.equal(expired.length, 1);
  assert.equal(expired[0]!.kind, "hands");
  assert.ok(t.acquire("hands", "raid", "HOLD", 50, 50).ok);
  // 属主续租成功、非属主续租拒绝
  assert.equal(t.renew("hands", "raid", 80, 50), true);
  assert.equal(t.renew("hands", "fishing", 90, 50), false);
  assert.equal(t.holderOf("hands")!.owner, "raid");
});

test("AIM_ONCE：确认执行后自动中性化（不可当作常驻视线，C-01 封堵）", () => {
  const t = new LeaseTable();
  t.acquire("gaze", "mine", "AIM_ONCE", 0, 20);
  assert.equal(t.confirmAimOnce("vault"), false, "非属主不能确认");
  assert.equal(t.holderOf("gaze")!.mode, "AIM_ONCE", "确认前仍在");
  assert.equal(t.confirmAimOnce("mine"), true);
  assert.equal(t.holderOf("gaze"), undefined, "确认后表内不再持有");
});

test("切换/销毁：releaseBy 返回被撤清单（engine 据此做注视中性化），releaseAll 后表空", () => {
  const t = new LeaseTable();
  t.acquire("gaze", "mine", "HOLD", 0, 100);
  t.acquire("hands", "mine", "HOLD", 0, 100);
  t.acquire("breaking", "other", "HOLD", 0, 100, blockKey(0, 0, 0));
  const removed = t.releaseBy("mine");
  assert.equal(removed.length, 2);
  assert.equal(t.holderOf("breaking", blockKey(0, 0, 0))!.owner, "other", "他主租约不受影响");
  assert.equal(t.releaseAll().length, 1);
  assert.equal(t.isEmpty(), true);
});

test("Session：epoch 初值 0（ADR-5 空背包覆盖防线）、脏集 mark/takeDirty 去重清空", () => {
  const s = new Session(7, "sess-7-1", 100);
  assert.equal(s.epoch, 0);
  assert.equal(s.entityId, null);
  assert.equal(s.state, "SPAWNING");
  assert.equal(s.startedAtTick, 100);
  s.mark(["home", "experience", "home"]);
  assert.deepEqual(new Set(s.takeDirty()), new Set(["home", "experience"]));
  assert.equal(s.takeDirty().length, 0);
});
