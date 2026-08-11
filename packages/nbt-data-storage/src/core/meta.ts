// ── 区域分配元数据（纯逻辑，零 @minecraft 依赖） ────────────────────────
// 真实占用以世界（木桶实物）为准；元数据只记录两件事，保证 O(1) 分配/回收：
//   - nextFree：下一个从未用过的槽位 ID（只增不减的水印）
//   - freePool：被释放的空洞槽位 ID（优先复用，避免容量被"只进不还"打洞浪费）
// 元数据是软状态（可被世界真值自愈）：meta 丢失时从 0 重新分配，
// put 侧的世界占用检查会跳过已被占用的槽位，不会覆盖他人物品。

/** 区域分配元数据（可 JSON 持久化） */
export interface RegionMeta {
  readonly v: 1;
  /** 下一个从未用过的槽位 ID（水印，只增不减） */
  nextFree: number;
  /** 被释放的空洞槽位 ID（优先复用） */
  freePool: number[];
}

/** 新建空元数据 */
export function createRegionMeta(): RegionMeta {
  return { v: 1, nextFree: 0, freePool: [] };
}

/**
 * 分配一个槽位 ID（O(1)）：优先复用 freePool 空洞，否则推进 nextFree 水印。
 * 容量已满返回 null。
 */
export function allocateSlotId(meta: RegionMeta, capacity: number): number | null {
  const hole = meta.freePool.pop();
  if (hole !== undefined) return hole;
  if (meta.nextFree >= capacity) return null;
  const slotId = meta.nextFree;
  meta.nextFree += 1;
  return slotId;
}

/**
 * 回收一个槽位 ID 到空洞池（O(1)）。
 * 保护：槽位 ID 必须小于水印（即曾被分配过），否则忽略。
 */
export function releaseSlotId(meta: RegionMeta, slotId: number): void {
  if (!Number.isInteger(slotId) || slotId < 0) return;
  if (slotId >= meta.nextFree) return;
  meta.freePool.push(slotId);
}

/** 当前"视为已占用"的槽位数（水印 − 空洞） */
export function usedSlots(meta: RegionMeta): number {
  return meta.nextFree - meta.freePool.length;
}
