// ─── 概念级容器 ──────────────────────────────────────────
import type { ItemStack } from "./ItemStack";
import type { ContainerId, ItemId, Location } from "./types";

/** 容器角色 */
export type ContainerRole = "input" | "single" | "multi" | "misc";

/** 概念级容器：不感知 MC，由适配层实现 */
export interface Container {
  readonly id: ContainerId;
  role: ContainerRole;
  enabled: boolean;
  /** 路由排序优先级，数字越小越先（默认 10） */
  priority: number;
  readonly capacity: number;
  /** O(1) 空槽数（adapter 委托 MC 属性，零遍历） */
  readonly emptySlotsCount: number;
  readonly usedSlots: number;
  /** 逻辑容器全部方块坐标（大箱子 = primary + 附属） */
  readonly occupiedLocations: Location[];
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
  /** 尝试放入；返回剩余（未放入部分），全部放入返回 undefined */
  addItem(stack: ItemStack): ItemStack | undefined;
  /** 单物绑定：由首个非空 slot 物品推导（core 纯函数 deriveBinding 实现） */
  getDedicatedItemId(): ItemId | undefined;
}