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

/** 容器是否已存在给定**类型**的槽（typeId 级，非 NBT 精确——多物候选判定用） */
export function hasItemType(container: Container, itemId: ItemId): boolean {
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