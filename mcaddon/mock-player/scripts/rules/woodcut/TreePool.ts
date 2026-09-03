// ─── 共享树资源池（core 层——统一资源模型的树策略） ──────
// 自动砍树任务（flow/tasks/woodcutTask）的跨假人共享数据模型：
// 所有砍树假人共用一个池（存 runtime/SharedMemory "woodcut:pool"，
// renewing TTL——活跃即延长）。
//
// ⚠️ 机制本体在**统一资源模型**（rules/resource/ResourcePool）：
//   共享 / 独占认领（防抢）/ 扫描合并——本文件只声明树的**差异规则**
//   （PoolPolicy：基座+3D 距离、距离升序排序、无失败标记）+ 树条目类型。
//
// 砍树特有规则（用户规格 2026-08-18，对齐钓鱼共享池）：
//   - **多假人不抢夺树资源**：occupied 状态天然防抢（每次只挑一个）
//   - **只认领附近 16 格**（TREE_POOL_MAX_DISTANCE）：pick/count 均按树中心
//     到假人位置的 3D 距离过滤
//   - **处理完移除树资源**（removeTree——树已砍光/放弃，从池删除不再共享；
//     统一模型的 release 语义对树不适用——树无失败标记，释放即回 free）
//   - **可认领树资源不足**（POOL_MIN_TREES=3）→ 下次寻找的假人主动扫描发现
//     新树并合并进池共享（mergeScannedTrees）
//
// 本模块纯函数（零 @minecraft，可单测）：所有函数**不修改入参**，返回新值。

import {
  claimEntry,
  dist3dSq,
  isUsableFor,
  mergeEntries,
  passesPickConstraints,
  pickBest,
  releaseEntry,
  removeEntry,
  type PoolEntry,
  type PoolPolicy,
} from "../resource/ResourcePool";
import type { TreeResource } from "../tree/TreeRules";
import type { Vec3 } from "../Types";

/** 共享树条目状态：free=空闲可认领 / occupied=被某假人独占认领（树无失败标记态） */
export type PoolTreeStatus = "free" | "occupied";

/** 共享树条目（树资源 + 认领状态；可序列化，存 SharedMemory） */
export interface PoolTree extends TreeResource, PoolEntry {
  status: PoolTreeStatus;
}

/** 共享池键（SharedMemory） */
export const TREE_POOL_KEY = "woodcut:pool";

/** 只认领附近 16 格内的树资源（用户规格） */
export const TREE_POOL_MAX_DISTANCE = 16;

/** 可认领树资源下限：池内可认领数 < 此值 → 下次寻找的假人主动扫描发现新树并共享 */
export const POOL_MIN_TREES = 3;

/** 池 TTL（tick = 60 秒；renewing——数据持续被写入/更新即延长） */
export const POOL_TTL_TICKS = 1200;

/** 树资源策略（统一资源模型的树差异规则；树无失败标记——maxFailStrikes=0） */
export const TREE_POOL_POLICY: PoolPolicy<PoolTree> = {
  keyOf: (tree) => tree.id,
  centerOf: (tree) => tree.base,
  distance: dist3dSq,
  maxDistance: TREE_POOL_MAX_DISTANCE,
  // 就近优先（3D 距离升序）
  compare: (a, b, botPos) => dist3dSq(a.base, botPos) - dist3dSq(b.base, botPos),
  maxFailStrikes: 0,
};

/** 认领约束选项（距离 + 可选现场有效性回调——core 零 @minecraft） */
export interface TreePickOptions {
  /** 距离过滤中心（通常为假人位置）；传入则启用距离约束 */
  center?: Vec3;
  /** 最大距离（格，用户规格：只认领附近 16 格；缺省 TREE_POOL_MAX_DISTANCE） */
  maxDistance?: number;
  /** 现场有效性判定（mc 层注入：树仍在/未被砍光等）；返回 false 视为不可认领 */
  isValid?: (tree: PoolTree) => boolean;
}

/** 树条目是否通过认领约束（距离 + 现场有效性） */
export function passesTreeConstraints(tree: PoolTree, options?: TreePickOptions): boolean {
  return passesPickConstraints(tree, TREE_POOL_POLICY, options);
}

/**
 * 整树为单位的空间独占（用户拍板：树资源与钓鱼点不同——钓鱼点是单点资源，
 * 树资源以**一棵树为单位**）：目标树的占地（footprint 水平投影）若与其他
 * 假人**已认领**的树重叠，视为同一棵树的延伸——不可认领。
 * 防止相邻/连体树被扫描成两个条目后，两个假人各认领一棵"名义不同"的树、
 * 实际抢同一批原木。
 */
function overlapsClaimed(pool: readonly PoolTree[], tree: PoolTree, botName: string): boolean {
  const cells = new Set(tree.footprint.map((c) => `${c.x},${c.z}`));
  return pool.some(
    (other) =>
      other.id !== tree.id &&
      other.status === "occupied" &&
      other.claimant !== undefined &&
      other.claimant !== botName &&
      other.footprint.some((c) => cells.has(`${c.x},${c.z}`)),
  );
}

/** 某假人视角下该树是否可认领（状态 + 独占语义 + 整树占地不与他人重叠） */
export function isTreeClaimableFor(tree: PoolTree, botName: string, pool?: readonly PoolTree[]): boolean {
  if (!isUsableFor(tree, botName, TREE_POOL_POLICY)) return false;
  if (pool && overlapsClaimed(pool, tree, botName)) return false;
  return true;
}

/** 池内对某假人可认领且通过约束的树数（不足下限 → 主动扫描共享） */
export function countClaimable(pool: readonly PoolTree[], botName: string, options?: TreePickOptions): number {
  return pool.filter(
    (t) => isTreeClaimableFor(t, botName, pool) && passesTreeConstraints(t, options),
  ).length;
}

/** 挑最近可认领树（3D 距离升序——就近优先；被他人认领/超距/占地重叠/现场无效的排除） */
export function pickBestTree(
  pool: readonly PoolTree[],
  botName: string,
  center: Vec3,
  options?: TreePickOptions,
): PoolTree | undefined {
  const claimable = pool.filter((t) => isTreeClaimableFor(t, botName, pool) && passesTreeConstraints(t, options));
  if (claimable.length === 0) return undefined;
  return pickBest(claimable, botName, TREE_POOL_POLICY, center);
}

/** 扫描结果合并进池（去重）：同 id 保留已有状态/认领，新树按 free 加入 */
export function mergeScannedTrees(pool: readonly PoolTree[], scanned: readonly TreeResource[]): PoolTree[] {
  return mergeEntries(pool, TREE_POOL_POLICY, scanned.map((tree) => ({ ...tree, status: "free" as const })));
}

/** 独占认领某棵树（标记共享——其他假人不再抢它） */
export function claimTree(pool: readonly PoolTree[], treeId: string, botName: string): PoolTree[] {
  return claimEntry(pool, TREE_POOL_POLICY, treeId, botName);
}

/** 释放认领（树还在/换树/暂撤离 → 回 free 共享；树无失败标记，恒回 free） */
export function releaseTree(pool: readonly PoolTree[], treeId: string): PoolTree[] {
  return releaseEntry(pool, TREE_POOL_POLICY, treeId);
}

/** 处理完移除树资源（树已砍光/永久放弃 → 从池删除不再共享） */
export function removeTree(pool: readonly PoolTree[], treeId: string): PoolTree[] {
  return removeEntry(pool, TREE_POOL_POLICY, treeId);
}
