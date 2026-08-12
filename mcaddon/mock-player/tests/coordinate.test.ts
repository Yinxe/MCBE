// ─── core/coords — 坐标解析与方向向量 ─────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCoordinateInput } from "../scripts/core/coords/Coordinate";
import { rotationToDirection } from "../scripts/core/coords/Direction";

test("parseCoordinateInput：空格分隔的绝对坐标", () => {
  const r = parseCoordinateInput("100 20 30");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pos, { x: 100, y: 20, z: 30 });
});

test("parseCoordinateInput：括号包裹 + 中文逗号混合分隔", () => {
  // 支持半角圆括号/方括号/【】（全角圆括号不在支持列表，见正则）
  const r = parseCoordinateInput("(100，20, 30)");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pos, { x: 100, y: 20, z: 30 });
  const r2 = parseCoordinateInput("【100,20,30】");
  assert.equal(r2.ok, true);
  if (r2.ok) assert.deepEqual(r2.pos, { x: 100, y: 20, z: 30 });
});

test("parseCoordinateInput：全角空格分隔", () => {
  const r = parseCoordinateInput("1\u30002\u30003");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pos, { x: 1, y: 2, z: 3 });
});

test("parseCoordinateInput：相对坐标基于 origin 偏移", () => {
  const origin = { x: 100, y: 64, z: -50 };
  const r = parseCoordinateInput("~ ~5 ~-3", origin);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pos, { x: 100, y: 69, z: -53 });
});

test("parseCoordinateInput：~ 无 origin 时报错", () => {
  const r = parseCoordinateInput("~ 0 0");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid");
});

test("parseCoordinateInput：空输入返回 empty", () => {
  const r = parseCoordinateInput("");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "empty");
});

test("parseCoordinateInput：非 3 个数报错", () => {
  const r = parseCoordinateInput("1 2");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "invalid");
    assert.match(r.message, /需要 3 个数字/);
  }
});

test("parseCoordinateInput：非数字 token 报错", () => {
  const r = parseCoordinateInput("abc 2 3");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "invalid");
});

test("parseCoordinateInput：小数坐标保留小数", () => {
  const r = parseCoordinateInput("1.5 -2.25 3");
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.pos, { x: 1.5, y: -2.25, z: 3 });
});

test("rotationToDirection：朝正南 (yaw=0) 方向为 +Z", () => {
  const d = rotationToDirection({ x: 0, y: 0 });
  assert.ok(Math.abs(d.x) < 1e-9);
  assert.ok(Math.abs(d.z - 1) < 1e-9);
});

test("rotationToDirection：朝正东 (yaw=90) 方向为 -X", () => {
  const d = rotationToDirection({ x: 0, y: 90 });
  assert.ok(Math.abs(d.x + 1) < 1e-9);
  assert.ok(Math.abs(d.z) < 1e-9);
});

test("rotationToDirection：垂直朝下 (pitch=90) 方向为 -Y", () => {
  const d = rotationToDirection({ x: 90, y: 0 });
  assert.ok(Math.abs(d.y + 1) < 1e-9);
});

test("rotationToDirection：方向向量长度恒为 1", () => {
  for (const rot of [{ x: 0, y: 0 }, { x: 45, y: 135 }, { x: -30, y: 200 }]) {
    const d = rotationToDirection(rot);
    const len = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    assert.ok(Math.abs(len - 1) < 1e-6, `len=${len}`);
  }
});