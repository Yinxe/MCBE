import { test } from "node:test";
import assert from "node:assert/strict";
import { SoulEngine } from "../scripts/core/engine";

const TOLERANCE_MS = 5000;
const DT_MS = 250;

test("范围内：in-range，不触发容忍", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  const r = engine.update(10, 30, DT_MS);
  assert.equal(r.phase, "in-range");
  assert.equal(r.inRange, true);
  assert.equal(r.forceReturn, false);
  assert.equal(r.remainingMs, 0);
  assert.ok(Math.abs(r.ratio - 10 / 30) < 1e-9);
});

test("正好等于上限：仍在范围内", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  const r = engine.update(30, 30, DT_MS);
  assert.equal(r.phase, "in-range");
  assert.equal(r.inRange, true);
  assert.equal(r.ratio, 1);
});

test("首次超限：进入容忍倒计时（remainingMs = 容忍时长）", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  const r = engine.update(35, 30, DT_MS);
  assert.equal(r.phase, "tolerant");
  assert.equal(r.inRange, false);
  assert.equal(r.remainingMs, TOLERANCE_MS);
  assert.equal(r.ratio, 1);
  assert.equal(r.forceReturn, false);
});

test("容忍阶段持续超限：按 dt 扣减", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  engine.update(35, 30, DT_MS);
  const r = engine.update(40, 30, DT_MS);
  assert.equal(r.phase, "tolerant");
  assert.equal(r.remainingMs, TOLERANCE_MS - DT_MS);
});

test("容忍中回到范围内：取消容忍，恢复正常 HUD", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  engine.update(35, 30, DT_MS);
  engine.update(40, 30, DT_MS);
  const r = engine.update(15, 30, DT_MS);
  assert.equal(r.phase, "in-range");
  assert.equal(r.inRange, true);
  assert.equal(r.remainingMs, 0);
  assert.equal(r.forceReturn, false);
  assert.ok(Math.abs(r.ratio - 15 / 30) < 1e-9);
});

test("容忍耗尽：仅最后一次触发强制回归，状态复位", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  const triggers = Math.ceil(TOLERANCE_MS / DT_MS) + 1; // 21 次：第 1 次进入容忍，之后每步扣 250ms
  let last = engine.update(35, 30, DT_MS);
  let forceCount = 0;
  for (let i = 1; i < triggers; i++) {
    last = engine.update(35, 30, DT_MS);
    if (last.forceReturn) forceCount++;
  }
  assert.equal(forceCount, 1, "仅最后一次触发一次强制回归");
  assert.equal(last!.forceReturn, true);
  assert.equal(last!.phase, "in-range");
  assert.equal(last!.remainingMs, 0);

  // 复位后再走动：立即可恢复“范围内”
  const after = engine.update(10, 30, DT_MS);
  assert.equal(after.phase, "in-range");
  assert.equal(after.forceReturn, false);
});

test("跨维度（Infinity）按超限处理", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  const r = engine.update(Infinity, 30, DT_MS);
  assert.equal(r.phase, "tolerant");
  assert.equal(r.inRange, false);
  assert.equal(r.ratio, 1);
});

test("maxDistance 实时参与判断：改小后原距离立即超限", () => {
  const engine = new SoulEngine(TOLERANCE_MS);
  assert.equal(engine.update(25, 30, DT_MS).inRange, true);
  const r = engine.update(25, 20, DT_MS); // 配置缩小到 20
  assert.equal(r.phase, "tolerant");
  assert.equal(r.inRange, false);
});
