// ── 批量读取分组（纯逻辑，零 @minecraft 依赖） ──────────────────
// `getBatch` 的编排辅助：把一组 slotId 按"所在木桶"分组——
// 同桶格子在**一次容器读取**中批量取（每桶一次 getBlock + 一次 getItem 循环，
// 替代逐格 getBlock 放大；与 put 的 findEmptySlotInBarrel 优化同思路）。
// 纯函数可 node 单测：分组正确性（同桶合并/跨桶分离/越界跳过/输入索引保留）。

import type { RegionLayout, SlotPosition } from "./layout";
import { slotIdToPosition } from "./layout";

/** 分组条目：原始 slotId + 输入数组下标（结果按输入顺序对齐）+ 桶内格号 */
export interface BatchGroupEntry {
  slotId: number;
  /** 在输入数组中的下标（getBatch 输出对齐用） */
  inputIndex: number;
  pos: SlotPosition;
  /** 桶内格号 0..26 */
  slotInBarrel: number;
}

/** 桶坐标 key（x,y,z 唯一标识一个木桶） */
export function barrelKey(pos: SlotPosition): string {
  return `${pos.x},${pos.y},${pos.z}`;
}

/**
 * 把 slotId 数组按桶分组（同桶合并）。
 * 越界 slotId（解码失败）跳过（getBatch 对应位置返回 undefined）。
 * @returns Map<桶坐标key, 组内条目>——组内条目保留输入顺序
 */
export function groupSlotIdsByBarrel(slotIds: number[], layout: RegionLayout): Map<string, BatchGroupEntry[]> {
  const groups = new Map<string, BatchGroupEntry[]>();
  for (let i = 0; i < slotIds.length; i++) {
    const pos = slotIdToPosition(slotIds[i]!, layout);
    if (!pos) continue; // 越界：跳过（输出位保持 undefined）
    const key = barrelKey(pos);
    const group = groups.get(key);
    const entry: BatchGroupEntry = { slotId: slotIds[i]!, inputIndex: i, pos, slotInBarrel: pos.slotInBarrel };
    if (group) {
      group.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return groups;
}
