// ─── 跨包 HUD 仲裁的单元测试(纯逻辑,不加载游戏运行时) ──────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStale, pickWinner, type BusClaim } from "../src/arbiter";

/** 构造一条声明 */
function claim(modId: string, priority: number, lastSeenTick = 100): BusClaim {
  return { modId, priority, lastSeenTick };
}

test("isStale 未超阈值时未过期", () => {
  assert.equal(isStale(claim("a", 1, 100), 130, 40), false);
});

test("isStale 恰好等于阈值时仍未过期(超时才失效)", () => {
  assert.equal(isStale(claim("a", 1, 100), 140, 40), false);
});

test("isStale 超过阈值时过期", () => {
  assert.equal(isStale(claim("a", 1, 100), 141, 40), true);
});

test("pickWinner 取优先级最高者", () => {
  const winner = pickWinner([claim("a", 10), claim("b", 60), claim("c", 30)], 100, 40);
  assert.equal(winner?.modId, "b");
});

test("pickWinner 同优先级按 modId 字典序小者胜", () => {
  const winner = pickWinner([claim("warehouse", 60), claim("auto-refill", 60)], 100, 40);
  assert.equal(winner?.modId, "auto-refill");
});

test("pickWinner 同优先级决胜与候选顺序无关", () => {
  const forward = pickWinner([claim("aaa", 60), claim("zzz", 60)], 100, 40);
  const backward = pickWinner([claim("zzz", 60), claim("aaa", 60)], 100, 40);
  assert.equal(forward?.modId, "aaa");
  assert.equal(backward?.modId, "aaa");
});

test("pickWinner 跳过优先级为 0 的声明", () => {
  const winner = pickWinner([claim("a", 0), claim("b", 1)], 100, 40);
  assert.equal(winner?.modId, "b");
});

test("pickWinner 跳过负优先级(显式放弃槽位)", () => {
  const winner = pickWinner([claim("a", -5), claim("b", 1)], 100, 40);
  assert.equal(winner?.modId, "b");
});

test("pickWinner 跳过已过期的声明", () => {
  const winner = pickWinner([claim("stale", 99, 0), claim("fresh", 1, 100)], 100, 40);
  assert.equal(winner?.modId, "fresh");
});

test("pickWinner 全部过期时返回 undefined", () => {
  assert.equal(pickWinner([claim("a", 10, 0), claim("b", 20, 1)], 100, 40), undefined);
});

test("pickWinner 全部放弃槽位时返回 undefined", () => {
  assert.equal(pickWinner([claim("a", 0), claim("b", -1)], 100, 40), undefined);
});

test("pickWinner 空候选返回 undefined", () => {
  assert.equal(pickWinner([], 100, 40), undefined);
});

test("pickWinner 高优先级过期后由次高者接管", () => {
  const claims = [claim("high", 99, 0), claim("mid", 60, 100), claim("low", 10, 100)];
  assert.equal(pickWinner(claims, 100, 40)?.modId, "mid");
});
