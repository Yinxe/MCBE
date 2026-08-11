// ─── 图腾策略单测（纯逻辑，node:test） ─────────────────
// 覆盖 TotemPolicy 的治愈来源判别（高版本精确比对 / 低版本排除法 / 非字符串）
// 与副手补充需求判定。零 @minecraft 依赖（纯字符串/undefined 输入），镜像
// item-route 与 auto-refill 其它测试的机制。

import { test } from "node:test";
import assert from "node:assert/strict";
import { isTotemHealCause, needsTotemRefill, TOTEM_TYPE_ID } from "../scripts/TotemPolicy";

// ─── isTotemHealCause ──────────────────────────────────

test("高版本：cause 为 TotemOfUndying 精确命中", () => {
  assert.equal(isTotemHealCause("TotemOfUndying"), true);
});

test("低版本排除法：Heal / Regeneration / SelfHeal 均非图腾", () => {
  assert.equal(isTotemHealCause("Heal"), false);
  assert.equal(isTotemHealCause("Regeneration"), false);
  assert.equal(isTotemHealCause("SelfHeal"), false);
});

test("低版本排除法：非三者的其它字符串推测为图腾", () => {
  assert.equal(isTotemHealCause("Totem"), true);
  assert.equal(isTotemHealCause("UnknownSource"), true);
  assert.equal(isTotemHealCause(""), true);
});

test("非字符串输入一律 false（防误报）", () => {
  assert.equal(isTotemHealCause(undefined), false);
  assert.equal(isTotemHealCause(null), false);
  assert.equal(isTotemHealCause(42), false);
  assert.equal(isTotemHealCause({}), false);
});

// ─── needsTotemRefill ──────────────────────────────────

test("副手空（undefined）→ 需要补充", () => {
  assert.equal(needsTotemRefill(undefined), true);
});

test("副手持非图腾物品 → 需要补充（但副手被占，refillOffhand 会拒）", () => {
  assert.equal(needsTotemRefill("minecraft:shield"), true);
  assert.equal(needsTotemRefill("minecraft:arrow"), true);
});

test("副手仍持图腾（含多枚堆叠）→ 不需补充（幂等）", () => {
  assert.equal(needsTotemRefill(TOTEM_TYPE_ID), false);
  assert.equal(needsTotemRefill("minecraft:totem_of_undying"), false);
});
