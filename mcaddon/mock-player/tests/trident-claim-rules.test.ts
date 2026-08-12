// ─── core/items — 投掷物双任认主规则 ──────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OWNER_TAG_PREFIX, OWNER2_TAG_PREFIX, ITEM_TAG_PREFIX, TRACKED_PROJECTILE_IDS,
  isTrackedProjectile, makeOwnerTag, makeSecondOwnerTag,
  parseClaimTags, resolveClaimOwner, isOwnedByFamily,
  makeItemTag, parseItemTag, projectileTypeLabel,
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

test("projectileTypeLabel：中文展示名兜底", () => {
  assert.equal(projectileTypeLabel("minecraft:thrown_trident"), "三叉戟");
  assert.equal(projectileTypeLabel("minecraft:arrow"), "箭");
  assert.equal(projectileTypeLabel("minecraft:unknown"), "投掷物");
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

// ─── 边界条件 ─────────────────────────────────────────

test("边界：空名 tag（mp:owner:）被忽略，不产生空主人", () => {
  const parsed = parseClaimTags(["mp:owner:", "mp:owner2:"]);
  assert.deepEqual(parsed, { firstOwner: undefined, secondOwner: undefined });
});

test("边界：名字含前缀子串（名字里有 owner2:）完整保留", () => {
  // 玩家名 "owner2:steve" → tag mp:owner:owner2:steve，解析应得完整名字
  const parsed = parseClaimTags(["mp:owner:owner2:steve"]);
  assert.deepEqual(parsed, { firstOwner: "owner2:steve", secondOwner: undefined });
});

test("边界：owner2 前缀不被 owner 前缀误截（前缀顺序安全）", () => {
  const parsed = parseClaimTags(["mp:owner2:bot1"]);
  assert.equal(parsed.firstOwner, undefined); // 不落进第一任
  assert.equal(parsed.secondOwner, "bot1");
});

test("边界：tag 列表重复时后者覆盖前者（同 tag 幂等）", () => {
  const parsed = parseClaimTags(["mp:owner:a", "mp:owner:b"]);
  assert.equal(parsed.firstOwner, "b"); // addTag 幂等不会出现，防御语义
});

test("isOwnedByFamily：第一任命中家族", () => {
  const family = new Set(["Steve", "bot1", "bot2"]);
  assert.equal(isOwnedByFamily("bot2", undefined, family), true);
  assert.equal(isOwnedByFamily("Steve", undefined, family), true);
});

test("isOwnedByFamily：第二任命中家族（同主假人投掷物被兄弟夺回）", () => {
  const family = new Set(["Steve", "bot1"]);
  assert.equal(isOwnedByFamily("Alex", "bot1", family), true);
});

test("isOwnedByFamily：双任都不在家族返回 false", () => {
  const family = new Set(["Steve", "bot1"]);
  assert.equal(isOwnedByFamily("Alex", "botX", family), false);
  assert.equal(isOwnedByFamily(undefined, undefined, family), false);
});

test("isOwnedByFamily：空家族恒 false", () => {
  assert.equal(isOwnedByFamily("Steve", undefined, new Set()), false);
});

// ─── 物品信息 tag 编码/解码（附魔/耐久） ───────────────

test("makeItemTag：附魔 + 耐久编码", () => {
  const tag = makeItemTag(
    [{ id: "sharpness", level: 5 }, { id: "loyalty", level: 3 }],
    { current: 120, max: 250 }
  );
  assert.equal(tag, "mp:item:sharpness:5,loyalty:3|120/250");
});

test("makeItemTag：无附魔仅耐久 / 无耐久仅附魔", () => {
  assert.equal(makeItemTag([], { current: 250, max: 250 }), "mp:item:|250/250");
  assert.equal(makeItemTag([{ id: "mending", level: 1 }], undefined), "mp:item:mending:1|");
});

test("parseItemTag：完整往返", () => {
  const tag = makeItemTag([{ id: "sharpness", level: 5 }], { current: 120, max: 250 });
  const parsed = parseItemTag(tag);
  assert.deepEqual(parsed, { enchantments: [{ id: "sharpness", level: 5 }], durability: { current: 120, max: 250 } });
});

test("parseItemTag：非 mp:item: 前缀返回 undefined", () => {
  assert.equal(parseItemTag("mp:owner:Steve"), undefined);
  assert.equal(parseItemTag("随便什么"), undefined);
});

test("parseItemTag：空段容忍（无附魔/无耐久）", () => {
  assert.deepEqual(parseItemTag("mp:item:|250/250"), { enchantments: [], durability: { current: 250, max: 250 } });
  assert.deepEqual(parseItemTag("mp:item:mending:1|"), { enchantments: [{ id: "mending", level: 1 }], durability: undefined });
});

test("parseItemTag：坏格式容忍（非法等级/耐久丢弃）", () => {
  const parsed = parseItemTag("mp:item:sharpness:abc,loyalty:3|120/xyz");
  assert.deepEqual(parsed, { enchantments: [{ id: "loyalty", level: 3 }], durability: undefined });
});

test("parseItemTag：空 body 返回空附魔", () => {
  assert.deepEqual(parseItemTag("mp:item:|"), { enchantments: [], durability: undefined });
});