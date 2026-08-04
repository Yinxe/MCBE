import { test } from "node:test";
import assert from "node:assert/strict";
import { containsLocation, isPlayerNearby } from "../scripts/core/model/Area";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";

const area: WarehouseArea = {
  dimension: "overworld",
  corner1: { x: 0, y: 0, z: 0 },
  corner2: { x: 10, y: 10, z: 10 },
};

test("containsLocation: 区域内/外/边界", () => {
  assert.equal(containsLocation(area, "overworld", { x: 5, y: 5, z: 5 }), true);
  assert.equal(containsLocation(area, "overworld", { x: 0, y: 0, z: 0 }), true); // 边界含
  assert.equal(containsLocation(area, "overworld", { x: 11, y: 5, z: 5 }), false);
  assert.equal(containsLocation(area, "overworld", { x: 5, y: 11, z: 5 }), false);
});

test("containsLocation: 维度不匹配返回 false", () => {
  assert.equal(containsLocation(area, "nether", { x: 5, y: 5, z: 5 }), false);
});

test("containsLocation: 角点乱序仍正确", () => {
  const flipped: WarehouseArea = { dimension: "overworld", corner1: { x: 10, y: 10, z: 10 }, corner2: { x: 0, y: 0, z: 0 } };
  assert.equal(containsLocation(flipped, "overworld", { x: 5, y: 5, z: 5 }), true);
});

test("isPlayerNearby: XZ 距离判定 + 维度过滤", () => {
  const players = [
    { dimension: "overworld", x: 5, z: 5 },   // 中心附近
    { dimension: "nether", x: 5, z: 5 },      // 维度不符
    { dimension: "overworld", x: 100, z: 100 }, // 太远
  ];
  assert.equal(isPlayerNearby(area, players, 16), true);
  assert.equal(isPlayerNearby(area, [players[1]!, players[2]!], 16), false);
  assert.equal(isPlayerNearby(area, [players[2]!], 16), false);
});