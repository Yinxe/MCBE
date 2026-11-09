// ─── 传送点纯逻辑的单元测试 ─────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectPublicWaypoints,
  createWaypoint,
  editWaypoint,
  findWaypointByName,
  incrementTeleportCount,
  removeWaypoint,
  sortWaypoints,
  togglePin,
  togglePublic,
  updateWaypointLocation,
  type CreateWaypointInput,
} from "../scripts/core/waypoints";
import { createEmptyPlayerData, type PlayerData, type WaypointRecord } from "../scripts/core/types";

/** 构造创建入参。 */
function makeInput(name: string, overrides: Partial<CreateWaypointInput> = {}): CreateWaypointInput {
  return {
    name,
    category: "家",
    note: "",
    location: { x: 10.7, y: 64.2, z: -30.9 },
    dimensionId: "minecraft:overworld",
    ownerId: "player-1",
    ownerName: "小明",
    ...overrides,
  };
}

/** 创建并写入存档,返回新建的记录。每次调用用不同的时钟与随机数,避免 ID 重复。 */
let sequence = 0;
function addWaypoint(data: PlayerData, name: string, overrides: Partial<CreateWaypointInput> = {}): WaypointRecord {
  sequence += 1;
  const result = createWaypoint(data, makeInput(name, overrides), 30, 1000 + sequence, sequence / 100);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("构造失败");
  data.waypoints.push(result.waypoint);
  return result.waypoint;
}

test("创建成功时坐标取整、初始次数为零、默认不置顶不公开", () => {
  const data = createEmptyPlayerData();
  const result = createWaypoint(data, makeInput("家"), 30, 1000, 0.5);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.waypoint.location, { x: 10, y: 64, z: -31 });
  assert.equal(result.waypoint.teleportCount, 0);
  assert.equal(result.waypoint.isPinned, false);
  assert.equal(result.waypoint.isPublic, false);
  assert.equal(result.waypoint.ownerName, "小明");
});

test("数量达到上限时拒绝创建", () => {
  const data = createEmptyPlayerData();
  data.waypoints = [addWaypoint(data, "一"), addWaypoint(data, "二")];

  const result = createWaypoint(data, makeInput("三"), 2, 1000, 0.5);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /上限/);
});

test("同名时拒绝创建", () => {
  const data = createEmptyPlayerData();
  addWaypoint(data, "家");

  const result = createWaypoint(data, makeInput("家"), 30, 1000, 0.5);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /同名/);
});

test("非法分类回落为「其他」", () => {
  const data = createEmptyPlayerData();
  const result = createWaypoint(data, makeInput("x", { category: "随便" as never }), 30, 1000, 0.5);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.waypoint.category, "其他");
});

test("排序:置顶优先,其次传送次数降序", () => {
  const data = createEmptyPlayerData();
  const low = addWaypoint(data, "低");
  const high = addWaypoint(data, "高");
  const pinned = addWaypoint(data, "置顶");

  incrementTeleportCount(data, high.id);
  incrementTeleportCount(data, high.id);
  incrementTeleportCount(data, high.id);
  incrementTeleportCount(data, low.id);
  togglePin(data, pinned.id);

  const sorted = sortWaypoints(data.waypoints);
  assert.deepEqual(
    sorted.map((waypoint) => waypoint.name),
    ["置顶", "高", "低"],
  );
});

test("排序返回新数组,不改动入参顺序", () => {
  const data = createEmptyPlayerData();
  addWaypoint(data, "一");
  addWaypoint(data, "二");
  const before = data.waypoints.map((waypoint) => waypoint.name);

  sortWaypoints(data.waypoints);
  assert.deepEqual(
    data.waypoints.map((waypoint) => waypoint.name),
    before,
  );
});

test("编辑只改传入的字段", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家", { note: "旧备注" });

  editWaypoint(data, waypoint.id, { name: "新家" });

  assert.equal(waypoint.name, "新家");
  assert.equal(waypoint.note, "旧备注");
});

test("编辑时非法分类回落", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家");

  editWaypoint(data, waypoint.id, { category: "不存在" as never });
  assert.equal(waypoint.category, "其他");
});

test("更新坐标会同时更新维度", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家");

  updateWaypointLocation(data, waypoint.id, { x: 1.9, y: 2.1, z: 3.5 }, "minecraft:nether");

  assert.deepEqual(waypoint.location, { x: 1, y: 2, z: 3 });
  assert.equal(waypoint.dimensionId, "minecraft:nether");
});

test("删除不存在的传送点返回 false", () => {
  const data = createEmptyPlayerData();
  assert.equal(removeWaypoint(data, "不存在"), false);
});

test("按名称查找", () => {
  const data = createEmptyPlayerData();
  addWaypoint(data, "家");
  assert.equal(findWaypointByName(data, "家")?.name, "家");
  assert.equal(findWaypointByName(data, "没有"), undefined);
});

test("公共功能关闭时翻转被拒绝", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家");

  assert.equal(togglePublic(data, waypoint.id, false), "denied");
  assert.equal(waypoint.isPublic, false);
});

test("公共功能开启时翻转生效", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家");

  assert.equal(togglePublic(data, waypoint.id, true), true);
  assert.equal(waypoint.isPublic, true);
  assert.equal(togglePublic(data, waypoint.id, true), false);
});

test("汇总公共传送点:只收公开的,按次数降序", () => {
  const dataA = createEmptyPlayerData();
  const dataB = createEmptyPlayerData();
  const a1 = addWaypoint(dataA, "甲的公开点");
  const a2 = addWaypoint(dataA, "甲的私有点");
  const b1 = addWaypoint(dataB, "乙的公开点");

  togglePublic(dataA, a1.id, true);
  togglePublic(dataB, b1.id, true);
  incrementTeleportCount(dataA, a1.id);
  incrementTeleportCount(dataB, b1.id);
  incrementTeleportCount(dataB, b1.id);
  assert.equal(a2.isPublic, false);

  const collected = collectPublicWaypoints([dataA, dataB], true);
  assert.deepEqual(
    collected.map((waypoint) => waypoint.name),
    ["乙的公开点", "甲的公开点"],
  );
});

test("公共功能关闭时汇总结果为空", () => {
  const data = createEmptyPlayerData();
  const waypoint = addWaypoint(data, "家");
  togglePublic(data, waypoint.id, true);

  assert.deepEqual(collectPublicWaypoints([data], false), []);
});
