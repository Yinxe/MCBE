// ─── 路由候选共享辅助（toCandidate / 内容判定） ──
// 供各策略复用，与策略逻辑解耦：策略只做"哪些容器可作候选"，候选的排序字段/类型级
// 内容判定在这里收敛。
import type { Container } from "../model/Container";
import type { CandidateContainer } from "./RouteStrategy";
import type { ItemId } from "../model/types";
import { familyOf } from "../data/item-families";

/** 包装容器为排序候选（usageRatio = usedSlots/capacity，isFull = 无空槽） */
export function toCandidate(container: Container): CandidateContainer {
  const ratio = container.capacity > 0 ? container.usedSlots / container.capacity : 1;
  return {
    container,
    priority: container.priority,
    usageRatio: ratio,
    isFull: container.emptySlotsCount === 0,
  };
}

/** 容器是否已**失联**（底层方块失效，isLost 实现侧会顺带探测同位置恢复）——策略定候选前统一判定 */
export function containerIsLost(container: Container): boolean {
  return container.isLost?.() === true;
}

/** 容器是否已存在给定**类型**的槽（typeId 级，非 NBT 精确——多物候选判定用）。
 * 优先容器原生 O(1) 判定（`hasItemType` → native `contains` 快判）：true=命中确定、false=空容器确定，
 * 均直接返回；**undefined = 原生未命中不可信（NBT/data 差异假阴性）或原生失效** → 此处线性遍历兜底查物。 */
export function hasItemType(container: Container, itemId: ItemId): boolean {
  const fast = container.hasItemType?.(itemId);
  if (fast !== undefined) return fast;
  for (let i = 0; i < container.capacity; i++) {
    if (container.getItem(i)?.itemId === itemId) return true;
  }
  return false;
}

/** 容器是否已含某族的任一成员（typeId → familyOf 精确判断，族路由惰性校验用） */
export function containerHasFamilyMember(container: Container, familyId: string): boolean {
  for (let i = 0; i < container.capacity; i++) {
    const id = container.getItem(i)?.itemId;
    if (id !== undefined && familyOf(id) === familyId) return true;
  }
  return false;
}