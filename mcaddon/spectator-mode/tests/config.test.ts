import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampMaxDistance,
  defaultConfig,
  DEFAULT_MAX_DISTANCE,
  MAX_DISTANCE_MAX,
  MAX_DISTANCE_MIN,
} from "../scripts/core/config";

test("默认配置：启用 + 默认最大距离 + 连线默认关", () => {
  const config = defaultConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.maxDistance, DEFAULT_MAX_DISTANCE);
  assert.equal(config.showLink, false);
});

test("clamp：低于下限抬到下限", () => {
  assert.equal(clampMaxDistance(1), MAX_DISTANCE_MIN);
});

test("clamp：高于上限压到上限", () => {
  assert.equal(clampMaxDistance(9999), MAX_DISTANCE_MAX);
});

test("clamp：合法区间内原值返回", () => {
  assert.equal(clampMaxDistance(50), 50);
  assert.equal(clampMaxDistance(MAX_DISTANCE_MIN), MAX_DISTANCE_MIN);
  assert.equal(clampMaxDistance(MAX_DISTANCE_MAX), MAX_DISTANCE_MAX);
});

test("clamp：NaN 回退默认", () => {
  assert.equal(clampMaxDistance(NaN), DEFAULT_MAX_DISTANCE);
});

test("clamp：Infinity 回退默认", () => {
  assert.equal(clampMaxDistance(Infinity), DEFAULT_MAX_DISTANCE);
});
