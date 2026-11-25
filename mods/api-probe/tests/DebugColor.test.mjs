// ─── DebugColor 单测:跨版本颜色构造 ───────────────────────────────
//
// 这一层对应的真实 bug:类型定义说 `color` 是 RGB,运行时却要 alpha。
// 测试要钉住三件事:
//   1. 三分量输入 → 补出 alpha=1(两版都接受的超集写法)
//   2. 显式给的 alpha 不被覆盖,包括 0(全透明是合法值,不能被 `??` 误判)
//   3. 读回时 alpha 缺失与存在能被区分(这是判定运行时版本的依据)

import assert from "node:assert/strict";
import { test } from "node:test";
import { ALPHA_OPAQUE, alphaOf, describeColor, hasAlpha, toNativeColor } from "../lib/scripts/DebugColor.js";

test("三分量输入补出 alpha=1", () => {
  const color = toNativeColor({ red: 1, green: 0.2, blue: 0.3 });
  assert.deepEqual(color, { red: 1, green: 0.2, blue: 0.3, alpha: 1 });
});

test("显式 alpha 原样保留", () => {
  const color = toNativeColor({ red: 0, green: 0, blue: 0, alpha: 0.35 });
  assert.equal(color.alpha, 0.35);
});

test("alpha=0 不被当成缺失", () => {
  // 0 是合法的不透明度,`??` 只对 null/undefined 生效,这里必须保住 0
  const color = toNativeColor({ red: 1, green: 1, blue: 1, alpha: 0 });
  assert.equal(color.alpha, 0);
});

test("可覆盖默认 alpha", () => {
  const color = toNativeColor({ red: 1, green: 1, blue: 1 }, 0.5);
  assert.equal(color.alpha, 0.5);
});

test("返回新对象,不污染原对象", () => {
  const source = { red: 1, green: 0, blue: 0 };
  const color = toNativeColor(source);
  color.alpha = 0.1;
  assert.equal(source.alpha, undefined);
});

test("默认不透明度是全不透明", () => {
  assert.equal(ALPHA_OPAQUE, 1);
});

test("读回 alpha:新引擎给出数值", () => {
  assert.equal(alphaOf({ red: 1, green: 1, blue: 1, alpha: 0.5 }), 0.5);
  assert.equal(hasAlpha({ red: 1, green: 1, blue: 1, alpha: 1 }), true);
});

test("读回 alpha:老引擎缺该字段", () => {
  assert.equal(alphaOf({ red: 1, green: 1, blue: 1 }), undefined);
  assert.equal(hasAlpha({ red: 1, green: 1, blue: 1 }), false);
});

test("读回 alpha:非对象或字段类型不对时安全返回", () => {
  assert.equal(alphaOf(undefined), undefined);
  assert.equal(alphaOf(null), undefined);
  assert.equal(alphaOf("rgba"), undefined);
  assert.equal(alphaOf({ alpha: "0.5" }), undefined);
});

test("颜色文本:无 alpha 写 rgb,有 alpha 写 rgba", () => {
  assert.equal(describeColor({ red: 1, green: 0.2, blue: 0 }), "rgb(1, 0.2, 0)");
  assert.equal(describeColor({ red: 1, green: 0.2, blue: 0, alpha: 0.35 }), "rgba(1, 0.2, 0, 0.35)");
});
