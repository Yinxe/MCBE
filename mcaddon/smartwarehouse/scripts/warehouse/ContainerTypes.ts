import type { Block } from "@minecraft/server";

/**
 * 所有支持颜色的潜影盒类型 ID 集合。
 * 原版 Minecraft 共有 16 种染色潜影盒 + 1 种未染色潜影盒。
 * 用于在扫描容器时快速判断方块是否为潜影盒。
 */
const SHULKER_BOX_IDS = new Set([
  "minecraft:shulker_box",
  "minecraft:white_shulker_box",
  "minecraft:orange_shulker_box",
  "minecraft:magenta_shulker_box",
  "minecraft:light_blue_shulker_box",
  "minecraft:yellow_shulker_box",
  "minecraft:lime_shulker_box",
  "minecraft:pink_shulker_box",
  "minecraft:gray_shulker_box",
  "minecraft:light_gray_shulker_box",
  "minecraft:cyan_shulker_box",
  "minecraft:purple_shulker_box",
  "minecraft:blue_shulker_box",
  "minecraft:brown_shulker_box",
  "minecraft:green_shulker_box",
  "minecraft:red_shulker_box",
  "minecraft:black_shulker_box",
]);

/**
 * 判断给定的方块类型 ID 是否为箱子或陷阱箱。
 * 箱子是大箱子（双箱）检测逻辑的关键类型，
 * 只有这两种箱子才需要在扫描时检查相邻方块以合并为双箱。
 *
 * @param typeId 方块类型 ID，例如 "minecraft:chest"
 * @returns 如果是箱子或陷阱箱，返回 true
 */
export function isChestType(typeId: string): boolean {
  return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest";
}

/**
 * 判断给定方块类型 ID 是否为智能仓库支持的容器类型。
 * 当前支持的容器类型包括：箱子、陷阱箱、桶以及所有颜色的潜影盒。
 * 该函数是扫描过滤的第一步，不符合的方块会直接被跳过。
 *
 * @param typeId 方块类型 ID
 * @returns 如果是支持的容器类型，返回 true
 */
export function isSupportedContainerType(typeId: string): boolean {
  return isChestType(typeId) || typeId === "minecraft:barrel" || SHULKER_BOX_IDS.has(typeId);
}

/**
 * 检查方块是否真正拥有物品栏（inventory）组件。
 * 某些方块虽然类型 ID 匹配容器，但可能因损坏或其他原因缺少物品栏组件。
 * 该函数通过查询 "@minecraft/server" 的 inventory 组件来确认。
 *
 * @param block 要检查的方块对象
 * @returns 如果方块拥有 inventory 组件，返回 true
 */
export function hasInventory(block: Block): boolean {
  return Boolean(block.getComponent("inventory"));
}
