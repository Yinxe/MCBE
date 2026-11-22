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
  assert.equal(
    result.publicWaypointEnabled,
    DEFAULT_CONFIG.publicWaypointEnabled,
  );
});

test("字段类型不对时回落默认值", () => {
  const result = normalizeConfig(
    JSON.stringify({
      maxWaypointsPerPlayer: "很多",
      publicWaypointEnabled: "yes",
    }),
  );
  assert.equal(
    result.maxWaypointsPerPlayer,
    DEFAULT_CONFIG.maxWaypointsPerPlayer,
  );
  assert.equal(
    result.publicWaypointEnabled,
    DEFAULT_CONFIG.publicWaypointEnabled,
  );
});

test("上限收敛到允许范围", () => {
  assert.equal(clampWaypointLimit(5), 10);
  assert.equal(clampWaypointLimit(500), 100);
  assert.equal(clampWaypointLimit(30), 30);
  assert.equal(clampWaypointLimit(35.7), 35);
});

test("非有限数回落默认值", () => {
  assert.equal(clampWaypointLimit(NaN), DEFAULT_CONFIG.maxWaypointsPerPlayer);
  assert.equal(
    clampWaypointLimit(Infinity),
    DEFAULT_CONFIG.maxWaypointsPerPlayer,
  );
});

test("已是对象时同样可归一化", () => {
  const result = normalizeConfig({
    maxWaypointsPerPlayer: 60,
    publicWaypointEnabled: false,
  });
  assert.equal(result.maxWaypointsPerPlayer, 60);
  assert.equal(result.publicWaypointEnabled, false);
});

// ─── 转场配置 ───────────────────────────────────────────────

test("转场字段缺失时回落默认值", () => {
  const result = normalizeConfig(JSON.stringify({ maxWaypointsPerPlayer: 50 }));
  assert.equal(result.transitionEnabled, true);
  assert.equal(result.transitionStyle, "cinematic");
  assert.deepEqual(result.transitionZoomHeights.overworld, [20, 40, 60]);
  assert.deepEqual(result.transitionZoomHeights.nether, [20, 40, 60]);
  assert.deepEqual(result.transitionZoomHeights.end, [20, 40, 60]);
  assert.deepEqual(result.transitionZoomTicks, [13, 13, 13]);
  assert.equal(result.transitionVolume, 0.5);
});

test("非法风格回落 cinematic", () => {
  assert.equal(
    normalizeConfig({ transitionStyle: "warpspeed" }).transitionStyle,
    "cinematic",
  );
  assert.equal(
    normalizeConfig({ transitionStyle: 42 }).transitionStyle,
    "cinematic",
  );
  assert.equal(
    normalizeConfig({ transitionStyle: null }).transitionStyle,
    "cinematic",
  );
  // 合法值原样保留
  assert.equal(
    normalizeConfig({ transitionStyle: "fade" }).transitionStyle,
    "fade",
  );
  assert.equal(
    normalizeConfig({ transitionStyle: "off" }).transitionStyle,
    "off",
  );
});

test("总开关为 false 时风格收敛为 off", () => {
  const result = normalizeConfig({
    transitionEnabled: false,
    transitionStyle: "cinematic",
  });
  assert.equal(result.transitionEnabled, false);
  assert.equal(result.transitionStyle, "off");
});

test("总开关类型不对时按开启处理", () => {
  // 老存档没有该字段,不能因为缺失就把转场关掉
  assert.equal(normalizeConfig({}).transitionEnabled, true);
  assert.equal(
    normalizeConfig({ transitionEnabled: "false" }).transitionEnabled,
    true,
  );
});

test("高度、时长与音量越界夹取", () => {
  const result = normalizeConfig({
    transitionZoomHeights: { overworld: [0, 500, 30] },
    transitionZoomTicks: [0, 500, 13.9],
    transitionVolume: 5,
  });
  assert.deepEqual(result.transitionZoomHeights.overworld, [1, 320, 30]);
  assert.deepEqual(result.transitionZoomHeights.nether, [20, 40, 60]);
  assert.deepEqual(result.transitionZoomTicks, [1, 200, 13]);
  assert.equal(result.transitionVolume, 1);
  assert.equal(normalizeConfig({ transitionVolume: -3 }).transitionVolume, 0);
});

test("高度表损坏时整组回落默认值", () => {
  assert.deepEqual(
    normalizeConfig({ transitionZoomHeights: { overworld: [20, 40] } })
      .transitionZoomHeights.overworld,
    [20, 40, 60],
  );
  assert.deepEqual(
    normalizeConfig({ transitionZoomHeights: { overworld: [20, NaN, 60] } })
      .transitionZoomHeights.overworld,
    [20, 40, 60],
  );
  assert.deepEqual(
    normalizeConfig({ transitionZoomHeights: "bad" }).transitionZoomHeights
      .overworld,
    [20, 40, 60],
  );
});
