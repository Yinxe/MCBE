import test from "node:test";
import assert from "node:assert/strict";
import { isStale, pickWinner, type BusClaim } from "../src/display/arbiter";

const EXPIRY = 40;

function c(modId: string, priority: number, lastSeenTick: number): BusClaim {
  return { modId, priority, lastSeenTick };
}

test("pickWinner：优先级最高者胜", () => {
  const winner = pickWinner(
    [c("a", 10, 100), c("b", 200, 100), c("c", 50, 100)],
    110,
    EXPIRY
  );
  assert.equal(winner?.modId, "b");
});

test("pickWinner：同优先级取 modId 字典序小者（确定性决胜）", () => {
  const winner = pickWinner([c("zebra", 100, 100), c("alpha", 100, 100)], 110, EXPIRY);
  assert.equal(winner?.modId, "alpha");
});

test("pickWinner：priority <= 0 视为放弃，不参与", () => {
  const winner = pickWinner(
    [c("a", 0, 100), c("b", 500, 100), c("c", 0, 100)],
    110,
    EXPIRY
  );
  assert.equal(winner?.modId, "b");
});

test("pickWinner：空表 → undefined", () => {
  assert.equal(pickWinner([], 110, EXPIRY), undefined);
});

test("pickWinner：全部放弃/过期 → undefined", () => {
  const none = pickWinner([c("a", 0, 100), c("b", 0, 100)], 110, EXPIRY);
  assert.equal(none, undefined);
  const allStale = pickWinner([c("a", 100, 1)], 110, EXPIRY);
  assert.equal(allStale, undefined);
});

test("isStale：超时即过期、边界内不过期", () => {
  assert.equal(isStale(c("a", 100, 0), 41, EXPIRY), true);
  assert.equal(isStale(c("a", 100, 0), 40, EXPIRY), false);
  assert.equal(isStale(c("a", 100, 70), 110, EXPIRY), false);
});

test("pickWinner：把过期的高优先级声明排除（心跳机制）", () => {
  const winner = pickWinner(
    [c("dead", 999, 1), c("live", 50, 110), c("live2", 30, 110)],
    110,
    EXPIRY
  );
  assert.equal(winner?.modId, "live");
});