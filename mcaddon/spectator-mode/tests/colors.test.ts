import { test } from "node:test";
import assert from "node:assert/strict";
import { OVER_DISTANCE_COLOR, rangeColor } from "../scripts/core/colors";

test("ratio 0 绿", () => {
  assert.equal(rangeColor(0), "§a");
});

test("低比例(<0.4) 绿", () => {
  assert.equal(rangeColor(0.1), "§a");
  assert.equal(rangeColor(0.39), "§a");
});

test("中比例(0.4~0.7) 黄", () => {
  assert.equal(rangeColor(0.4), "§e");
  assert.equal(rangeColor(0.6), "§e");
});

test("偏高(0.7~0.9) 金", () => {
  assert.equal(rangeColor(0.7), "§6");
  assert.equal(rangeColor(0.85), "§6");
});

test("接近上限(>=0.9) 红", () => {
  assert.equal(rangeColor(0.9), "§c");
  assert.equal(rangeColor(0.99), "§c");
});

test("达到上限 红", () => {
  assert.equal(rangeColor(1), "§c");
});

test("超出 1 钳制到红", () => {
  assert.equal(rangeColor(2), "§c");
});

test("负值钳制到 0 绿", () => {
  assert.equal(rangeColor(-1), "§a");
});

test("容忍区颜色为深红（供 hud 使用）", () => {
  assert.equal(OVER_DISTANCE_COLOR, "§4");
});
