// ─── core/tags — 标签系统 ─────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TAG_BOT, TAG_IDLE, TAG_AUTO_MINE, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_CONTROL, TAG_VAULT_MODE, TAG_RAID_MODE, TAG_RESPAWN, TAG_WANDER_MODE,
  COEXIST_TAGS, EXCLUSIVE_TAGS, STANDALONE_TAGS, ALL_TAGS, DEFAULT_TAGS,
  EXCLUSIVE_SET, STANDALONE_SET, BOT_TAG, getTagDef, resolveTag, getTagGroups, computeTagsFromBehaviorForm, validateTagSet,
} from "../scripts/rules/tags/BotTags";

test("标签分组：可共存/互斥/独立开关互不重叠", () => {
  const coexist = COEXIST_TAGS.map((t) => t.value);
  const exclusive = EXCLUSIVE_TAGS.map((t) => t.value);
  const standalone = STANDALONE_TAGS.map((t) => t.value);
  assert.equal(new Set(coexist).size, coexist.length); // 无重复
  assert.ok(exclusive.includes(TAG_IDLE.value));
  assert.ok(exclusive.includes(TAG_CONTROL.value));
  assert.ok(exclusive.includes(TAG_VAULT_MODE.value));
  assert.ok(standalone.includes(TAG_RAID_MODE.value));
  // 互斥组与共存组不重叠
  for (const v of exclusive) assert.ok(!coexist.includes(v));
  assert.equal(ALL_TAGS.length, coexist.length + exclusive.length + standalone.length);
});

test("标签分组：DEFAULT_TAGS = bot + respawn + idle", () => {
  assert.deepEqual(DEFAULT_TAGS, [TAG_BOT.value, "mockplayer:tag:respawn", TAG_IDLE.value]);
});

test("resolveTag：精确 value 匹配", () => {
  const def = resolveTag(TAG_AUTO_MINE.value);
  assert.equal(def?.label, "自动挖掘");
});

test("resolveTag：中文 label 匹配", () => {
  const def = resolveTag("自动挖掘");
  assert.equal(def?.value, TAG_AUTO_MINE.value);
});

test("resolveTag：短名匹配（自动补前缀）", () => {
  assert.equal(resolveTag("autoMine")?.value, TAG_AUTO_MINE.value);
  assert.equal(resolveTag("raidMode")?.value, TAG_RAID_MODE.value);
});

test("resolveTag：忽略大小写匹配", () => {
  assert.equal(resolveTag("AUTOMINE")?.value, TAG_AUTO_MINE.value);
  assert.equal(resolveTag("自动挖掘")?.value, TAG_AUTO_MINE.value);
});

test("resolveTag：未知标签返回 undefined", () => {
  assert.equal(resolveTag("不存在的标签"), undefined);
  assert.equal(resolveTag(""), undefined);
});

test("getTagDef：value 反查定义，未知返回 undefined", () => {
  assert.equal(getTagDef(BOT_TAG)?.label, "假人标识");
  assert.equal(getTagDef("mockplayer:tag:nope"), undefined);
});

test("集合与常量：EXCLUSIVE_SET / STANDALONE_SET / BOT_TAG", () => {
  assert.ok(EXCLUSIVE_SET.has(TAG_AUTO_MINE.value));
  assert.ok(!EXCLUSIVE_SET.has(TAG_AUTO_JUMP.value)); // 共存标签不在互斥组
  assert.ok(STANDALONE_SET.has(TAG_RAID_MODE.value));
  assert.equal(BOT_TAG, "mockplayer:tag:bot");
});

test("getTagGroups：三分组结构与定义一致", () => {
  const groups = getTagGroups();
  assert.equal(groups.coexist.length, COEXIST_TAGS.length);
  assert.equal(groups.standalone.length, STANDALONE_TAGS.length);
  assert.equal(groups.exclusive.length, EXCLUSIVE_TAGS.length);
});

// ─── computeTagsFromBehaviorForm（行为菜单表单 → 标签集） ──

test("computeTagsFromBehaviorForm：bot 标识打底 + 共存勾选", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [TAG_RESPAWN.value, TAG_AUTO_JUMP.value], exclusive: undefined, raidMode: false, aiBehavior: "none" });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_RESPAWN.value, TAG_AUTO_JUMP.value]);
});

test("computeTagsFromBehaviorForm：互斥单选追加", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [], exclusive: TAG_VAULT_MODE.value, raidMode: false, aiBehavior: "none" });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_VAULT_MODE.value]);
});

test("computeTagsFromBehaviorForm：劫掠独立开关与互斥并存", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [TAG_RESPAWN.value], exclusive: TAG_AUTO_ATTACK.value, raidMode: true, aiBehavior: "none" });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_RESPAWN.value, TAG_AUTO_ATTACK.value, TAG_RAID_MODE.value]);
});

test("computeTagsFromBehaviorForm：全空表单仅 bot 标识", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [], exclusive: undefined, raidMode: false, aiBehavior: "none" });
  assert.deepEqual(tags, [TAG_BOT.value]);
});

// ─── validateTagSet（标签集校验） ───────────────────────

test("validateTagSet：合法标签集通过", () => {
  assert.equal(validateTagSet([TAG_BOT.value, TAG_RESPAWN.value, TAG_IDLE.value]), undefined);
  // 互斥 + 独立开关 + 共存并存
  assert.equal(validateTagSet([TAG_BOT.value, TAG_AUTO_JUMP.value, TAG_AUTO_ATTACK.value, TAG_RAID_MODE.value]), undefined);
});

test("validateTagSet：未知标签拒绝", () => {
  const rejected = validateTagSet([TAG_BOT.value, "mockplayer:tag:hack"]);
  assert.ok(rejected && rejected.includes("未知标签"));
});

test("validateTagSet：假人标识缺失拒绝", () => {
  const rejected = validateTagSet([TAG_IDLE.value, TAG_RESPAWN.value]);
  assert.ok(rejected && rejected.includes("标识标签不可移除"));
});

test("validateTagSet：多个互斥标签拒绝", () => {
  const rejected = validateTagSet([TAG_BOT.value, TAG_IDLE.value, TAG_AUTO_MINE.value]);
  assert.ok(rejected && rejected.includes("互斥标签"));
});

test("validateTagSet：空标签集拒绝（缺身份标识）", () => {
  const rejected = validateTagSet([]);
  assert.ok(rejected && rejected.includes("标识标签不可移除"));
});
test("computeTagsFromBehaviorForm：生物AI能力单选（随机游走优先于互斥行为）", () => {
  // 选随机游走 + 互斥行为同时传 → 生物 AI 能力优先（同一互斥组）
  const tags = computeTagsFromBehaviorForm({ coexist: [], exclusive: TAG_VAULT_MODE.value, raidMode: false, aiBehavior: "wander" });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_WANDER_MODE.value]);
  // 仅选随机游走
  const tags2 = computeTagsFromBehaviorForm({ coexist: [], exclusive: undefined, raidMode: false, aiBehavior: "wander" });
  assert.deepEqual(tags2, [TAG_BOT.value, TAG_WANDER_MODE.value]);
});
