import { test } from "node:test";
import assert from "node:assert/strict";
import { containerIdOf, primaryLocationOf, parseContainerId, containerIdPointsTo } from "../scripts/core/model/ContainerId";

test("containerIdOf: 生成 c@x,y,z", () => {
  assert.equal(containerIdOf({ x: 10, y: 64, z: 3 }), "c@10,64,3");
});

test("primaryLocationOf: 双箱取 (x,y,z) 最小者（与创建顺序无关）", () => {
  const a = { x: 10, y: 64, z: 3 };
  const b = { x: 11, y: 64, z: 3 };
  assert.deepEqual(primaryLocationOf([a, b]), a);
  assert.deepEqual(primaryLocationOf([b, a]), a); // 顺序无关
  // z 轴相邻：取 z 小者
  assert.deepEqual(primaryLocationOf([{ x: 5, y: 64, z: 9 }, { x: 5, y: 64, z: 8 }]), { x: 5, y: 64, z: 8 });
  // 空列表
  assert.equal(primaryLocationOf([]), undefined);
});

test("parseContainerId / containerIdPointsTo: 解析与指向判定", () => {
  assert.deepEqual(parseContainerId("c@10,64,3"), { x: 10, y: 64, z: 3 });
  assert.equal(parseContainerId("bad-id"), undefined);
  assert.equal(containerIdPointsTo("c@10,64,3", { x: 10, y: 64, z: 3 }), true);
  assert.equal(containerIdPointsTo("c@10,64,3", { x: 11, y: 64, z: 3 }), false);
});

test("containerIdOf/primaryLocationOf: 拆主半后重定到幸存半", () => {
  // 双箱 [10,64,3] + [11,64,3] → 主坐标 10 → id c@10,64,3
  const both = [{ x: 10, y: 64, z: 3 }, { x: 11, y: 64, z: 3 }];
  const primary = primaryLocationOf(both)!;
  assert.equal(containerIdOf(primary), "c@10,64,3");
  // 拆掉主半 [10] 后，幸存 [11] 成为新主 → id 应重定为 c@11,64,3
  const survivor = primaryLocationOf([{ x: 11, y: 64, z: 3 }])!;
  assert.equal(containerIdOf(survivor), "c@11,64,3");
});