// ─── 死亡点纯逻辑的单元测试 ─────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearDeathPoints,
  getLatestDeathPoint,
  listDeathPoints,
  recordDeathPoint,
  removeDeathPoint,
} from "../scripts/core/deathPoints";
import { createEmptyPlayerData, MAX_DEATH_POINTS } from "../scripts/core/types";

test("记录死亡点会取整坐标", () => {
  const data = createEmptyPlayerData();
  const record = recordDeathPoint(data, { x: 1.9, y: 64.4, z: -3.1 }, "minecraft:overworld", 1000, 0.5);

  assert.deepEqual(record.location, { x: 1, y: 64, z: -4 });
  assert.equal(record.deathTime, 1000);
  assert.equal(data.deathPoints.length, 1);
});

test("超出上限时丢弃最旧的", () => {
  const data = createEmptyPlayerData();
  for (let i = 0; i < MAX_DEATH_POINTS + 3; i += 1) {
    recordDeathPoint(data, { x: i, y: 64, z: 0 }, "minecraft:overworld", 1000 + i, 0.5);
  }

  assert.equal(data.deathPoints.length, MAX_DEATH_POINTS);
  // 最旧的 x=0..2 被丢弃,剩下 x=3 起
  assert.equal(data.deathPoints[0]?.location.x, 3);
});

test("列表最新在前", () => {
  const data = createEmptyPlayerData();
  recordDeathPoint(data, { x: 1, y: 64, z: 0 }, "minecraft:overworld", 1000, 0.5);
  recordDeathPoint(data, { x: 2, y: 64, z: 0 }, "minecraft:overworld", 2000, 0.5);
  recordDeathPoint(data, { x: 3, y: 64, z: 0 }, "minecraft:overworld", 3000, 0.5);

  const list = listDeathPoints(data);
  assert.deepEqual(
    list.map((record) => record.location.x),
    [3, 2, 1],
  );
});

test("列表返回新数组,不影响存档顺序", () => {
  const data = createEmptyPlayerData();
  recordDeathPoint(data, { x: 1, y: 64, z: 0 }, "minecraft:overworld", 1000, 0.5);
  recordDeathPoint(data, { x: 2, y: 64, z: 0 }, "minecraft:overworld", 2000, 0.5);

  listDeathPoints(data);
  assert.equal(data.deathPoints[0]?.location.x, 1);
});

test("最新死亡点是最末尾那条", () => {
  const data = createEmptyPlayerData();
  assert.equal(getLatestDeathPoint(data), undefined);

  recordDeathPoint(data, { x: 1, y: 64, z: 0 }, "minecraft:overworld", 1000, 0.5);
  recordDeathPoint(data, { x: 2, y: 64, z: 0 }, "minecraft:overworld", 2000, 0.5);

  assert.equal(getLatestDeathPoint(data)?.location.x, 2);
});

test("删除不存在的死亡点返回 false", () => {
  const data = createEmptyPlayerData();
  assert.equal(removeDeathPoint(data, "不存在"), false);
});

test("删除指定死亡点", () => {
  const data = createEmptyPlayerData();
  const record = recordDeathPoint(data, { x: 1, y: 64, z: 0 }, "minecraft:overworld", 1000, 0.5);

  assert.equal(removeDeathPoint(data, record.id), true);
  assert.equal(data.deathPoints.length, 0);
});

test("清空返回被清掉的条数", () => {
  const data = createEmptyPlayerData();
  recordDeathPoint(data, { x: 1, y: 64, z: 0 }, "minecraft:overworld", 1000, 0.5);
  recordDeathPoint(data, { x: 2, y: 64, z: 0 }, "minecraft:overworld", 2000, 0.5);

  assert.equal(clearDeathPoints(data), 2);
  assert.equal(data.deathPoints.length, 0);
});
