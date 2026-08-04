import { test } from "node:test";
import assert from "node:assert/strict";
import { findChestPartner, type BlockInfo } from "../scripts/core/model/ChestMerge";

const primary: BlockInfo = { typeId: "minecraft:chest", x: 10, y: 64, z: 10 };

test("findChestPartner: 相邻同类型箱子 → 找到伙伴", () => {
  const partner: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 10 };
  assert.deepEqual(findChestPartner(primary, [partner]), partner);
});

test("findChestPartner: 非箱子类型 → undefined", () => {
  const barrel: BlockInfo = { typeId: "minecraft:barrel", x: 11, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [barrel]), undefined);
});

test("findChestPartner: 不同类型箱子不合并（chest vs trapped_chest）", () => {
  const trapped: BlockInfo = { typeId: "minecraft:trapped_chest", x: 11, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [trapped]), undefined);
});

test("findChestPartner: 不相邻（对角/隔一格）→ undefined", () => {
  const diagonal: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 11 };
  const far: BlockInfo = { typeId: "minecraft:chest", x: 12, y: 64, z: 10 };
  assert.equal(findChestPartner(primary, [diagonal]), undefined);
  assert.equal(findChestPartner(primary, [far]), undefined);
});

test("findChestPartner: 上下相邻不合并（双箱仅水平）", () => {
  const above: BlockInfo = { typeId: "minecraft:chest", x: 10, y: 65, z: 10 };
  assert.equal(findChestPartner(primary, [above]), undefined);
});

test("findChestPartner: 多邻居中取第一个匹配", () => {
  const a: BlockInfo = { typeId: "minecraft:barrel", x: 9, y: 64, z: 10 };
  const b: BlockInfo = { typeId: "minecraft:chest", x: 11, y: 64, z: 10 };
  assert.deepEqual(findChestPartner(primary, [a, b]), b);
});