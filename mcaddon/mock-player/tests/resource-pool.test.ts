// ─── core/rules/resource — 统一资源池模型（ResourcePool） ──
// 泛型核心的状态机与策略插件行为：以假想资源验证统一语义，
// 钓鱼/树的领域行为已由 fishing-pool.test.ts / tree-pool.test.ts 覆盖。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimEntry,
  countUsable,
  dist3dSq,
  exhaustEntry,
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

test("认领租约：过期后他人视为已释放；持有者本人不受租期影响", () => {
  const LEASE_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, claimLeaseTicks: 100 };
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, LEASE_POLICY, "r1", "botA", 1000);
  assert.equal(pool[0]?.claimedAt, 1000);
  // 租约内：他人不可用
  assert.equal(isUsableFor(pool[0]!, "botB", LEASE_POLICY, { nowTick: 1050 }), false);
  // 租约过期（1000+100<=1100）：他人视为已释放
  assert.equal(isUsableFor(pool[0]!, "botB", LEASE_POLICY, { nowTick: 1100 }), true, "租约过期→他人可抢占");
  // 持有者本人读自己：恒可用（不受租期影响）
  assert.equal(isUsableFor(pool[0]!, "botA", LEASE_POLICY, { nowTick: 99999 }), true);
  // 不传 nowTick = 旧行为（认领恒活）
  assert.equal(isUsableFor(pool[0]!, "botB", LEASE_POLICY), false);
});

test("持有者活性：任务已不在跑 → 认领视为已释放（崩溃兜底）", () => {
  const LEASE_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, claimLeaseTicks: 3600 };
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, LEASE_POLICY, "r1", "botA", 1000);
  const dead = { nowTick: 1100, holderActive: (_name: string) => false };
  assert.equal(isUsableFor(pool[0]!, "botB", LEASE_POLICY, dead), true, "持有者已死→他人可用");
  const alive = { nowTick: 1100, holderActive: (name: string) => name === "botA" };
  assert.equal(isUsableFor(pool[0]!, "botB", LEASE_POLICY, alive), false, "持有者还活着→他人不可用");
  assert.equal(isUsableFor(pool[0]!, "botA", LEASE_POLICY, alive), true, "本人恒可用");
});

test("墓碑复活：unavailable 复活期后惰性复活为 free", () => {
  const TOMB_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, unavailableTtlTicks: 1000 };
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, TOMB_POLICY, "r1", "botA");
  pool = markFail(pool, TOMB_POLICY, "r1", 500).pool;
  const second = markFail(pool, TOMB_POLICY, "r1", 500);
  assert.equal(second.unavailable, true);
  assert.equal(second.pool[0]?.unavailableAt, 500);
  // 复活期未过：不可用
  assert.equal(isUsableFor(second.pool[0]!, "botB", TOMB_POLICY, { nowTick: 1000 }), false);
  // 复活期已过（500+1000<=1500）：视为 free 可用
  assert.equal(isUsableFor(second.pool[0]!, "botB", TOMB_POLICY, { nowTick: 1500 }), true, "复活期过→复活");
  // 无复活期策略 = 永不复活（旧行为）
  assert.equal(isUsableFor(second.pool[0]!, "botB", NEAREST_POLICY, { nowTick: 99999 }), false);
});

test("exhaustEntry：放弃立墓碑（保留条目防重扫复活）", () => {
  const TOMB_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, unavailableTtlTicks: 1000 };
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, TOMB_POLICY, "r1", "botA", 100);
  pool = exhaustEntry(pool, TOMB_POLICY, "r1", 200);
  assert.equal(pool[0]?.status, "unavailable");
  assert.equal(pool[0]?.claimant, undefined, "墓碑不带认领者");
  assert.equal(pool[0]?.unavailableAt, 200);
  assert.equal(isUsableFor(pool[0]!, "botB", TOMB_POLICY, { nowTick: 500 }), false, "复活期前不可用");
  assert.equal(isUsableFor(pool[0]!, "botB", TOMB_POLICY, { nowTick: 1200 }), true, "复活期后复活");
});

