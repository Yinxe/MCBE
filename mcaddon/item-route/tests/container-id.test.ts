import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containerIdOf,
  primaryLocationOf,
  parseContainerId,
  containerIdPointsTo,
  warehouseIdOf,
  containerShortName,
  dimensionShort,
} from "../scripts/core/model/ContainerId";

const DIM = "overworld";

test("containerIdOf: 生成 c@x,y,z@维度", () => {
  assert.equal(containerIdOf({ x: 10, y: 64, z: 3 }, DIM), "c@(10,64,3)@overworld");
});

test("containerIdOf: 维度全名截成短名（minecraft:overworld → overworld），全名与原 ID 区分维度一致", () => {
  assert.equal(dimensionShort("minecraft:overworld"), "overworld");
  assert.equal(dimensionShort("minecraft:nether"), "nether");
  assert.equal(dimensionShort("minecraft:the_end"), "the_end");
  assert.equal(dimensionShort("overworld"), "overworld"); // 已短名不重复截
  // 传入全名 → ID 存短名；比较用全名也匹配
  assert.equal(containerIdOf({ x: 1, y: 2, z: 3 }, "minecraft:overworld"), "c@(1,2,3)@overworld");
  assert.equal(containerIdPointsTo("c@(1,2,3)@overworld", { x: 1, y: 2, z: 3 }, "minecraft:overworld"), true);
  assert.equal(containerShortName("c@(10,64,3)@overworld"), "(10,64,3)@overworld");
});

test("primaryLocationOf: 双箱取 (x,y,z) 最小者（与创建顺序无关）", () => {
  const a = { x: 10, y: 64, z: 3 };
  const b = { x: 11, y: 64, z: 3 };
  assert.deepEqual(primaryLocationOf([a, b]), a);
  assert.deepEqual(primaryLocationOf([b, a]), a); // 顺序无关
  // z 轴相邻：取 z 小者
  assert.deepEqual(
    primaryLocationOf([
      { x: 5, y: 64, z: 9 },
      { x: 5, y: 64, z: 8 },
    ]),
    { x: 5, y: 64, z: 8 }
  );
  assert.equal(primaryLocationOf([]), undefined);
});

test("parseContainerId / containerIdPointsTo: 解析与指向判定（含维度）", () => {
  assert.deepEqual(parseContainerId("c@(10,64,3)@overworld"), { loc: { x: 10, y: 64, z: 3 }, dimension: "overworld" });
  assert.equal(parseContainerId("bad-id"), undefined);
  assert.equal(containerIdPointsTo("c@(10,64,3)@overworld", { x: 10, y: 64, z: 3 }, "overworld"), true);
  assert.equal(containerIdPointsTo("c@(10,64,3)@overworld", { x: 11, y: 64, z: 3 }, "overworld"), false);
  // 维度不匹配 → 不指向（跨维不重叠的核心保证）
  assert.equal(containerIdPointsTo("c@(10,64,3)@overworld", { x: 10, y: 64, z: 3 }, "nether"), false);
});

test("containerId 跨维度不冲突：同坐标不同维度 ID 不同", () => {
  assert.notEqual(containerIdOf({ x: 10, y: 64, z: 3 }, "overworld"), containerIdOf({ x: 10, y: 64, z: 3 }, "nether"));
});

test("containerIdOf/primaryLocationOf: 拆主半后重定到幸存半（同维度）", () => {
  const both = [
    { x: 10, y: 64, z: 3 },
    { x: 11, y: 64, z: 3 },
  ];
  assert.equal(containerIdOf(primaryLocationOf(both)!, DIM), "c@(10,64,3)@overworld");
  const survivor = primaryLocationOf([{ x: 11, y: 64, z: 3 }])!;
  assert.equal(containerIdOf(survivor, DIM), "c@(11,64,3)@overworld");
});

test("warehouseIdOf: 由归一化区域生成稳定 ID（角点乱序纠正 + 维度）", () => {
  const a = { dimension: "overworld", corner1: { x: 10, y: 70, z: 10 }, corner2: { x: 0, y: 64, z: 0 } };
  assert.equal(warehouseIdOf(a), "w@(0,64,0)-(10,70,10)@overworld");
  // 交换 corner 顺序 → 同一 ID（稳定）
  const b = { dimension: "overworld", corner1: { x: 0, y: 64, z: 0 }, corner2: { x: 10, y: 70, z: 10 } };
  assert.equal(warehouseIdOf(b), warehouseIdOf(a));
});
