// ─── core/rules/resource — 统一资源池模型（ResourcePool） ──
// 泛型核心的状态机与策略插件行为：以假想资源验证统一语义，
// 钓鱼/树的领域行为已由 fishing-pool.test.ts / tree-pool.test.ts 覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimEntry,
  countUsable,
  dist3dSq,
  horizontalDistSq,
  isUsableFor,
  markFail,
  mergeEntries,
  passesPickConstraints,
  pickBest,
  releaseEntry,
  removeEntry,
  resetFail,
  type PoolEntry,
  type PoolPolicy,
} from "../scripts/rules/resource/ResourcePool";
import type { Vec3 } from "../scripts/rules/Types";

/** 测试资源条目：带坐标与失败计数 */
interface FakeResource extends PoolEntry {
  readonly id: string;
  /** 条目中心（策略 centerOf 的数据来源） */
  readonly pos: Vec3;
  failCount: number;
}

/** 构造条目（默认 free、原点中心） */
function makeEntry(id: string, pos: Vec3 = { x: 0, y: 0, z: 0 }, overrides: Partial<FakeResource> = {}): FakeResource {
  return { id, pos, status: "free", failCount: 0, ...overrides };
}

/** 就近优先策略（3D 距离；连续失败 2 次标记不可用——验证可配置上限） */
const NEAREST_POLICY: PoolPolicy<FakeResource> = {
  keyOf: (e) => e.id,
  centerOf: (e) => e.pos,
  distance: dist3dSq,
  maxDistance: 16,
  compare: (a, b, botPos) => dist3dSq(a.pos, botPos) - dist3dSq(b.pos, botPos),
  maxFailStrikes: 2,
};

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

test("状态机：claim 独占 → 他人不可用/本人可用 → release 回 free", () => {
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, NEAREST_POLICY, "r1", "botA");
  assert.equal(pool[0]?.status, "occupied");
  assert.equal(pool[0]?.claimant, "botA");
  assert.equal(isUsableFor(pool[0]!, "botB", NEAREST_POLICY), false, "他人不可用（防抢）");
  assert.equal(isUsableFor(pool[0]!, "botA", NEAREST_POLICY), true, "占用者本人可用");
  pool = releaseEntry(pool, NEAREST_POLICY, "r1");
  assert.equal(pool[0]?.status, "free");
  assert.equal(pool[0]?.claimant, undefined);
  assert.equal(isUsableFor(pool[0]!, "botB", NEAREST_POLICY), true);
});

test("失败标记：连续失败达上限 → unavailable 且释放后不复活", () => {
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, NEAREST_POLICY, "r1", "botA");
  const first = markFail(pool, NEAREST_POLICY, "r1");
  assert.equal(first.failCount, 1);
  assert.equal(first.unavailable, false);
  assert.equal(first.pool[0]?.status, "occupied", "未达上限保持占用");
  const second = markFail(first.pool, NEAREST_POLICY, "r1");
  assert.equal(second.unavailable, true);
  assert.equal(second.pool[0]?.status, "unavailable");
  const released = releaseEntry(second.pool, NEAREST_POLICY, "r1");
  assert.equal(released[0]?.status, "unavailable", "不可用资源不复活");
  assert.equal(isUsableFor(released[0]!, "botB", NEAREST_POLICY), false);
});

test("成功清零：resetFail 后释放回 free", () => {
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, NEAREST_POLICY, "r1", "botA");
  pool = markFail(pool, NEAREST_POLICY, "r1").pool;
  pool = resetFail(pool, NEAREST_POLICY, "r1");
  assert.equal(pool[0]?.failCount, 0);
  pool = releaseEntry(pool, NEAREST_POLICY, "r1");
  assert.equal(pool[0]?.status, "free", "计数清零后释放不标记不可用");
});

test("无失败标记策略（maxFailStrikes=0）：markFail 不改状态、释放恒回 free", () => {
  const NO_FAIL_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, maxFailStrikes: 0 };
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, NO_FAIL_POLICY, "r1", "botA");
  const failed = markFail(pool, NO_FAIL_POLICY, "r1");
  assert.equal(failed.unavailable, false, "不支持失败标记的资源不进入 unavailable");
  assert.equal(failed.pool[0]?.status, "occupied", "状态保持占用");
  const released = releaseEntry(pool, NO_FAIL_POLICY, "r1");
  assert.equal(released[0]?.status, "free");
});

test("选择约束：距离过滤 + 现场有效性回调", () => {
  // a 在 x=1（近），b 在 x=5（远）
  const pool = [makeEntry("a", { x: 1, y: 0, z: 0 }), makeEntry("b", { x: 5, y: 0, z: 0 })];
  const near = passesPickConstraints(pool[0]!, NEAREST_POLICY, { center: ORIGIN, maxDistance: 2 });
  const far = passesPickConstraints(pool[1]!, NEAREST_POLICY, { center: ORIGIN, maxDistance: 2 });
  assert.equal(near, true);
  assert.equal(far, false, "超出 maxDistance 的资源被过滤");
  const withValid = passesPickConstraints(pool[0]!, NEAREST_POLICY, { center: ORIGIN, isValid: () => false });
  assert.equal(withValid, false, "现场有效性回调 false → 不可用");
});

test("pickBest：按策略比较器取最优（近的优先）且只从可用集合中选", () => {
  let pool = [makeEntry("a", { x: 1, y: 0, z: 0 }), makeEntry("b", { x: 5, y: 0, z: 0 })];
  assert.equal(pickBest(pool, "botA", NEAREST_POLICY, ORIGIN)?.id, "a", "近者优先");
  pool = claimEntry(pool, NEAREST_POLICY, "a", "botB");
  assert.equal(pickBest(pool, "botA", NEAREST_POLICY, ORIGIN)?.id, "b", "被他人认领的排除");
  assert.equal(countUsable(pool, "botA", NEAREST_POLICY), 1);
});

test("mergeEntries：同 key 保留已有状态/计数，新条目并入", () => {
  let pool = [makeEntry("r1", undefined, { status: "occupied", claimant: "botA", failCount: 2 })];
  pool = mergeEntries(pool, NEAREST_POLICY, [makeEntry("r1"), makeEntry("r2")]);
  assert.equal(pool.length, 2);
  assert.equal(pool[0]?.status, "occupied", "已有条目状态不被扫描覆盖");
  assert.equal(pool[0]?.failCount, 2, "失败计数不被覆盖");
  assert.equal(pool[1]?.status, "free", "新条目按 free 入池");
});

test("removeEntry：完成/永久放弃后从池删除", () => {
  let pool = [makeEntry("r1"), makeEntry("r2")];
  pool = removeEntry(pool, NEAREST_POLICY, "r1");
  assert.equal(pool.length, 1);
  assert.equal(pool[0]?.id, "r2");
});

test("内置距离度量：水平忽略 Y，3D 计入 Y", () => {
  const a: Vec3 = { x: 0, y: 0, z: 0 };
  const b: Vec3 = { x: 3, y: 4, z: 0 };
  assert.equal(horizontalDistSq(a, b), 9, "水平距离不含 y");
  assert.equal(dist3dSq(a, b), 25, "3D 距离含 y");
});
