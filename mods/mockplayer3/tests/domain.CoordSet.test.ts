// ─── 坐标数字编码单测：13 位段宽内负坐标/零 y 往返一致 ──
// 回归：旧 12 位段宽在 y≥0 溢出进位、解码全错。
import test from "node:test";
import assert from "node:assert/strict";

import { coordKey, keyToCoord } from "../scripts/domain/CoordSet";

const v = (x: number, y: number, z: number) => ({ x, y, z });

test("coordKey：编码范围内负坐标/零 y 往返一致", () => {
  for (const p of [v(-4096, -64, -4096), v(30, 64, -100), v(0, 0, 0), v(-1, -1, -1), v(100, 319, 200)]) {
    assert.deepEqual(keyToCoord(coordKey(p.x, p.y, p.z)), p);
  }
  assert.notEqual(coordKey(1, 0, 0), coordKey(0, 1, 0)); // 旧 12 位 bug 形态：x 位与 y=0 重叠
});
