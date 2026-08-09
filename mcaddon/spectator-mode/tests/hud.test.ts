import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSoulHud } from "../scripts/core/hud";

test("范围内低比例：绿 + 距离/上限", () => {
  const text = buildSoulHud({ inRange: true, dist: 10, maxDistance: 30, remainingMs: 0 });
  assert.match(text, /灵魂出窍/);
  assert.match(text, /§a10\.0m/); // 10/30≈0.33 → 绿
  assert.match(text, /\/ 30m/);
});

test("范围内中比例：黄", () => {
  const text = buildSoulHud({ inRange: true, dist: 15, maxDistance: 30, remainingMs: 0 });
  assert.match(text, /§e15\.0m/); // 0.5 → 黄
});

test("范围内高比例：红（数字越红）", () => {
  const text = buildSoulHud({ inRange: true, dist: 29, maxDistance: 30, remainingMs: 0 });
  assert.match(text, /§c29\.0m/); // 0.966 → 红
});

test("容忍区：深红数字 + 超出 + 红色秒数倒计时", () => {
  const text = buildSoulHud({ inRange: false, dist: 35, maxDistance: 30, remainingMs: 3000 });
  assert.match(text, /§435\.0m/);
  assert.match(text, /超出/);
  assert.match(text, /3s 后强制回归/);
});

test("容忍区：小数毫秒向上取整为秒", () => {
  const text = buildSoulHud({ inRange: false, dist: 40, maxDistance: 30, remainingMs: 250 });
  assert.match(text, /1s 后强制回归/);
  assert.doesNotMatch(text, /0s 后强制回归/); // 250ms 向上取整为 1s，不应出现 0s
});

test("跨维度：距离显示 ∞", () => {
  const text = buildSoulHud({ inRange: false, dist: Infinity, maxDistance: 30, remainingMs: 2000 });
  assert.match(text, /∞m/);
  assert.match(text, /2s 后强制回归/);
});
