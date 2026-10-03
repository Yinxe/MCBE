// ─── 版本兼容门禁 domain 测试：最低版本/成因文案/回落顺序 ──────────
import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_CUSTOM_DIMENSION_VERSION,
  dimensionFailureNotice,
  storageUnavailableReason,
  type DimensionFailureInfo,
} from "../scripts/domain/Compat";

test("缺 API：必须写明最低版本、Beta APIs 与不可用范围", () => {
  const text = dimensionFailureNotice("api-missing", null);
  assert.match(text, /当前游戏版本不支持自定义维度/);
  assert.ok(text.includes(MIN_CUSTOM_DIMENSION_VERSION), `缺最低版本号：${text}`);
  assert.match(text, /Beta APIs/);
  assert.match(text, /建档与物品仓无法使用/);
});

test("注册抛错：带引擎原文，且仍给出最低版本", () => {
  const text = dimensionFailureNotice("register-failed", "维度不存在或不可访问：mockplayer:test");
  assert.match(text, /注册失败/);
  assert.ok(text.includes(MIN_CUSTOM_DIMENSION_VERSION));
  assert.match(text, /维度不存在或不可访问/);
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

test("存储不可用回落顺序：维度结论 > 注册原文 > 通用兜底", () => {
  const dim: DimensionFailureInfo = { kind: "api-missing", detail: null };
  assert.equal(storageUnavailableReason(dim, "读取失败"), dimensionFailureNotice("api-missing", null));
  assert.match(storageUnavailableReason(null, "存储区域记录读取失败"), /存储区域记录读取失败/);
  assert.match(storageUnavailableReason(null, "存储区域记录读取失败"), /物品存储未就绪/);
  assert.match(storageUnavailableReason(null, null), /稍后再试/);
});