test("merge：占用保留 / 墓碑保留 / free 刷新数据", () => {
  const TOMB_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, unavailableTtlTicks: 1000 };
  const occupied = { ...makeEntry("a"), status: "occupied" as const, claimant: "botA", claimedAt: 100 };
  const tomb = { ...makeEntry("b"), status: "unavailable" as const, unavailableAt: 100 };
  const staleFree = { ...makeEntry("c", { x: 1, y: 0, z: 0 }), scannedAt: 100 };
  const pool = [occupied, tomb, staleFree];
  // 重扫到了 a（别人视角的旧数据）、b、c（新数据 pos 变了）
  const scanned = [
    { ...makeEntry("a", { x: 9, y: 9, z: 9 }) },
    { ...makeEntry("b", { x: 9, y: 9, z: 9 }) },
    { ...makeEntry("c", { x: 2, y: 0, z: 0 }) },
  ];
  const merged = mergeEntries(pool, TOMB_POLICY, scanned, 500);
  const byId = new Map(merged.map((e) => [e.id, e]));
  assert.equal(byId.get("a")?.pos.x, 0, "占用条目保留持有者视图（不被重扫覆盖）");
  assert.equal(byId.get("a")?.claimant, "botA");
  assert.equal(byId.get("b")?.status, "unavailable", "墓碑保留");
  assert.equal(byId.get("b")?.unavailableAt, 100, "墓碑时间戳不动");
  assert.equal(byId.get("c")?.pos.x, 2, "free 用扫描新数据刷新");
  assert.equal(byId.get("c")?.scannedAt, 500, "刷新打新时间戳");
  assert.equal(byId.get("c")?.status, "free");
});

test("release 占用者校验：误释他人认领时原样返回", () => {
  let pool = [makeEntry("r1")];
  pool = claimEntry(pool, NEAREST_POLICY, "r1", "botA", 100);
  const wrong = releaseEntry(pool, NEAREST_POLICY, "r1", "botB");
  assert.equal(wrong[0]?.status, "occupied", "非持有者释放不动条目");
  assert.equal(wrong[0]?.claimant, "botA");
  const right = releaseEntry(pool, NEAREST_POLICY, "r1", "botA");
  assert.equal(right[0]?.status, "free");
  assert.equal(right[0]?.claimedAt, undefined, "释放清租约起点");
  // 不传期望持有者 = 旧行为（无条件释放）
  const legacy = releaseEntry(pool, NEAREST_POLICY, "r1");
  assert.equal(legacy[0]?.status, "free");
});

test("排除集：excludeKeys 命中的键选点跳过", () => {
  const pool = [makeEntry("a", { x: 1, y: 0, z: 0 }), makeEntry("b", { x: 2, y: 0, z: 0 })];
  const picked = pickBest(pool, "botA", NEAREST_POLICY, ORIGIN, { excludeKeys: new Set(["a"]) });
  assert.equal(picked?.id, "b", "排除 a 后选 b");
  const pickedArr = pickBest(pool, "botA", NEAREST_POLICY, ORIGIN, { excludeKeys: ["a", "b"] });
  assert.equal(pickedArr, undefined, "全排除 → 无可用");
  assert.equal(countUsable(pool, "botA", NEAREST_POLICY, { excludeKeys: ["a"] }), 1);
});

test("free 新鲜度：过期 free 不参与选点/计数（触发重扫），但 merge known 仍含", () => {
  const FRESH_POLICY: PoolPolicy<FakeResource> = { ...NEAREST_POLICY, dataTtlTicks: 100 };
  const fresh = { ...makeEntry("a", { x: 1, y: 0, z: 0 }), scannedAt: 1100 };
  const stale = { ...makeEntry("b", { x: 2, y: 0, z: 0 }), scannedAt: 100 };
  const pool = [fresh, stale];
  assert.equal(countUsable(pool, "botA", FRESH_POLICY, { nowTick: 1150 }), 1, "过期 free 不计数");
  assert.equal(pickBest(pool, "botA", FRESH_POLICY, ORIGIN, { nowTick: 1150 })?.id, "a");
  // 不传 nowTick = 旧行为（全算新鲜）
  assert.equal(countUsable(pool, "botA", FRESH_POLICY), 2);
  // merge known 仍含过期键：重扫出 b → 刷新而非"新发现"
  const merged = mergeEntries(pool, FRESH_POLICY, [makeEntry("b", { x: 3, y: 0, z: 0 })], 1150);
  assert.equal(merged.length, 2, "不过度膨胀");
  assert.equal(merged.find((e) => e.id === "b")?.pos.x, 3, "过期 free 被扫描新数据刷新");
});
