// ─── DebugProbeShared 单测:报告格式与站位排布 ─────────────────────
//
// 这一层不 import 任何 @minecraft/* 运行时代码(只有 type import,编译后擦除),
// 因此可以直接在 node 里跑。
//
// 重点验证三件事:
//   1. 数字格式化:整数原样、小数三位,不出现 "1.000"
//   2. 向量与颜色的格式化走同一条路,不会打出 JSON
//   3. 站位排布:整排以视线正前方为中心,间距准确,且视线朝任意方向都对

import assert from "node:assert/strict";
import { test } from "node:test";
import { formatValue, kv, rowPositions } from "../lib/scripts/DebugProbeShared.js";

test("整数原样输出,不加小数点", () => {
  assert.equal(formatValue(5), "5");
  assert.equal(formatValue(0), "0");
  assert.equal(formatValue(-3), "-3");
});

test("小数保留三位", () => {
  assert.equal(formatValue(0.5), "0.500");
  assert.equal(formatValue(1 / 3), "0.333");
  assert.equal(formatValue(-0.25), "-0.250");
});

test("布尔与空值有可读形式", () => {
  assert.equal(formatValue(true), "true");
  assert.equal(formatValue(false), "false");
  assert.match(formatValue(undefined), /undefined/);
  assert.match(formatValue(null), /null/);
});

test("向量格式化成 (x, y, z)", () => {
  assert.equal(formatValue({ x: 1, y: 2.5, z: -3 }), "(1, 2.500, -3)");
});

test("颜色格式化成 rgb(...)", () => {
  assert.equal(formatValue({ red: 1, green: 0.2, blue: 0 }), "rgb(1, 0.200, 0)");
});

test("键值行带标签与值", () => {
  const line = kv("scale", 2);
  assert.match(line, /scale/);
  assert.match(line, /2/);
});

test("站位整排以正前方为中心", () => {
  // 玩家在原点朝 +z 看,排 3 个、间距 2,则 lateral 应为 -2 / 0 / +2
  const player = {
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
    getHeadLocation: () => ({ x: 0, y: 10, z: 0 }),
  };
  const positions = rowPositions(player, 3, 2, 4, 1);

  assert.equal(positions.length, 3);
  // 正前方 4 格、抬高 1 格
  assert.equal(positions[1].x, 0);
  assert.equal(positions[1].y, 11);
  assert.equal(positions[1].z, 4);
  // 左右各偏 2 格:朝 +z 看时右手方向是 -x
  assert.equal(positions[0].x, 2);
  assert.equal(positions[2].x, -2);
  // 三者的前进方向距离一致
  for (const position of positions) {
    assert.equal(position.z, 4);
  }
});

test("单个元素时落在正中,不受间距影响", () => {
  const player = {
    getViewDirection: () => ({ x: 0, y: 0, z: 1 }),
    getHeadLocation: () => ({ x: 0, y: 0, z: 0 }),
  };
  const positions = rowPositions(player, 1, 5, 4, 0);
  assert.equal(positions.length, 1);
  assert.deepEqual(positions[0], { x: 0, y: 0, z: 4 });
});

test("视线俯仰不影响水平前进距离", () => {
  // 朝斜下方看 45°,水平分量仍应归一化,前进 4 格后水平距离就是 4
  const player = {
    getViewDirection: () => ({ x: 0, y: -1, z: 1 }),
    getHeadLocation: () => ({ x: 0, y: 10, z: 0 }),
  };
  const [position] = rowPositions(player, 1, 0, 4, 1);
  assert.ok(Math.abs(position.z - 4) < 1e-9, `水平前进距离应为 4,实际 ${position.z}`);
  // 抬高量固定,不跟着俯仰走
  assert.equal(position.y, 11);
});

test("视线朝 -x 时右手方向是 -z", () => {
  const player = {
    getViewDirection: () => ({ x: -1, y: 0, z: 0 }),
    getHeadLocation: () => ({ x: 0, y: 0, z: 0 }),
  };
  const positions = rowPositions(player, 3, 2, 4, 0);
  // 前进沿 -x
  for (const position of positions) {
    assert.equal(position.x, -4);
  }
  // 朝西看时右手是北,即 -z;第一个元素在左手侧
  assert.equal(positions[0].z, 2);
  assert.equal(positions[2].z, -2);
});
