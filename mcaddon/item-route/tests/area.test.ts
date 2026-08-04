import { test } from "node:test";
import assert from "node:assert/strict";
import { containsLocation, isPlayerNearby, findWarehouseAt, findContainerAt } from "../scripts/core/model/Area";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";
import type { Warehouse } from "../scripts/core/model/Warehouse";
import type { Container } from "../scripts/core/model/Container";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

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

// ── Task 14: findWarehouseAt / findContainerAt ─────────────

const area2 = { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } };

function makeWarehouse(containers: Container[]): Warehouse {
  return {
    id: "w1",
    displayName: "测试仓",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" as const }],
    area: area2,
    settings: createDefaultSettings(),
    containers: new Map(containers.map((c) => [c.id, c])),
  };
}

const chest: Container = {
  id: "c1", role: "single", enabled: true, priority: 10,
  capacity: 27, emptySlotsCount: 27, usedSlots: 0,
  occupiedLocations: [{ x: 5, y: 5, z: 5 }],
  getItem: () => undefined, setItem: () => undefined, addItem: (s) => s, getDedicatedItemId: () => undefined,
};

test("findWarehouseAt: 区域内命中 / 区域外 undefined / 维度不匹配 undefined", () => {
  const ws = [makeWarehouse([chest])];
  assert.equal(findWarehouseAt(ws, "overworld", { x: 5, y: 5, z: 5 })?.id, "w1");
  assert.equal(findWarehouseAt(ws, "overworld", { x: 99, y: 5, z: 5 }), undefined);
  assert.equal(findWarehouseAt(ws, "nether", { x: 5, y: 5, z: 5 }), undefined);
});

test("findContainerAt: 容器坐标命中 / 未注册坐标 undefined", () => {
  const ws = [makeWarehouse([chest])];
  assert.equal(findContainerAt(ws, "overworld", { x: 5, y: 5, z: 5 })?.container.id, "c1");
  assert.equal(findContainerAt(ws, "overworld", { x: 6, y: 5, z: 5 }), undefined);
});