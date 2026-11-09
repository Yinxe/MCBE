// ─── 配置归一化的单元测试 ───────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { clampWaypointLimit, normalizeConfig } from "../scripts/core/config";
import { DEFAULT_CONFIG } from "../scripts/core/types";

test("缺失载荷回落默认值", () => {
  assert.deepEqual(normalizeConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test("损坏的 JSON 字符串回落默认值", () => {
  assert.deepEqual(normalizeConfig("{ 这不是 json"), DEFAULT_CONFIG);
});

test("非对象载荷回落默认值", () => {
  assert.deepEqual(normalizeConfig(42), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig("[]"), DEFAULT_CONFIG);
});

test("部分字段缺失时逐字段回落", () => {
  const result = normalizeConfig(JSON.stringify({ maxWaypointsPerPlayer: 50 }));
  assert.equal(result.maxWaypointsPerPlayer, 50);
  assert.equal(result.publicWaypointEnabled, DEFAULT_CONFIG.publicWaypointEnabled);
});

test("字段类型不对时回落默认值", () => {
  const result = normalizeConfig(JSON.stringify({ maxWaypointsPerPlayer: "很多", publicWaypointEnabled: "yes" }));
  assert.equal(result.maxWaypointsPerPlayer, DEFAULT_CONFIG.maxWaypointsPerPlayer);
  assert.equal(result.publicWaypointEnabled, DEFAULT_CONFIG.publicWaypointEnabled);
});

test("上限收敛到允许范围", () => {
  assert.equal(clampWaypointLimit(5), 10);
  assert.equal(clampWaypointLimit(500), 100);
  assert.equal(clampWaypointLimit(30), 30);
  assert.equal(clampWaypointLimit(35.7), 35);
});

test("非有限数回落默认值", () => {
  assert.equal(clampWaypointLimit(NaN), DEFAULT_CONFIG.maxWaypointsPerPlayer);
  assert.equal(clampWaypointLimit(Infinity), DEFAULT_CONFIG.maxWaypointsPerPlayer);
});

test("已是对象时同样可归一化", () => {
  const result = normalizeConfig({ maxWaypointsPerPlayer: 60, publicWaypointEnabled: false });
  assert.deepEqual(result, { maxWaypointsPerPlayer: 60, publicWaypointEnabled: false });
});
