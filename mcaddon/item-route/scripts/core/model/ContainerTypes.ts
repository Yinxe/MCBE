// ─── 容器类型判定（纯数据，零 MC 依赖，可单测） ──────────────
// 本 addon 的"容器白名单"（v1 沉淀）：只认箱子/陷阱箱/桶/漏斗/17 种潜影盒，
// 其余方块一律不参与扫描与路由，避免误纳意外方块。
// 漏斗（hopper）特殊：角色强制 input（工厂层），且默认"仅作输入源"。
/** 全部 17 种潜影盒类型 ID（16 染色 + 1 未染色） */
export const SHULKER_BOX_IDS = new Set([
  "minecraft:undyed_shulker_box",
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

/** 箱子/陷阱箱：可双箱合并的类型 */
export function isChestType(typeId: string): boolean {
  return typeId === "minecraft:chest" || typeId === "minecraft:trapped_chest";
}

/** 漏斗：只能作为输入容器（input），默认禁用 */
export function isHopperType(typeId: string): boolean {
  return typeId === "minecraft:hopper";
}

/** 是否为本 addon 支持的容器类型 */
export function isSupportedContainerType(typeId: string): boolean {
  return isChestType(typeId) || isHopperType(typeId) || typeId === "minecraft:barrel" || SHULKER_BOX_IDS.has(typeId);
}
