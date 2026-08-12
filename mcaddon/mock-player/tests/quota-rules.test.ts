// ─── core/service — 配额规则 ──────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { canCreateBot, remainingQuota } from "../scripts/core/service/QuotaRules";

test("普通玩家：数量未达配额可创建", () => {
  assert.equal(canCreateBot(3, 5, false), true);
});

test("普通玩家：达到配额拒绝（count == quota）", () => {
  assert.equal(canCreateBot(5, 5, false), false);
});

test("普通玩家：超过配额拒绝", () => {
  assert.equal(canCreateBot(6, 5, false), false);
});

test("配额为 0 = 禁止创建", () => {
  assert.equal(canCreateBot(0, 0, false), false);
});

test("管理员豁免：无论数量与配额均可创建", () => {
  assert.equal(canCreateBot(99, 0, true), true);
  assert.equal(canCreateBot(0, 5, true), true);
});

test("remainingQuota：剩余名额", () => {
  assert.equal(remainingQuota(3, 5, false), 2);
  assert.equal(remainingQuota(5, 5, false), 0);
});

test("remainingQuota：管理员返回 -1（无限）", () => {
  assert.equal(remainingQuota(99, 5, true), -1);
});