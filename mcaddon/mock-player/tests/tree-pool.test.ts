// ─── core/rules/woodcut — 共享树资源池（TreePool） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimTree,
  countClaimable,
  isTreeClaimableFor,
  mergeScannedTrees,
  passesTreeConstraints,
  pickBestTree,
  POOL_MIN_TREES,
  releaseTree,
  removeTree,
  TREE_POOL_MAX_DISTANCE,
  type PoolTree,
} from "../scripts/rules/woodcut/TreePool";
import type { TreeResource, TreeFactors } from "../scripts/rules/tree/TreeRules";

const FACTORS: TreeFactors = { G: 1, L: 1, C: 1, F: 1, H: 1, A: 1 };

/** 构造一个池树条目（树中心 base 可指定） */
function makeTree(id: string, base: { x: number; y: number; z: number }, overrides: Partial<PoolTree> = {}): PoolTree {
  const full: TreeResource = {
    id,
    kind: "small",
    probability: 1,
    factors: FACTORS,
    base: { x: base.x + 0.5, y: base.y + 0.5, z: base.z + 0.5 },
    top: { x: base.x + 0.5, y: base.y + 2.5, z: base.z + 0.5 },
    footprint: [{ x: base.x + 0.5, y: base.y - 0.5, z: base.z + 0.5 }],
    logs: [{ x: base.x + 0.5, y: base.y + 0.5, z: base.z + 0.5, woodId: "oak" }],
    leafs: [{ x: base.x + 0.5, y: base.y + 1.5, z: base.z + 0.5 }],
  };
  return { ...full, status: "free", ...overrides };
}

test("countClaimable / pickBestTree：只认领附近 16 格 + 他人认领不可抢", () => {
  const center = { x: 0, y: 64, z: 0 };
  const pool: PoolTree[] = [
    makeTree("t1", { x: 3, y: 64, z: 0 }), // 近
    makeTree("t2", { x: 30, y: 64, z: 0 }), // 超 16 → 排除
    makeTree("t3", { x: 8, y: 64, z: 0 }, { status: "occupied", claimant: "$B" }), // 被他人认领 → 排除
  ];
  assert.equal(countClaimable(pool, "$A", { center, maxDistance: TREE_POOL_MAX_DISTANCE }), 1); // t1
  const best = pickBestTree(pool, "$A", center, { center, maxDistance: TREE_POOL_MAX_DISTANCE });
  assert.equal(best?.id, "t1");
  // 认领者本人可见自己的树
  assert.equal(isTreeClaimableFor(pool[2]!, "$B"), true);
});

test("claimTree / releaseTree / removeTree：独占认领、释放回 free、处理完移除", () => {
  let pool = [makeTree("t1", { x: 1, y: 64, z: 0 })];
  pool = claimTree(pool, "t1", "$A");
  assert.equal(pool[0]!.status, "occupied");
  assert.equal(pool[0]!.claimant, "$A");
  // 他人不可认领 / 本人可
  assert.equal(isTreeClaimableFor(pool[0]!, "$B"), false);
  assert.equal(isTreeClaimableFor(pool[0]!, "$A"), true);
  // 释放 → free
  pool = releaseTree(pool, "t1");
  assert.equal(pool[0]!.status, "free");
  assert.equal(pool[0]!.claimant, undefined);
  // 处理完移除
  pool = removeTree(pool, "t1");
  assert.equal(pool.length, 0);
});

test("mergeScannedTrees：去重保留已有认领状态，新树按 free 加入", () => {
  const existing: PoolTree[] = [makeTree("t1", { x: 1, y: 64, z: 0 }, { status: "occupied", claimant: "$A" })];
  const scanned: TreeResource[] = [
    makeTree("t1", { x: 1, y: 64, z: 0 }), // 已存在 → 不覆盖
    makeTree("t2", { x: 5, y: 64, z: 0 }), // 新树 → free
  ];
  const merged = mergeScannedTrees(existing, scanned);
  assert.equal(merged.length, 2);
  const t1 = merged.find((t) => t.id === "t1");
  assert.equal(t1?.status, "occupied");
  assert.equal(t1?.claimant, "$A");
  const t2 = merged.find((t) => t.id === "t2");
  assert.equal(t2?.status, "free");
});

test("passesTreeConstraints：默认 16 格距离 + 现场有效性", () => {
  const tree = makeTree("t1", { x: 18, y: 64, z: 0 });
  assert.equal(passesTreeConstraints(tree, { center: { x: 0, y: 64, z: 0 } }), false); // 超 16
  assert.equal(passesTreeConstraints(tree, { center: { x: 0, y: 64, z: 0 }, maxDistance: 20 }), true);
  assert.equal(passesTreeConstraints(tree, { center: { x: 0, y: 64, z: 0 }, maxDistance: 20, isValid: () => false }), false);
  assert.equal(passesTreeConstraints(tree, { center: { x: 0, y: 64, z: 0 }, maxDistance: 20, isValid: () => true }), true);
});

test("双假人防抢 + 处理完移除再认领 + 不足主动扫描（核心语义集成）", () => {
  // 假人 A 在 (0,64,0)，假人 B 在 (10,64,0)；t1 两方 16 格内，t2 超 16
  const centerA = { x: 0, y: 64, z: 0 };
  const centerB = { x: 10, y: 64, z: 0 };
  let pool: PoolTree[] = [
    makeTree("t1", { x: 3, y: 64, z: 0 }),
    makeTree("t2", { x: 40, y: 64, z: 0 }),
  ];
  // ① 两方各自都有 1 棵可认领（t1；t2 超 16 排除）
  assert.equal(countClaimable(pool, "$A", { center: centerA, maxDistance: TREE_POOL_MAX_DISTANCE }), 1);
  assert.equal(countClaimable(pool, "$B", { center: centerB, maxDistance: TREE_POOL_MAX_DISTANCE }), 1);

  // ② A 认领 t1 → B 不可抢（可认领数归 0 < POOL_MIN_TREES → 下次 B 会主动扫描）
  pool = claimTree(pool, "t1", "$A");
  assert.equal(countClaimable(pool, "$B", { center: centerB, maxDistance: TREE_POOL_MAX_DISTANCE }), 0);
  assert.ok(0 < POOL_MIN_TREES, "可认领不足 → 触发主动扫描分享的判据");
  assert.equal(pickBestTree(pool, "$B", centerB, { center: centerB, maxDistance: TREE_POOL_MAX_DISTANCE }), undefined);
  // A 本人仍可看到自己独占的树（认领中不重抢自己）
  assert.equal(countClaimable(pool, "$A", { center: centerA, maxDistance: TREE_POOL_MAX_DISTANCE }), 1);

  // ③ A 处理完移除 t1 → 世界树还在，后续扫描 mergeScannedTrees 补回 free → B 重新可认领
  pool = removeTree(pool, "t1");
  const merged = mergeScannedTrees(pool, [makeTree("t1", { x: 3, y: 64, z: 0 })]);
  assert.equal(countClaimable(merged, "$B", { center: centerB, maxDistance: TREE_POOL_MAX_DISTANCE }), 1);
  assert.equal(pickBestTree(merged, "$B", centerB, { center: centerB, maxDistance: TREE_POOL_MAX_DISTANCE })?.id, "t1");
});
