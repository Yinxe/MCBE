import test from "node:test";
import assert from "node:assert/strict";
import { createRegionMeta, normalizeMeta } from "../src/core/meta";

test("createRegionMeta：v3 空元数据（仅 barrelCount）", () => {
  assert.deepEqual(createRegionMeta(), { v: 3, barrelCount: 0 });
});

test("normalizeMeta：v3 合法 → 原样归一", () => {
  assert.deepEqual(normalizeMeta({ v: 3, barrelCount: 5 }), { v: 3, barrelCount: 5 });
  assert.deepEqual(normalizeMeta({ v: 3, barrelCount: 0 }), { v: 3, barrelCount: 0 });
});

test("normalizeMeta：v2 旧记录（洞池时代）→ 迁移为 v3，洞信息丢弃", () => {
  // 旧记录 meta：nextFree/holeLevels/holeCount 全部丢弃，只保留 barrelCount
  assert.deepEqual(normalizeMeta({ v: 2, nextFree: 100, holeLevels: [0, 2], holeCount: 34, barrelCount: 7 }), {
    v: 3,
    barrelCount: 7,
  });
  // barrelCount 缺失/损坏 → 兜底 0
  assert.deepEqual(normalizeMeta({ v: 2, nextFree: 0, holeLevels: [], holeCount: 0 }), { v: 3, barrelCount: 0 });
  assert.deepEqual(normalizeMeta({ v: 2, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: -3 }), {
    v: 3,
    barrelCount: 0,
  });
});

test("normalizeMeta：非法/未知版本 → undefined", () => {
  assert.equal(normalizeMeta(undefined), undefined);
  assert.equal(normalizeMeta(null), undefined);
  assert.equal(normalizeMeta("x"), undefined);
  assert.equal(normalizeMeta({}), undefined);
  assert.equal(normalizeMeta({ v: 1, barrelCount: 0 }), undefined);
  assert.equal(normalizeMeta({ v: 4, barrelCount: 0 }), undefined);
  assert.equal(normalizeMeta({ v: 3, barrelCount: -1 }), undefined);
  assert.equal(normalizeMeta({ v: 3, barrelCount: 1.5 }), undefined);
});