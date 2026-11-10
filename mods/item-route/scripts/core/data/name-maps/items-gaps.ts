/**
 * 补丁 nameMap —— 填补颜色/木类变体被各分类脚本遗漏的翻译。
 *
 * 这些物品本应由 colors/woods 管理器覆盖，但因 zh_CN.json 的 key 命名
 * 与脚本预期模式不符而被漏掉。手动逐条抄写补齐。
 *
 * 数据来源：zh_CN.json，key 以 @minecraft/vanilla-data MinecraftItemTypes 为准。
 */

import type { ItemNameMap } from "./types";

const itemsGaps: ItemNameMap = {
  // ── 16 色羊毛 ──────────────────────────────────────────
  "minecraft:white_wool": "白色羊毛",
  "minecraft:orange_wool": "橙色羊毛",
  "minecraft:magenta_wool": "品红色羊毛",
  "minecraft:light_blue_wool": "淡蓝色羊毛",
  "minecraft:yellow_wool": "黄色羊毛",
  "minecraft:lime_wool": "黄绿色羊毛",
  "minecraft:pink_wool": "粉红色羊毛",
  "minecraft:gray_wool": "灰色羊毛",
  "minecraft:light_gray_wool": "淡灰色羊毛",
  "minecraft:cyan_wool": "青色羊毛",
  "minecraft:purple_wool": "紫色羊毛",
  "minecraft:blue_wool": "蓝色羊毛",
  "minecraft:brown_wool": "棕色羊毛",
  "minecraft:green_wool": "绿色羊毛",
  "minecraft:red_wool": "红色羊毛",
  "minecraft:black_wool": "黑色羊毛",

  // ── 16 色地毯 ──────────────────────────────────────────
  "minecraft:white_carpet": "白色地毯",
  "minecraft:orange_carpet": "橙色地毯",
  "minecraft:magenta_carpet": "品红色地毯",
  "minecraft:light_blue_carpet": "淡蓝色地毯",
  "minecraft:yellow_carpet": "黄色地毯",
  "minecraft:lime_carpet": "黄绿色地毯",
  "minecraft:pink_carpet": "粉红色地毯",
  "minecraft:gray_carpet": "灰色地毯",
  "minecraft:light_gray_carpet": "淡灰色地毯",
  "minecraft:cyan_carpet": "青色地毯",
  "minecraft:purple_carpet": "紫色地毯",
  "minecraft:blue_carpet": "蓝色地毯",
  "minecraft:brown_carpet": "棕色地毯",
  "minecraft:green_carpet": "绿色地毯",
  "minecraft:red_carpet": "红色地毯",
  "minecraft:black_carpet": "黑色地毯",

  // ── 16 色混凝土粉末 ─────────────────────────────────────
  "minecraft:white_concrete_powder": "白色混凝土粉末",
  "minecraft:orange_concrete_powder": "橙色混凝土粉末",
  "minecraft:magenta_concrete_powder": "品红色混凝土粉末",
  "minecraft:light_blue_concrete_powder": "淡蓝色混凝土粉末",
  "minecraft:yellow_concrete_powder": "黄色混凝土粉末",
  "minecraft:lime_concrete_powder": "黄绿色混凝土粉末",
  "minecraft:pink_concrete_powder": "粉红色混凝土粉末",
  "minecraft:gray_concrete_powder": "灰色混凝土粉末",
  "minecraft:light_gray_concrete_powder": "淡灰色混凝土粉末",
  "minecraft:cyan_concrete_powder": "青色混凝土粉末",
  "minecraft:purple_concrete_powder": "紫色混凝土粉末",
  "minecraft:blue_concrete_powder": "蓝色混凝土粉末",
  "minecraft:brown_concrete_powder": "棕色混凝土粉末",
  "minecraft:green_concrete_powder": "绿色混凝土粉末",
  "minecraft:red_concrete_powder": "红色混凝土粉末",
  "minecraft:black_concrete_powder": "黑色混凝土粉末",

  // ── 16 色染料 ──────────────────────────────────────────
  // 注：black/white/blue/brown 在 zh_CN 中对应现实染料名（墨囊/骨粉/青金石/可可豆），
  // 其余为纯粹的颜色名
  "minecraft:black_dye": "墨囊",
  "minecraft:red_dye": "红色染料",
  "minecraft:green_dye": "绿色染料",
  "minecraft:brown_dye": "棕色染料",
  "minecraft:blue_dye": "青金石",
  "minecraft:purple_dye": "紫色染料",
  "minecraft:cyan_dye": "青色染料",
  "minecraft:light_gray_dye": "淡灰色染料",
  "minecraft:gray_dye": "灰色染料",
  "minecraft:pink_dye": "粉红色染料",
  "minecraft:lime_dye": "黄绿色染料",
  "minecraft:yellow_dye": "黄色染料",
  "minecraft:light_blue_dye": "淡蓝色染料",
  "minecraft:magenta_dye": "品红色染料",
  "minecraft:orange_dye": "橙色染料",
  "minecraft:white_dye": "白色染料",

  // ── light_blue/light_gray 修正（zh_CN 用 camelCase 键） ──
  "minecraft:light_blue_concrete": "淡蓝色混凝土",
  "minecraft:light_blue_terracotta": "淡蓝色陶瓦",
  "minecraft:light_blue_glazed_terracotta": "淡蓝色带釉陶瓦",
  "minecraft:light_gray_concrete": "淡灰色混凝土",
  "minecraft:light_gray_terracotta": "淡灰色陶瓦",
  "minecraft:light_gray_stained_glass": "淡灰色玻璃",
  "minecraft:light_gray_stained_glass_pane": "淡灰色玻璃板",

  // ── 各色木头栅栏（zh_CN 用 tile.xxx_fence.name 模式） ───
  "minecraft:acacia_fence": "金合欢木栅栏",
  "minecraft:birch_fence": "白桦木栅栏",
  "minecraft:dark_oak_fence": "深色橡木栅栏",
  "minecraft:jungle_fence": "丛林木栅栏",
  "minecraft:spruce_fence": "云杉木栅栏",
};

export default itemsGaps;
export { itemsGaps };
