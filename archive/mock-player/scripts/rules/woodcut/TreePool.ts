// ─── 共享树资源池（core 层） ──────────────────────────
// 生物 AI 自动砍树的跨假人共享数据模型：所有砍树假人共用一个池
// （存 SharedMemory "woodcut:pool"，renewing TTL——活跃即延长）。
//
// 认领机制（用户规格 2026-08-18，对齐钓鱼共享池）：
//   - free → 任何假人可认领（claimTree 独占）
//   - occupied → 被某假人独占认领（claimant），**只有认领者本人可用**
//   - **多假人不抢夺树资源**：occupied 状态天然防抢（每次只挑一个）
//   - **只认领附近 16 格**（TREE_POOL_MAX_DISTANCE）：pick/count 均按树中心
//     到假人位置的 3D 距离过滤
//   - **处理完移除树资源**（removeTree——树已砍光/放弃，从池删除不再共享）
//   - **可认领树资源不足**（POOL_MIN_TREES=3）→ 下次寻找的假人主动扫描发现
//     新树并合并进池共享（mergeScannedTrees）
//
// 本模块纯函数（零 @minecraft，可单测）：所有函数**不修改入参**，返回新值。

import type { TreeResource } from "../tree/TreeRules";
import type { Vec3 } from "../Types";

/** 共享树条目状态：free=空闲可认领 / occupied=被某假人独占认领 */
export type PoolTreeStatus = "free" | "occupied";

/** 共享树条目（树资源 + 认领状态；可序列化，存 SharedMemory） */
export interface PoolTree extends TreeResource {
  status: PoolTreeStatus;
  /** 独占认领者的假人名（仅 occupied 时有意义） */
  claimant?: string;
}

/** 共享池键（SharedMemory） */
export const TREE_POOL_KEY = "woodcut:pool";

/** 只认领附近 16 格内的树资源（用户规格） */
export const TREE_POOL_MAX_DISTANCE = 16;

/** 可认领树资源下限：池内可认领数 < 此值 → 下次寻找的假人主动扫描发现新树并共享 */
export const POOL_MIN_TREES = 3;

/** 池 TTL（tick = 60 秒；renewing——数据持续被写入/更新即延长） */
export const POOL_TTL_TICKS = 1200;

/** 认领约束选项（距离 + 可选现场有效性回调——core 零 @minecraft） */
export interface TreePickOptions {
  /** 距离过滤中心（通常为假人位置）；传入则启用距离约束 */
  center?: Vec3;
  /** 最大距离（格，用户规格：只认领附近 16 格；缺省 TREE_POOL_MAX_DISTANCE） */
  maxDistance?: number;
  /** 现场有效性判定（mc 层注入：树仍在/未被砍光等）；返回 false 视为不可认领 */
  isValid?: (tree: PoolTree) => boolean;
}

/** 3D 距离平方（认领距离过滤/排序） */
function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** 树条目是否通过认领约束（距离 + 现场有效性） */
export function passesTreeConstraints(tree: PoolTree, options?: TreePickOptions): boolean {
  if (!options) return true;
  if (options.center) {
    const maxDistance = options.maxDistance ?? TREE_POOL_MAX_DISTANCE;
    if (distSq(tree.base, options.center) > maxDistance * maxDistance) return false;
  }
  if (options.isValid && !options.isValid(tree)) return false;
  return true;
}

/** 某假人视角下该树是否可认领（状态 + 独占语义；维度由调用方保证池内一致：
 *  池为跨维度共享，默认按树所在维度过滤由 mc 层注入） */
export function isTreeClaimableFor(tree: PoolTree, botName: string): boolean {
  if (tree.status === "occupied") return tree.claimant === botName;
  return true;
}

/** 池内对某假人可认领且通过约束的树数（不足下限 → 主动扫描共享） */
export function countClaimable(pool: readonly PoolTree[], botName: string, options?: TreePickOptions): number {
  return pool.filter((t) => isTreeClaimableFor(t, botName) && passesTreeConstraints(t, options)).length;
}

/** 挑最近可认领树（3D 距离升序——就近优先；被他人认领/超距/现场无效的排除） */
export function pickBestTree(
  pool: readonly PoolTree[],
  botName: string,
  center: Vec3,
  options?: TreePickOptions,
): PoolTree | undefined {
  const claimable = pool.filter(
    (t) => isTreeClaimableFor(t, botName) && passesTreeConstraints(t, options),
  );
  if (claimable.length === 0) return undefined;
  claimable.sort((a, b) => distSq(a.base, center) - distSq(b.base, center));
  return claimable[0];
}

/** 扫描结果合并进池（去重）：同 id 保留已有状态/认领，新树按 free 加入 */
export function mergeScannedTrees(pool: readonly PoolTree[], scanned: readonly TreeResource[]): PoolTree[] {
  const byId = new Map(pool.map((t) => [t.id, t]));
  for (const tree of scanned) {
    if (!byId.has(tree.id)) {
      byId.set(tree.id, { ...tree, status: "free" });
    }
  }
  return [...byId.values()];
}

/** 独占认领某棵树（标记共享——其他假人不再抢它） */
export function claimTree(pool: readonly PoolTree[], treeId: string, botName: string): PoolTree[] {
  return pool.map((t) => (t.id === treeId ? { ...t, status: "occupied", claimant: botName } : t));
}

/** 释放认领（树还在/换树/暂撤离 → 回 free 共享） */
export function releaseTree(pool: readonly PoolTree[], treeId: string): PoolTree[] {
  return pool.map((t) => (t.id === treeId ? { ...t, status: "free", claimant: undefined } : t));
}

/** 处理完移除树资源（树已砍光/永久放弃 → 从池删除不再共享） */
export function removeTree(pool: readonly PoolTree[], treeId: string): PoolTree[] {
  return pool.filter((t) => t.id !== treeId);
}
