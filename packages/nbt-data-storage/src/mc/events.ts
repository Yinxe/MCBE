// ── 存储事件（自定义事件，可订阅可触发） ─────────────────────────────
// 复用 @yinxe/toolkit 的 EventSignal（纯 TS，跨模组一致语义：subscribe/unsubscribe/trigger）。
// 深路径导入 events 模块（不经过 toolkit 的 index 入口，避免其顶层副作用/重构干扰）。
// 事件负载只用可序列化的 string/number，不携带 MC 对象（ItemStack 等）。
// 用法（消费模组）：
//   ItemStorage.events.stored.subscribe(({ regionId, slotId, itemTypeId }) => { ... });
import { EventSignal } from "@yinxe/toolkit/src/events";

/** 存入成功事件 */
export interface ItemStoredEvent {
  regionId: string;
  slotId: number;
  /** 物品类型 ID（如 `minecraft:diamond_sword`） */
  itemTypeId?: string;
  /** 数量 */
  stackSize?: number;
}

/** 取走成功事件（take） */
export interface ItemTakenEvent {
  regionId: string;
  slotId: number;
  /** 物品类型 ID */
  itemTypeId?: string;
}

/** 移除成功事件（remove） */
export interface ItemRemovedEvent {
  regionId: string;
  slotId: number;
}

/** 存储事件总线（存入/取走/移除） */
export const ItemStorageEvents = {
  /** 物品成功存入区域后触发 */
  stored: new EventSignal<ItemStoredEvent>(),
  /** 物品成功取走后触发 */
  taken: new EventSignal<ItemTakenEvent>(),
  /** 物品成功移除后触发 */
  removed: new EventSignal<ItemRemovedEvent>(),
};
