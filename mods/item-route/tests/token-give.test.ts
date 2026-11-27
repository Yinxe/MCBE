import { test } from "node:test";
import assert from "node:assert/strict";
import { decideGiveOutcome } from "../scripts/core/token";

test("发放: 已持有信物 → 不再发放", () => {
  assert.equal(decideGiveOutcome({ alreadyHas: true, hasEmptySlot: true, containerReadable: true }), "already-has");
  // 已持有优先于「背包满」：两种情况都不该再发
  assert.equal(decideGiveOutcome({ alreadyHas: true, hasEmptySlot: false, containerReadable: true }), "already-has");
});

test("发放: 未持有且有空位 → 放入背包", () => {
  assert.equal(decideGiveOutcome({ alreadyHas: false, hasEmptySlot: true, containerReadable: true }), "into-inventory");
});

test("发放: 未持有且背包满 → 溢出到地面", () => {
  assert.equal(decideGiveOutcome({ alreadyHas: false, hasEmptySlot: false, containerReadable: true }), "dropped");
});

test("发放: 背包不可读 → 放弃（不抛错、不误发）", () => {
  assert.equal(decideGiveOutcome({ alreadyHas: false, hasEmptySlot: true, containerReadable: false }), "unavailable");
  assert.equal(decideGiveOutcome({ alreadyHas: false, hasEmptySlot: false, containerReadable: false }), "unavailable");
});
