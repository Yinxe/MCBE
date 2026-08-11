import test from "node:test";
import assert from "node:assert/strict";
import { isWithinRange } from "../src/display/range";

function playerAt(x: number, y: number, z: number, dim = "overworld") {
  return { location: { x, y, z }, dimension: { id: dim } };
}

const CENTER = { x: 0, y: 0, z: 0, dimensionId: "overworld" };

test("isWithinRange：范围内 true / 范围外 false（含边界）", () => {
  assert.equal(isWithinRange(playerAt(0, 0, 0), CENTER, 10), true);
  assert.equal(isWithinRange(playerAt(10, 0, 0), CENTER, 10), true); // 边界（≤）
  assert.equal(isWithinRange(playerAt(10.1, 0, 0), CENTER, 10), false);
  assert.equal(isWithinRange(playerAt(0, 0, 12), CENTER, 10), false);
});

test("isWithinRange：跨维度一律视为不在范围", () => {
  assert.equal(isWithinRange(playerAt(0, 0, 0, "nether"), CENTER, 100000), false);
});

test("isWithinRange：三维都需在半径内（Y 轴外）", () => {
  assert.equal(isWithinRange(playerAt(0, 11, 0), CENTER, 10), false);
  assert.equal(isWithinRange(playerAt(0, -10, 0), CENTER, 10), true);
  assert.equal(isWithinRange(playerAt(5, 5, 8), CENTER, 10), false); // 625 > 100
});