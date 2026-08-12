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

/** 新建木桶事件（put 物化新桶时触发；扩容可见性） */
export interface BarrelCreatedEvent {
  regionId: string;
  x: number;
  y: number;
  z: number;
}

/** 巡检重建损坏木桶后触发（阵列坐标内任何非木桶方块一律重建覆盖） */
export interface BarrelRestoredEvent {
  regionId: string;
  /** 触发事件的重建槽位（同桶多槽多次触发，created 仅首个） */
  slotId: number;
  /** 纵向层号 */
  level: number;
  /** 层内木桶序号 0..255 */
  barrelInLevel: number;
}

/**
 * 巡检确认丢失事件（桶级，v3 无逐槽空洞登记）：
 * - barrel-destroyed=桶损坏重建后该桶全部占用丢失；
 * - taken-externally=外部取走，桶计数与实际占用差额。
 * 消费方（如凭据索引）可按桶范围清理自己的记录。
 */
export interface ItemLostEvent {
  regionId: string;
  /** 纵向层号 */
  level: number;
  /** 层内木桶序号 0..255 */
  barrelInLevel: number;
  /** 该桶确认丢失的物品件数 */
  count: number;
  kind: "barrel-destroyed" | "taken-externally";
}

/** 原位覆写事件（overwrite：指定槽位替换，slotId 不变，旧物已返回调用方） */
export interface ItemOverwrittenEvent {
  regionId: string;
  slotId: number;
  oldTypeId?: string;
  newTypeId?: string;
}

/** 存储事件总线（存入/取走/移除/覆写/建桶/巡检修复/丢失） */
export const ItemStorageEvents = {
  /** 物品成功存入区域后触发 */
  stored: new EventSignal<ItemStoredEvent>(),
  /** 物品成功取走后触发 */
  taken: new EventSignal<ItemTakenEvent>(),
  /** 物品成功移除后触发 */
  removed: new EventSignal<ItemRemovedEvent>(),
  /** 原位覆写成功后触发（slotId 不变，旧物已返回调用方） */
  overwritten: new EventSignal<ItemOverwrittenEvent>(),
  /** put 物化新木桶后触发（扩容可见） */
  barrelCreated: new EventSignal<BarrelCreatedEvent>(),
  /** 巡检重建损坏木桶后触发（阵列坐标内任何非木桶方块一律重建覆盖） */
  barrelRestored: new EventSignal<BarrelRestoredEvent>(),
  /** 巡检确认物品丢失后触发（桶损坏/外部取走） */
  itemLost: new EventSignal<ItemLostEvent>(),
};
