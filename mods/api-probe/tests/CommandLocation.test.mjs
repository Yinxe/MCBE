// ─── CommandLocation 单测:命令坐标取整 ───────────────────────────
//
// 命令 `Location` 参数不保证整数,所以取整规则必须钉死:
//   · 方块 n 占据 [n, n+1) 区间,因此 5.9 属于方块 5
//   · 负坐标必须用 floor 而不是 trunc(-0.1 属于方块 -1,不是 0)

import assert from "node:assert/strict";
import { test } from "node:test";
import { toBlockCoordinate } from "../lib/scripts/CommandLocation.js";

test("整数坐标原样保留", () => {
  assert.deepEqual(toBlockCoordinate({ x: 100, y: 64, z: -20 }), { x: 100, y: 64, z: -20 });
});

test("正小数向下取整", () => {
  // 5.9 落在方块 5 的 [5, 6) 区间内
  assert.deepEqual(toBlockCoordinate({ x: 5.9, y: 64.2, z: 20.99 }), { x: 5, y: 64, z: 20 });
});

test("负小数向下取整而不是向零截断", () => {
  // -0.1 属于方块 -1;Math.trunc 会错误地给出 0
  assert.deepEqual(toBlockCoordinate({ x: -0.1, y: -1.5, z: -20.9 }), { x: -1, y: -2, z: -21 });
});

test("零与负零在数值上都是 0", () => {
  // Math.floor(-0) 返回 -0。它在任何坐标运算里都等于 0(`-0 === 0` 为 true),
  // 但 assert.equal/deepEqual 走 Object.is,会把 -0 与 0 判为不等。
  // 这里用 `===` 按数值语义比较,顺便把这条差异写进注释备查。
  const result = toBlockCoordinate({ x: 0, y: -0, z: 0 });
  assert.ok(result.x === 0, "x 应为 0");
  assert.ok(result.y === 0, "y 应为 0(-0 在数值上等于 0)");
  assert.ok(result.z === 0, "z 应为 0");
});

test("相对坐标被解析成绝对值后再取整(模拟 ~ 输入)", () => {
  // 玩家输入 `~ ~ ~` 时引擎已算成绝对坐标,这里只验证取整不受影响
  assert.deepEqual(toBlockCoordinate({ x: 10.5 + 0.4, y: 64 - 0.5, z: -3 + 0.2 }), { x: 10, y: 63, z: -3 });
});
