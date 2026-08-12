// ─── core/items — 投掷物双任认主规则 ──────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OWNER_TAG_PREFIX, OWNER2_TAG_PREFIX, TRACKED_PROJECTILE_IDS,
  isTrackedProjectile, makeOwnerTag, makeSecondOwnerTag,
  parseClaimTags, resolveClaimOwner,
} from "../scripts/core/items/TridentClaimRules";

test("tag 常量：前缀格式", () => {
  assert.equal(OWNER_TAG_PREFIX, "mp:owner:");
  assert.equal(OWNER2_TAG_PREFIX, "mp:owner2:");
});

test("isTrackedProjectile：三叉戟与箭在列（arrow 含药水箭）", () => {
  assert.ok(isTrackedProjectile("minecraft:thrown_trident"));
  assert.ok(isTrackedProjectile("minecraft:arrow"));
  assert.ok(!isTrackedProjectile("minecraft:snowball"));
  assert.ok(!isTrackedProjectile("minecraft:egg"));
  assert.deepEqual([...TRACKED_PROJECTILE_IDS], ["minecraft:thrown_trident", "minecraft:arrow"]);
});

test("tag 构建", () => {
  assert.equal(makeOwnerTag("Steve"), "mp:owner:Steve");
  assert.equal(makeSecondOwnerTag("bot1"), "mp:owner2:bot1");
});

test("parseClaimTags：解析双任主人", () => {
  const tags = ["mp:owner:Steve", "mp:owner2:bot1", "mockplayer:tag:bot"];
  assert.deepEqual(parseClaimTags(tags), { firstOwner: "Steve", secondOwner: "bot1" });
});

test("parseClaimTags：只有第一任 / 只有第二任 / 无认主 tag", () => {
  assert.deepEqual(parseClaimTags(["mp:owner:Steve"]), { firstOwner: "Steve", secondOwner: undefined });
  assert.deepEqual(parseClaimTags(["mp:owner2:bot1"]), { firstOwner: undefined, secondOwner: "bot1" });
  assert.deepEqual(parseClaimTags(["mockplayer:tag:bot", "mp:trid:bot1"]), { firstOwner: undefined, secondOwner: undefined });
});

test("parseClaimTags：旧格式 mp:trid: 不兼容（明确忽略）", () => {
  // 旧格式 mp:trid:<botName> 不应被识别为任何一任
  const parsed = parseClaimTags(["mp:trid:bot1"]);
  assert.equal(parsed.firstOwner, undefined);
  assert.equal(parsed.secondOwner, undefined);
});

test("resolveClaimOwner：第二任在线优先于第一任", () => {
  const online = new Set(["bot1"]);
  const r = resolveClaimOwner("Steve", "bot1", (n) => online.has(n));
  assert.equal(r, "bot1");
});

test("resolveClaimOwner：第二任离线时回退第一任", () => {
  const online = new Set(["Steve"]);
  const r = resolveClaimOwner("Steve", "bot1", (n) => online.has(n));
  assert.equal(r, "Steve");
});

test("resolveClaimOwner：双任都离线返回 undefined（等上线夺回）", () => {
  const r = resolveClaimOwner("Steve", "bot1", () => false);
  assert.equal(r, undefined);
});

test("resolveClaimOwner：无第二任时认第一任", () => {
  const r = resolveClaimOwner("Steve", undefined, (n) => n === "Steve");
  assert.equal(r, "Steve");
});

test("resolveClaimOwner：无任何主人返回 undefined", () => {
  assert.equal(resolveClaimOwner(undefined, undefined, () => true), undefined);
});