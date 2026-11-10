// ─── 三叉戟规则（domain 纯逻辑） ──────────────
// 纯类型 id 数组扫描；容器读取/投掷时序在 engine TridentOps。
// 主手三叉戟由装备组件判定后传入标记；背包扫描排除主手格防重复计入（同一把投两次、第二发拿空槽）。

/** 三叉戟类型 id */
export const TRIDENT_ID = "minecraft:trident";

/** 是否三叉戟 */
export function isTrident(typeId: string): boolean {
  return typeId === TRIDENT_ID;
}

/** 三叉戟槽位信息 */
export interface TridentSlotInfo {
  slotIndex: number;
  isMainhand: boolean;
}

/**
 * 扫描槽位类型 id 数组，收集三叉戟槽位。
 * @param typeIds - index=槽位，null=空（含热栏）
 * @param mainhandSlot - 当前主手槽
 * @param mainhandIsTrident - 主手是否持三叉戟（装备组件判定的结果传入）
 */
export function scanTridentSlots(
  typeIds: (string | null)[],
  mainhandSlot: number,
  mainhandIsTrident: boolean
): TridentSlotInfo[] {
  const out: TridentSlotInfo[] = [];
  if (mainhandIsTrident) out.push({ slotIndex: mainhandSlot, isMainhand: true });
  for (let i = 0; i < typeIds.length; i++) {
    if (i === mainhandSlot && mainhandIsTrident) continue;
    const id = typeIds[i];
    if (id != null && isTrident(id)) out.push({ slotIndex: i, isMainhand: false });
  }
  return out;
}

/** 认主扫描半径（方块） */
export const CLAIM_SCAN_RADIUS = 100;
/** 聚集分组半径（方块）：链式连通聚类 */
export const CLAIM_CLUSTER_RADIUS = 3;
/** 组名前缀（A=三叉戟，B=箭），按组内数量降序编号 */
export const CLAIM_GROUP_PREFIX: Record<string, string> = {
  "minecraft:thrown_trident": "A",
  "minecraft:arrow": "B",
};
