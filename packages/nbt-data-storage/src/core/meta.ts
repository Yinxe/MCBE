// ── 区域分配元数据（纯逻辑，零 @minecraft 依赖） ────────────────────────
// 真实占用以世界（木桶实物）为准；元数据只记录两件事，保证 O(1) 分配/回收：
//   - nextFree：下一个从未用过的**全局** slotId（只增不减的水印）
//   - 空洞：按层存放，**每层一条 DP 键**（mc 层负责落盘），本模块只维护：
//       * holeLevels：尚有空洞的层号（升序，索引空洞在哪层 → O(1) 定位）
//       * holeCount：空洞总数（统计用，免加载全部层）
// 空洞数据里存的是 **level-local 索引（0..SLOTS_PER_LEVEL-1）**，而不是全局 slotId，
// 这样即使层数很多（如 64 层），单键值的数字也始终 ≤ 4 位，DP 单值大小有界（≤ 一层 6912 条）。
// 全局 slotId = level × SLOTS_PER_LEVEL + local，用时现算。
//
// 元数据是软状态（可被世界真值自愈）：meta 丢失时从 0 重新分配，
// put 侧的世界占用检查会跳过已被占用的槽位，不会覆盖他人物品。
import { SLOTS_PER_LEVEL, levelOf } from "./layout";

/** 区域分配元数据（可 JSON 持久化；空洞本体按层独立持久化，不在本结构内） */
export interface RegionMeta {
  readonly v: 2;
  /** 下一个从未用过的全局槽位 ID（水印，只增不减） */
  nextFree: number;
  /** 尚有空洞的层号（升序），索引"洞在哪层" → 分配 O(1) 定位可复用层 */
  holeLevels: number[];
  /** 空洞总数（= 各层空洞之和；统计 used 用，免加载全部层） */
  holeCount: number;
  /** 已物化的木桶数（每次真正 setBlockType 建新桶 +1；空桶常驻不回收） */
  barrelCount: number;
}

/** 空洞池（纯内存形状，core 分配/回收用；持久化由 mc 层按层读写 DP） */
export interface LevelPools {
  /** 每层空洞：level-local 索引（0..SLOTS_PER_LEVEL-1）；只含已加载的层，其余为 undefined */
  byLevel: (number[] | undefined)[];
}

/** 建一个覆盖到 maxLevels 层的空空洞池 */
export function createLevelPools(maxLevels: number): LevelPools {
  return { byLevel: Array.from({ length: maxLevels }, () => undefined) };
}

/** 新建空元数据 */
export function createRegionMeta(): RegionMeta {
  return { v: 2, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: 0 };
}

/**
 * 分配一个槽位 ID（O(1)）：优先复用**最低层**空洞（层号经 holeLevels 索引 O(1) 定位），
 * 否则推进 nextFree 水印。容量已满返回 null。
 */
export function allocateSlotId(meta: RegionMeta, pools: LevelPools, capacity: number): number | null {
  const lowest = meta.holeLevels[0];
  if (lowest !== undefined) {
    const pool = pools.byLevel[lowest];
    const local = pool?.pop();
    if (local !== undefined) {
      if (pool && pool.length === 0) meta.holeLevels.shift(); // 该层无洞 → 移出索引
      meta.holeCount -= 1;
      return lowest * SLOTS_PER_LEVEL + local;
    }
    // 索引指向的层没有数据（异常：该层池丢失）→ 丢弃该索引，走水印
    meta.holeLevels.shift();
  }
  if (meta.nextFree >= capacity) return null;
  return meta.nextFree++;
}

/**
 * 回收一个槽位 ID 到其所在层的空洞池（O(1)）。
 * 保护：槽位 ID 必须小于水印（即曾被分配过），否则忽略。
 * 副作用：同步维护 holeLevels（升序）与 holeCount。
 */
export function releaseSlotId(meta: RegionMeta, pools: LevelPools, slotId: number): void {
  if (!Number.isInteger(slotId) || slotId < 0) return;
  if (slotId >= meta.nextFree) return;
  const level = levelOf(slotId);
  const local = slotId - level * SLOTS_PER_LEVEL;
  const pool = (pools.byLevel[level] ??= []);
  if (pool.length === 0 && !meta.holeLevels.includes(level)) {
    meta.holeLevels.push(level);
    meta.holeLevels.sort((a, b) => a - b);
  }
  pool.push(local);
  meta.holeCount += 1;
}

/** 当前"视为已占用"的槽位数（水印 − 空洞总数） */
export function usedSlots(meta: RegionMeta): number {
  return meta.nextFree - meta.holeCount;
}
