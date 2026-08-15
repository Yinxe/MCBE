// ─── 三叉戟规则（core 层） ──────────────────────────────
// 纯逻辑：三叉戟识别与槽位扫描（容器无关，基于序列化物品数组）。
// 实体容器读取与投掷时序在 mc 层。

import type { SerializedItemStack } from "../model/Types";

export const TRIDENT_ID = "minecraft:trident";

/** 是否为三叉戟 */
export function isTrident(typeId: string): boolean {
  return typeId === TRIDENT_ID;
}

/** 三叉戟槽位信息（isMainhand = 位于主手） */
export interface TridentSlotInfo {
  slotIndex: number;
  isMainhand: boolean;
}

/**
 * 扫描物品数组，收集所有三叉戟的槽位信息。
 * @param items 物品数组（index = slot，null = 空位）
 * @param mainhandSlot 当前主手槽位
 * @param mainhandIsTrident 主手是否已持有三叉戟（避免背包重复计入主手格）
 */
export function scanTridentSlots(
  items: ReadonlyArray<SerializedItemStack | null>,
  mainhandSlot: number,
  mainhandIsTrident: boolean
): TridentSlotInfo[] {
  const tridents: TridentSlotInfo[] = [];

  // 主手三叉戟（由调用方通过装备组件判定，此处直接计入）
  if (mainhandIsTrident) {
    tridents.push({ slotIndex: mainhandSlot, isMainhand: true });
  }

  // 背包（含热栏，排除主手已找到的格子）
  for (let i = 0; i < items.length; i++) {
    if (i === mainhandSlot && mainhandIsTrident) continue;
    const item = items[i];
    if (item && isTrident(item.typeId)) {
      tridents.push({ slotIndex: i, isMainhand: false });
    }
  }

  return tridents;
}