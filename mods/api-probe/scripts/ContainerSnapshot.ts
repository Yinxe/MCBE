// ─── 容器快照:把 Container 遍历成可序列化的只读数据 ──────────────
//
// 探针要核对两件事:
//   1. `container.emptySlotsCount` 声称的空槽数;
//   2. 自己按槽位遍历统计出的非空槽数。
// 两者不一致本身就是有价值的探针输出,所以这里同时保留两份数字,
// 而不是用其中一份去推导另一份。
//
// 读取期间方块可能被破坏、容器可能失效,因此单槽读取失败只跳过该槽并
// 记入 `slotErrors`,不让一个坏槽毁掉整次快照。

import { type Container } from "@minecraft/server";
import { errorText } from "./ContainerReader";

/** 单个非空槽位的快照 */
export interface SlotSnapshot {
  /** 槽位下标,与游戏内槽位编号一致 */
  slot: number;
  /** 物品标识,如 `minecraft:diamond` */
  typeId: string;
  /** 堆叠数量 */
  amount: number;
}

/** 单个槽位的读取失败记录 */
export interface SlotError {
  slot: number;
  reason: string;
}

/** 整只容器的只读快照 */
export interface ContainerSnapshot {
  /** 容器总槽位数(取自 `container.size`) */
  size: number;
  /** 容器自报的空槽数(取自 `container.emptySlotsCount`) */
  emptySlotsCount: number;
  /** 按槽位遍历得到的非空槽条目,按槽位下标升序 */
  nonEmptySlots: SlotSnapshot[];
  /** 自己数出来的非空槽数,用于与 `emptySlotsCount` 对照 */
  countedNonEmpty: number;
  /** 读取失败的槽位;正常情况下为空数组 */
  slotErrors: SlotError[];
}

/**
 * 遍历容器生成快照。
 *
 * 只调用 `getItem` 这类读取接口,不对容器做任何写入。
 */
export function takeContainerSnapshot(container: Container): ContainerSnapshot {
  const size = container.size;
  const emptySlotsCount = container.emptySlotsCount;
  const nonEmptySlots: SlotSnapshot[] = [];
  const slotErrors: SlotError[] = [];

  for (let slot = 0; slot < size; slot++) {
    let item;
    try {
      item = container.getItem(slot);
    } catch (error) {
      slotErrors.push({ slot, reason: errorText(error) });
      continue;
    }
    if (!item) continue;
    nonEmptySlots.push({ slot, typeId: item.typeId, amount: item.amount });
  }

  return {
    size,
    emptySlotsCount,
    nonEmptySlots,
    countedNonEmpty: nonEmptySlots.length,
    slotErrors,
  };
}
