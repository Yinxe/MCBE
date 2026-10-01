// ─── core/tags — 标签系统 ─────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TAG_BOT, TAG_IDLE, TAG_AUTO_MINE, TAG_AUTO_ATTACK, TAG_AUTO_JUMP, TAG_CONTROL, TAG_VAULT_MODE, TAG_RESPAWN,
  COEXIST_TAGS, EXCLUSIVE_TAGS, STANDALONE_TAGS, LEGACY_TAGS, ALL_TAGS, DEFAULT_TAGS,
  EXCLUSIVE_SET, STANDALONE_SET, BOT_TAG, getTagDef, resolveTag, getTagGroups, computeTagsFromBehaviorForm, validateTagSet,
} from "../scripts/rules/tags/BotTags";

test("标签分组：互斥/独立组均已清空（行为标签+劫掠收编工作模式），legacy 标签在旧组", () => {
  const coexist = COEXIST_TAGS.map((t) => t.value);
  const exclusive = EXCLUSIVE_TAGS.map((t) => t.value);
  const standalone = STANDALONE_TAGS.map((t) => t.value);
  assert.equal(new Set(coexist).size, coexist.length); // 无重复
  assert.equal(exclusive.length, 0, "互斥组已清空");
  assert.equal(standalone.length, 0, "独立开关组已清空（劫掠收编工作模式）");
  // 旧行为标签仍可解析（legacy 引擎内部使用：宝库/钓鱼/control 等）
  assert.ok(getTagDef(TAG_AUTO_MINE.value) !== undefined, "旧标签定义保留");
  assert.ok(ALL_TAGS.some((t) => t.value === TAG_AUTO_MINE.value));
  assert.equal(ALL_TAGS.length, coexist.length + exclusive.length + standalone.length + LEGACY_TAGS.length);
});

test("标签分组：DEFAULT_TAGS = bot + respawn + idle", () => {
  assert.deepEqual(DEFAULT_TAGS, [TAG_BOT.value, "mockplayer:tag:respawn", TAG_IDLE.value]);
});

test("resolveTag：精确 value 匹配", () => {
  const def = resolveTag(TAG_AUTO_MINE.value);
  assert.equal(def?.value, TAG_AUTO_MINE.value);
});

test("resolveTag：中文 label 匹配", () => {
  const def = resolveTag("自动挖掘");
  assert.equal(def?.value, TAG_AUTO_MINE.value);
});

test("resolveTag：短名匹配（自动补前缀）", () => {
  assert.equal(resolveTag("autoMine")?.value, TAG_AUTO_MINE.value);
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
  assert.ok(!EXCLUSIVE_SET.has(TAG_AUTO_MINE.value), "行为标签机制已删除——不再互斥");
  assert.ok(!EXCLUSIVE_SET.has(TAG_AUTO_JUMP.value)); // 共存标签不在互斥组
  assert.equal(STANDALONE_SET.size, 0, "劫掠收编工作模式后独立组为空");
  assert.equal(BOT_TAG, "mockplayer:tag:bot");
});

test("getTagGroups：三分组结构与定义一致", () => {
  const groups = getTagGroups();
  assert.equal(groups.coexist.length, COEXIST_TAGS.length);
  assert.equal(groups.standalone.length, STANDALONE_TAGS.length);
  assert.equal(groups.exclusive.length, EXCLUSIVE_TAGS.length);
});

// ─── computeTagsFromBehaviorForm（行为菜单表单 → 标签集） ──
// 劫掠已收编工作模式单选（不再走标签）——表单只剩共存勾选，恒兜底空闲。

test("computeTagsFromBehaviorForm：bot 标识打底 + 共存勾选 + 空闲兜底", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [TAG_RESPAWN.value, TAG_AUTO_JUMP.value] });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_RESPAWN.value, TAG_AUTO_JUMP.value, TAG_IDLE.value]);
});

test("computeTagsFromBehaviorForm：全空表单仅 bot 标识 + 空闲兜底", () => {
  const tags = computeTagsFromBehaviorForm({ coexist: [] });
  assert.deepEqual(tags, [TAG_BOT.value, TAG_IDLE.value]);
});

// ─── validateTagSet（标签集校验） ───────────────────────

test("validateTagSet：合法标签集通过", () => {
  assert.equal(validateTagSet([TAG_BOT.value, TAG_RESPAWN.value, TAG_IDLE.value]), undefined);
  // 共存 + legacy 行为标签并存
  assert.equal(validateTagSet([TAG_BOT.value, TAG_AUTO_JUMP.value, TAG_AUTO_ATTACK.value]), undefined);
});

test("validateTagSet：未知标签拒绝", () => {
  const rejected = validateTagSet([TAG_BOT.value, "mockplayer:tag:hack"]);
  assert.ok(rejected && rejected.includes("未知标签"));
});

test("validateTagSet：假人标识缺失拒绝", () => {
  const rejected = validateTagSet([TAG_IDLE.value, TAG_RESPAWN.value]);
  assert.ok(rejected && rejected.includes("标识标签不可移除"));
});

test("validateTagSet：行为标签机制已删除——旧行为标签不再互斥拒绝", () => {
  // 旧行为标签（自动挖掘/自动放置等）已降级为 legacy 内部使用，
  // 不再参与互斥校验（EXCLUSIVE 组为空）——任意组合都通过（仍须含 bot 标识）
  assert.equal(validateTagSet([TAG_BOT.value, TAG_IDLE.value, TAG_AUTO_MINE.value]), undefined);
});

test("validateTagSet：空标签集拒绝（缺身份标识）", () => {
  const rejected = validateTagSet([]);
  assert.ok(rejected && rejected.includes("标识标签不可移除"));
});
