// ─── core/rules/pickup — 拾取目标掉落物计划（PickupPlan） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { planPickup, type PickupItem } from "../scripts/rules/pickup/PickupPlan";
import type { Vec3 } from "../scripts/rules/Types";

const RANGE_MIN: Vec3 = { x: 0, y: 60, z: 0 };
const RANGE_MAX: Vec3 = { x: 10, y: 70, z: 10 };

function item(x: number, y: number, z: number, typeId = "minecraft:oak_log"): PickupItem {
  return { loc: { x, y, z }, typeId };
}

test("planPickup：范围过滤 + typeId 白名单 + 就近排序", () => {
  const items = [
    item(5, 64, 5, "minecraft:oak_log"), // 范围外? 范围内
    item(20, 64, 5, "minecraft:oak_log"), // 超出范围 → 排除
    item(8, 64, 5, "minecraft:apple"), // 白名单外 → 排除
    item(2, 64, 2, "minecraft:oak_log"),
  ];
  const plan = planPickup(items, {
    rangeMin: RANGE_MIN,
    rangeMax: RANGE_MAX,
    includeTypes: ["minecraft:oak_log", "minecraft:spruce_log"],
    origin: { x: 0, y: 64, z: 0 },
  });
  // 只留 oak_log 且范围内：5,64,5 与 2,64,2 → 就近排序先取 2,64,2
  assert.deepEqual(
    plan.targets.map((t) => `${t.loc.x},${t.loc.y},${t.loc.z}`),
    ["2,64,2", "5,64,5"],
  );
  assert.deepEqual(plan.cleanups, []);
});

test("planPickup：不传 includeTypes = 全拾取", () => {
  const plan = planPickup(
    [item(5, 64, 5, "minecraft:apple"), item(6, 64, 5, "minecraft:stick")],
    { rangeMin: RANGE_MIN, rangeMax: RANGE_MAX },
  );
  assert.equal(plan.targets.length, 2);
});

test("planPickup：卡落清理——掉落物正下方是树叶 → 加清理目标（去重）", () => {
  const isLeaf = (loc: Vec3) => loc.y === 63; // 假设 y=63 全是树叶/遮挡层
  // 两个掉落物叠在同一片树叶上 → 清理去重为 1 片
  const items = [item(5, 64, 5), item(6, 64, 5)];
  const plan = planPickup(items, { rangeMin: RANGE_MIN, rangeMax: RANGE_MAX, isBlockingBelow: isLeaf });
  assert.equal(plan.targets.length, 2);
  assert.deepEqual(
    plan.cleanups.map((c) => `${c.x},${c.y},${c.z}`).sort(),
    ["5,63,5", "6,63,5"].sort(),
  );
});

test("planPickup：下方无遮挡 → 无清理", () => {
  const plan = planPickup([item(5, 64, 5)], {
    rangeMin: RANGE_MIN,
    rangeMax: RANGE_MAX,
    isBlockingBelow: () => false,
  });
  assert.equal(plan.cleanups.length, 0);
});
