// ─── 版本兼容 domain 测试：最低版本/锚点选择/成因文案/回落顺序 ──────
import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_STORAGE_ANCHOR,
  MIN_CUSTOM_DIMENSION_VERSION,
  PRIMARY_STORAGE_ANCHOR,
  TEST_DIMENSION_ID,
  dimensionFailureNotice,
  isTestDimensionRegion,
  storageAnchorFor,
  storageUnavailableReason,
  type DimensionFailureInfo,
} from "../scripts/domain/Compat";

test("缺 API：写明最低版本、Beta APIs 与兼容模式", () => {
  const text = dimensionFailureNotice("api-missing", null);
  assert.match(text, /当前游戏版本不支持自定义维度/);
  assert.ok(text.includes(MIN_CUSTOM_DIMENSION_VERSION), `缺最低版本号：${text}`);
  assert.match(text, /Beta APIs/);
  assert.match(text, /兼容模式/);
  assert.match(text, /末地/);
  assert.ok(!text.includes("无法使用"), `兼容模式下不该说功能不可用：${text}`);
});

test("注册抛错：带引擎原文，且仍给出最低版本与兼容模式", () => {
  const text = dimensionFailureNotice("register-failed", "维度不存在或不可访问：mockplayer:test");
  assert.match(text, /注册失败/);
  assert.ok(text.includes(MIN_CUSTOM_DIMENSION_VERSION));
  assert.match(text, /维度不存在或不可访问/);
  assert.match(text, /兼容模式/);
});

test("注册抛错但无原文：不留空括号", () => {
  const text = dimensionFailureNotice("register-failed", null);
  assert.match(text, /注册失败/);
  assert.ok(!text.includes("引擎原文"), text);
});

test("当次未载入：指向 /reload 与重启世界", () => {
  const text = dimensionFailureNotice("not-loaded", null);
  assert.match(text, /当次未载入/);
  assert.match(text, /reload/);
  assert.match(text, /重启世界/);
});

test("锚点选择：维度可用取首选，不可用取末地兼容锚点", () => {
  assert.equal(storageAnchorFor(true), PRIMARY_STORAGE_ANCHOR);
  assert.equal(storageAnchorFor(false), FALLBACK_STORAGE_ANCHOR);
  assert.equal(PRIMARY_STORAGE_ANCHOR.dimension, "mockplayer:test");
  assert.deepEqual(PRIMARY_STORAGE_ANCHOR.anchor, { x: 16, y: 0, z: 16 });
  assert.equal(FALLBACK_STORAGE_ANCHOR.dimension, "minecraft:the_end");
  assert.deepEqual(FALLBACK_STORAGE_ANCHOR.anchor, { x: 300000, y: 0, z: 300000 });
});

test("首选锚点维度与测试维度是同一常量：改名不可能只改一处", () => {
  assert.equal(PRIMARY_STORAGE_ANCHOR.dimension, TEST_DIMENSION_ID);
  assert.equal(TEST_DIMENSION_ID, "mockplayer:test");
});

test("区域归属判定：测试维度区域按前缀识别，末地/主世界不算", () => {
  assert.equal(isTestDimensionRegion("mockplayer:test:1:1"), true);
  assert.equal(isTestDimensionRegion("mockplayer:test:0:0"), true);
  assert.equal(isTestDimensionRegion("2:18750:18750"), false);
  assert.equal(isTestDimensionRegion("the_end:18750:18750"), false);
  assert.equal(isTestDimensionRegion("mockplayer:testbed:1:1"), false);
});

test("两种锚点都失败：注册原文是根因，维度结论只作补充", () => {
  const dim: DimensionFailureInfo = { kind: "api-missing", detail: null };
  assert.match(storageUnavailableReason(dim, "存储区域记录读取失败"), /存储区域记录读取失败/);
  assert.match(storageUnavailableReason(dim, null), /兼容模式/);
  assert.match(storageUnavailableReason(null, "存储区域记录读取失败"), /物品存储未就绪/);
  assert.match(storageUnavailableReason(null, null), /稍后再试/);
});

test("当次未载入优先给可自解提示：重启世界优先于注册原文", () => {
  const dim: DimensionFailureInfo = { kind: "not-loaded", detail: null };
  const text = storageUnavailableReason(dim, "维度不存在或不可访问：mockplayer:test");
  assert.match(text, /当次未载入/);
  assert.match(text, /重启世界/);
});
