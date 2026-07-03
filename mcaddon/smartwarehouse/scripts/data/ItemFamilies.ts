/**
 * ============================================================================
 * ItemFamilies —— 家庭成员分类数据
 * ============================================================================
 *
 * 所有分类均为模组预定义，玩家可在仓库设置中选择启用/禁用。
 * 每个物品最多属于一个家族，确保分类互斥。
 *
 * 由 tools/generateItemFamilies.mjs 自动生成，勿手动修改。
 * ============================================================================
 */

// ─── 类型 ───────────────────────────────────────────────────────

export interface ItemFamily {
  /** 族 ID，用于持久化配置和索引 key */
  id: string;
  /** 中文显示名，用于 UI */
  displayName: string;
  /** 该族包含的所有物品 typeId */
  items: readonly string[];
}

// ─── 家族定义 ─────────────────────────────────────────────────

const wool: ItemFamily = {
  id: "wool",
  displayName: "羊毛",
  items: [
    "minecraft:white_wool", // 白色羊毛
    "minecraft:orange_wool", // 橙色羊毛
    "minecraft:magenta_wool", // 品红色羊毛
    "minecraft:light_blue_wool", // 淡蓝色羊毛
    "minecraft:yellow_wool", // 黄色羊毛
    "minecraft:lime_wool", // 黄绿色羊毛
    "minecraft:pink_wool", // 粉红色羊毛
    "minecraft:gray_wool", // 灰色羊毛
    "minecraft:light_gray_wool", // 淡灰色羊毛
    "minecraft:cyan_wool", // 青色羊毛
    "minecraft:purple_wool", // 紫色羊毛
    "minecraft:blue_wool", // 蓝色羊毛
    "minecraft:brown_wool", // 棕色羊毛
    "minecraft:green_wool", // 绿色羊毛
    "minecraft:red_wool", // 红色羊毛
    "minecraft:black_wool", // 黑色羊毛
  ],
};

const carpet: ItemFamily = {
  id: "carpet",
  displayName: "地毯",
  items: [
    "minecraft:white_carpet", // 白色地毯
    "minecraft:orange_carpet", // 橙色地毯
    "minecraft:magenta_carpet", // 品红色地毯
    "minecraft:light_blue_carpet", // 淡蓝色地毯
    "minecraft:yellow_carpet", // 黄色地毯
    "minecraft:lime_carpet", // 黄绿色地毯
    "minecraft:pink_carpet", // 粉红色地毯
    "minecraft:gray_carpet", // 灰色地毯
    "minecraft:light_gray_carpet", // 淡灰色地毯
    "minecraft:cyan_carpet", // 青色地毯
    "minecraft:purple_carpet", // 紫色地毯
    "minecraft:blue_carpet", // 蓝色地毯
    "minecraft:brown_carpet", // 棕色地毯
    "minecraft:green_carpet", // 绿色地毯
    "minecraft:red_carpet", // 红色地毯
    "minecraft:black_carpet", // 黑色地毯
  ],
};

const stained_glass: ItemFamily = {
  id: "stained_glass",
  displayName: "玻璃",
  items: [
    "minecraft:white_stained_glass", // 白色玻璃
    "minecraft:orange_stained_glass", // 橙色玻璃
    "minecraft:magenta_stained_glass", // 品红色玻璃
    "minecraft:light_blue_stained_glass", // 淡蓝色玻璃
    "minecraft:yellow_stained_glass", // 黄色玻璃
    "minecraft:lime_stained_glass", // 黄绿色玻璃
    "minecraft:pink_stained_glass", // 粉红色玻璃
    "minecraft:gray_stained_glass", // 灰色玻璃
    "minecraft:light_gray_stained_glass", // 淡灰色玻璃
    "minecraft:cyan_stained_glass", // 青色玻璃
    "minecraft:purple_stained_glass", // 紫色玻璃
    "minecraft:blue_stained_glass", // 蓝色玻璃
    "minecraft:brown_stained_glass", // 棕色玻璃
    "minecraft:green_stained_glass", // 绿色玻璃
    "minecraft:red_stained_glass", // 红色玻璃
    "minecraft:black_stained_glass", // 黑色玻璃
    "minecraft:white_stained_glass_pane", // 白色玻璃板
    "minecraft:orange_stained_glass_pane", // 橙色玻璃板
    "minecraft:magenta_stained_glass_pane", // 品红色玻璃板
    "minecraft:light_blue_stained_glass_pane", // 淡蓝色玻璃板
    "minecraft:yellow_stained_glass_pane", // 黄色玻璃板
    "minecraft:lime_stained_glass_pane", // 黄绿色玻璃板
    "minecraft:pink_stained_glass_pane", // 粉红色玻璃板
    "minecraft:gray_stained_glass_pane", // 灰色玻璃板
    "minecraft:light_gray_stained_glass_pane", // 淡灰色玻璃板
    "minecraft:cyan_stained_glass_pane", // 青色玻璃板
    "minecraft:purple_stained_glass_pane", // 紫色玻璃板
    "minecraft:blue_stained_glass_pane", // 蓝色玻璃板
    "minecraft:brown_stained_glass_pane", // 棕色玻璃板
    "minecraft:green_stained_glass_pane", // 绿色玻璃板
    "minecraft:red_stained_glass_pane", // 红色玻璃板
    "minecraft:black_stained_glass_pane", // 黑色玻璃板
    "minecraft:glass", // 玻璃
    "minecraft:glass_pane", // 玻璃板
    "minecraft:tinted_glass", // 遮光玻璃
  ],
};

const concrete: ItemFamily = {
  id: "concrete",
  displayName: "混凝土",
  items: [
    "minecraft:white_concrete", // 白色混凝土
    "minecraft:orange_concrete", // 橙色混凝土
    "minecraft:magenta_concrete", // 品红色混凝土
    "minecraft:light_blue_concrete", // 淡蓝色混凝土
    "minecraft:yellow_concrete", // 黄色混凝土
    "minecraft:lime_concrete", // 黄绿色混凝土
    "minecraft:pink_concrete", // 粉红色混凝土
    "minecraft:gray_concrete", // 灰色混凝土
    "minecraft:light_gray_concrete", // 淡灰色混凝土
    "minecraft:cyan_concrete", // 青色混凝土
    "minecraft:purple_concrete", // 紫色混凝土
    "minecraft:blue_concrete", // 蓝色混凝土
    "minecraft:brown_concrete", // 棕色混凝土
    "minecraft:green_concrete", // 绿色混凝土
    "minecraft:red_concrete", // 红色混凝土
    "minecraft:black_concrete", // 黑色混凝土
  ],
};

const concrete_powder: ItemFamily = {
  id: "concrete_powder",
  displayName: "混凝土粉末",
  items: [
    "minecraft:white_concrete_powder", // 白色混凝土粉末
    "minecraft:orange_concrete_powder", // 橙色混凝土粉末
    "minecraft:magenta_concrete_powder", // 品红色混凝土粉末
    "minecraft:light_blue_concrete_powder", // 淡蓝色混凝土粉末
    "minecraft:yellow_concrete_powder", // 黄色混凝土粉末
    "minecraft:lime_concrete_powder", // 黄绿色混凝土粉末
    "minecraft:pink_concrete_powder", // 粉红色混凝土粉末
    "minecraft:gray_concrete_powder", // 灰色混凝土粉末
    "minecraft:light_gray_concrete_powder", // 淡灰色混凝土粉末
    "minecraft:cyan_concrete_powder", // 青色混凝土粉末
    "minecraft:purple_concrete_powder", // 紫色混凝土粉末
    "minecraft:blue_concrete_powder", // 蓝色混凝土粉末
    "minecraft:brown_concrete_powder", // 棕色混凝土粉末
    "minecraft:green_concrete_powder", // 绿色混凝土粉末
    "minecraft:red_concrete_powder", // 红色混凝土粉末
    "minecraft:black_concrete_powder", // 黑色混凝土粉末
  ],
};

const terracotta: ItemFamily = {
  id: "terracotta",
  displayName: "陶瓦",
  items: [
    "minecraft:white_terracotta", // 白色陶瓦
    "minecraft:orange_terracotta", // 橙色陶瓦
    "minecraft:magenta_terracotta", // 品红色陶瓦
    "minecraft:light_blue_terracotta", // 淡蓝色陶瓦
    "minecraft:yellow_terracotta", // 黄色陶瓦
    "minecraft:lime_terracotta", // 黄绿色陶瓦
    "minecraft:pink_terracotta", // 粉红色陶瓦
    "minecraft:gray_terracotta", // 灰色陶瓦
    "minecraft:light_gray_terracotta", // 淡灰色陶瓦
    "minecraft:cyan_terracotta", // 青色陶瓦
    "minecraft:purple_terracotta", // 紫色陶瓦
    "minecraft:blue_terracotta", // 蓝色陶瓦
    "minecraft:brown_terracotta", // 棕色陶瓦
    "minecraft:green_terracotta", // 绿色陶瓦
    "minecraft:red_terracotta", // 红色陶瓦
    "minecraft:black_terracotta", // 黑色陶瓦
    "minecraft:hardened_clay", // 陶瓦
  ],
};

const glazed_terracotta: ItemFamily = {
  id: "glazed_terracotta",
  displayName: "带釉陶瓦",
  items: [
    "minecraft:white_glazed_terracotta", // 白色带釉陶瓦
    "minecraft:orange_glazed_terracotta", // 橙色带釉陶瓦
    "minecraft:magenta_glazed_terracotta", // 品红色带釉陶瓦
    "minecraft:light_blue_glazed_terracotta", // 淡蓝色带釉陶瓦
    "minecraft:yellow_glazed_terracotta", // 黄色带釉陶瓦
    "minecraft:lime_glazed_terracotta", // 黄绿色带釉陶瓦
    "minecraft:pink_glazed_terracotta", // 粉红色带釉陶瓦
    "minecraft:gray_glazed_terracotta", // 灰色带釉陶瓦
    "minecraft:light_gray_glazed_terracotta",
    "minecraft:cyan_glazed_terracotta", // 青色带釉陶瓦
    "minecraft:purple_glazed_terracotta", // 紫色带釉陶瓦
    "minecraft:blue_glazed_terracotta", // 蓝色带釉陶瓦
    "minecraft:brown_glazed_terracotta", // 棕色带釉陶瓦
    "minecraft:green_glazed_terracotta", // 绿色带釉陶瓦
    "minecraft:red_glazed_terracotta", // 红色带釉陶瓦
    "minecraft:black_glazed_terracotta", // 黑色带釉陶瓦
    "minecraft:silver_glazed_terracotta", // Silver Glazed Terracotta
  ],
};

const shulker_box: ItemFamily = {
  id: "shulker_box",
  displayName: "潜影盒",
  items: [
    "minecraft:white_shulker_box", // 白色潜影盒
    "minecraft:orange_shulker_box", // 橙色潜影盒
    "minecraft:magenta_shulker_box", // 品红色潜影盒
    "minecraft:light_blue_shulker_box", // 淡蓝色潜影盒
    "minecraft:yellow_shulker_box", // 黄色潜影盒
    "minecraft:lime_shulker_box", // 黄绿色潜影盒
    "minecraft:pink_shulker_box", // 粉红色潜影盒
    "minecraft:gray_shulker_box", // 灰色潜影盒
    "minecraft:light_gray_shulker_box", // 淡灰色潜影盒
    "minecraft:cyan_shulker_box", // 青色潜影盒
    "minecraft:purple_shulker_box", // 紫色潜影盒
    "minecraft:blue_shulker_box", // 蓝色潜影盒
    "minecraft:brown_shulker_box", // 棕色潜影盒
    "minecraft:green_shulker_box", // 绿色潜影盒
    "minecraft:red_shulker_box", // 红色潜影盒
    "minecraft:black_shulker_box", // 黑色潜影盒
    "minecraft:undyed_shulker_box", // 潜影盒
  ],
};

const candle: ItemFamily = {
  id: "candle",
  displayName: "蜡烛",
  items: [
    "minecraft:white_candle", // 白色蜡烛
    "minecraft:orange_candle", // 橙色蜡烛
    "minecraft:magenta_candle", // 品红色蜡烛
    "minecraft:light_blue_candle", // 淡蓝色蜡烛
    "minecraft:yellow_candle", // 黄色蜡烛
    "minecraft:lime_candle", // 黄绿色蜡烛
    "minecraft:pink_candle", // 粉红色蜡烛
    "minecraft:gray_candle", // 灰色蜡烛
    "minecraft:light_gray_candle", // 淡灰色蜡烛
    "minecraft:cyan_candle", // 青色蜡烛
    "minecraft:purple_candle", // 紫色蜡烛
    "minecraft:blue_candle", // 蓝色蜡烛
    "minecraft:brown_candle", // 棕色蜡烛
    "minecraft:green_candle", // 绿色蜡烛
    "minecraft:red_candle", // 红色蜡烛
    "minecraft:black_candle", // 黑色蜡烛
    "minecraft:candle", // 蜡烛
  ],
};

const dye: ItemFamily = {
  id: "dye",
  displayName: "染料",
  items: [
    "minecraft:white_dye", // 白色染料
    "minecraft:orange_dye", // 橙色染料
    "minecraft:magenta_dye", // 品红色染料
    "minecraft:light_blue_dye", // 淡蓝色染料
    "minecraft:yellow_dye", // 黄色染料
    "minecraft:lime_dye", // 黄绿色染料
    "minecraft:pink_dye", // 粉红色染料
    "minecraft:gray_dye", // 灰色染料
    "minecraft:light_gray_dye", // 淡灰色染料
    "minecraft:cyan_dye", // 青色染料
    "minecraft:purple_dye", // 紫色染料
    "minecraft:blue_dye", // 青金石
    "minecraft:brown_dye", // 棕色染料
    "minecraft:green_dye", // 绿色染料
    "minecraft:red_dye", // 红色染料
    "minecraft:black_dye", // 墨囊
    "minecraft:lapis_lazuli", // 青金石
  ],
};

const animal_gear: ItemFamily = {
  id: "animal_gear", // 马铠/鞍/挽具/胡萝卜钓竿/诡异菌钓竿/拴绳等骑乘与驾驭 
  displayName: "骑乘与驾驭",
  items: [
    "minecraft:leather_horse_armor", // 皮革马铠
    "minecraft:iron_horse_armor", // 铁马铠
    "minecraft:golden_horse_armor", // Golden Horse Armor
    "minecraft:diamond_horse_armor", // 钻石马铠
    "minecraft:saddle", // 鞍
    "minecraft:white_harness", // 白色挽具
    "minecraft:orange_harness", // 橙色挽具
    "minecraft:magenta_harness", // 品红色挽具
    "minecraft:light_blue_harness", // 淡蓝色挽具
    "minecraft:yellow_harness", // 黄色挽具
    "minecraft:lime_harness", // 黄绿色挽具
    "minecraft:pink_harness", // 粉红色挽具
    "minecraft:gray_harness", // 灰色挽具
    "minecraft:light_gray_harness", // 淡灰色挽具
    "minecraft:cyan_harness", // 青色挽具
    "minecraft:purple_harness", // 紫色挽具
    "minecraft:blue_harness", // 蓝色挽具
    "minecraft:brown_harness", // 棕色挽具
    "minecraft:green_harness", // 绿色挽具
    "minecraft:red_harness", // 红色挽具
    "minecraft:black_harness", // 黑色挽具
    "minecraft:carrot_on_a_stick", // 胡萝卜钓竿
    "minecraft:warped_fungus_on_a_stick", // 诡异真菌钓竿
    "minecraft:lead", // 拴绳
  ],
};

const bundle: ItemFamily = {
  id: "bundle",
  displayName: "同捆包",
  items: [
    "minecraft:white_bundle", // White Bundle
    "minecraft:orange_bundle", // Orange Bundle
    "minecraft:magenta_bundle", // Magenta Bundle
    "minecraft:light_blue_bundle", // Light Blue Bundle
    "minecraft:yellow_bundle", // Yellow Bundle
    "minecraft:lime_bundle", // Lime Bundle
    "minecraft:pink_bundle", // Pink Bundle
    "minecraft:gray_bundle", // Gray Bundle
    "minecraft:light_gray_bundle", // Light Gray Bundle
    "minecraft:cyan_bundle", // Cyan Bundle
    "minecraft:purple_bundle", // Purple Bundle
    "minecraft:blue_bundle", // Blue Bundle
    "minecraft:brown_bundle", // Brown Bundle
    "minecraft:green_bundle", // Green Bundle
    "minecraft:red_bundle", // Red Bundle
    "minecraft:black_bundle", // Black Bundle
    "minecraft:bundle", // 同捆包
  ],
};

const bed: ItemFamily = {
  id: "bed",
  displayName: "床",
  items: [
    "minecraft:white_bed",
    "minecraft:orange_bed",
    "minecraft:magenta_bed",
    "minecraft:light_blue_bed",
    "minecraft:yellow_bed",
    "minecraft:lime_bed",
    "minecraft:pink_bed",
    "minecraft:gray_bed",
    "minecraft:light_gray_bed",
    "minecraft:cyan_bed",
    "minecraft:purple_bed",
    "minecraft:blue_bed",
    "minecraft:brown_bed",
    "minecraft:green_bed",
    "minecraft:red_bed",
    "minecraft:black_bed",
  ],
};

const logs: ItemFamily = {
  id: "logs",
  displayName: "原木/菌柄",
  items: [
    "minecraft:oak_log", // 橡树原木
    "minecraft:oak_wood", // 橡木
    "minecraft:stripped_oak_log", // 去皮橡木
    "minecraft:stripped_oak_wood", // 去皮橡木
    "minecraft:spruce_log", // 云杉原木
    "minecraft:spruce_wood", // 云杉木
    "minecraft:stripped_spruce_log", // 去皮云杉木
    "minecraft:stripped_spruce_wood", // 去皮云杉木
    "minecraft:birch_log", // 桦树原木
    "minecraft:birch_wood", // 白桦木
    "minecraft:stripped_birch_log", // 去皮白桦木
    "minecraft:stripped_birch_wood", // 去皮白桦木
    "minecraft:jungle_log", // 丛林原木
    "minecraft:jungle_wood", // 丛林木
    "minecraft:stripped_jungle_log", // 去皮丛林木
    "minecraft:stripped_jungle_wood", // 去皮丛林木
    "minecraft:acacia_log", // 金合欢原木
    "minecraft:acacia_wood", // 金合欢木
    "minecraft:stripped_acacia_log", // 去皮金合欢木
    "minecraft:stripped_acacia_wood", // 去皮金合欢木
    "minecraft:dark_oak_log", // 深色橡树原木
    "minecraft:dark_oak_wood", // 深色橡木
    "minecraft:stripped_dark_oak_log", // 去皮深色橡木
    "minecraft:stripped_dark_oak_wood", // 去皮深色橡木
    "minecraft:mangrove_log", // 红树木原木
    "minecraft:mangrove_wood", // 红树木木材
    "minecraft:stripped_mangrove_log", // 去皮红树木原木
    "minecraft:stripped_mangrove_wood", // 去皮红树木木材
    "minecraft:cherry_log", // 樱花原木
    "minecraft:cherry_wood", // 樱花木
    "minecraft:stripped_cherry_log", // 去皮樱花原木
    "minecraft:stripped_cherry_wood", // 去皮樱花木
    "minecraft:pale_oak_log", // 苍白橡树原木
    "minecraft:pale_oak_wood", // 苍白橡木
    "minecraft:stripped_pale_oak_log", // 去皮苍白橡树原木
    "minecraft:stripped_pale_oak_wood", // 去皮苍白橡木
    "minecraft:crimson_stem", // 绯红菌柄
    "minecraft:crimson_hyphae", // 绯红菌核
    "minecraft:stripped_crimson_stem", // 去皮绯红菌柄
    "minecraft:stripped_crimson_hyphae", // 去皮绯红菌核
    "minecraft:warped_stem", // 诡异菌柄
    "minecraft:warped_hyphae", // 诡异菌丝
    "minecraft:stripped_warped_stem", // 去皮诡异菌柄
    "minecraft:stripped_warped_hyphae", // 去皮诡异菌丝
    "minecraft:bamboo_block", // 竹子方块
    "minecraft:stripped_bamboo_block", // 去皮竹块
    "minecraft:creaking_heart", // 嘎枝之心
    "minecraft:mangrove_roots", // 红树木根
    "minecraft:muddy_mangrove_roots", // 沾泥的红树木根
  ],
};

const wood_products: ItemFamily = {
  id: "wood_products",
  displayName: "木制品",
  items: [
    "minecraft:oak_boat", // 橡木船
    "minecraft:oak_chest_boat", // 橡木运输船
    "minecraft:oak_planks", // 橡木板
    "minecraft:oak_slab", // 橡木台阶
    "minecraft:oak_stairs", // 橡木楼梯
    "minecraft:oak_door",
    "minecraft:oak_trapdoor",
    "minecraft:oak_fence_gate",
    "minecraft:oak_sign", // 橡木告示牌
    "minecraft:oak_hanging_sign", // 橡木悬挂告示牌
    "minecraft:oak_button",
    "minecraft:oak_pressure_plate",
    "minecraft:oak_fence", // 橡木栅栏
    "minecraft:spruce_boat", // 云杉木船
    "minecraft:spruce_chest_boat", // 云杉木运输船
    "minecraft:spruce_planks", // 云杉木板
    "minecraft:spruce_slab", // 云杉木台阶
    "minecraft:spruce_stairs", // 云杉木楼梯
    "minecraft:spruce_door", // 云杉木门
    "minecraft:spruce_trapdoor", // 云杉木活板门
    "minecraft:spruce_fence_gate", // 云杉木栅栏门
    "minecraft:spruce_sign", // 云杉木告示牌
    "minecraft:spruce_hanging_sign", // 云杉木悬挂告示牌
    "minecraft:spruce_button", // 云杉木按钮
    "minecraft:spruce_pressure_plate", // 云杉木压力板
    "minecraft:spruce_fence", // 云杉木栅栏
    "minecraft:birch_boat", // 白桦木船
    "minecraft:birch_chest_boat", // 白桦木运输船
    "minecraft:birch_planks", // 白桦木板
    "minecraft:birch_slab", // 白桦木台阶
    "minecraft:birch_stairs", // 白桦木楼梯
    "minecraft:birch_door", // 白桦木门
    "minecraft:birch_trapdoor", // 白桦木活板门
    "minecraft:birch_fence_gate", // 白桦木栅栏门
    "minecraft:birch_sign", // 白桦木告示牌
    "minecraft:birch_hanging_sign", // 白桦木悬挂告示牌
    "minecraft:birch_button", // 白桦木按钮
    "minecraft:birch_pressure_plate", // 白桦木压力板
    "minecraft:birch_fence", // 白桦木栅栏
    "minecraft:jungle_boat", // 丛林木船
    "minecraft:jungle_chest_boat", // 丛林木运输船
    "minecraft:jungle_planks", // 丛林木板
    "minecraft:jungle_slab", // 丛林木台阶
    "minecraft:jungle_stairs", // 丛林木楼梯
    "minecraft:jungle_door", // 丛林木门
    "minecraft:jungle_trapdoor", // 丛林木活板门
    "minecraft:jungle_fence_gate", // 丛林木栅栏门
    "minecraft:jungle_sign", // 丛林木告示牌
    "minecraft:jungle_hanging_sign", // 丛林悬挂告示牌
    "minecraft:jungle_button", // 丛林木按钮
    "minecraft:jungle_pressure_plate", // 丛林木压力板
    "minecraft:jungle_fence", // 丛林木栅栏
    "minecraft:acacia_boat", // 金合欢木船
    "minecraft:acacia_chest_boat", // 金合欢木运输船
    "minecraft:acacia_planks", // 金合欢木板
    "minecraft:acacia_slab", // 金合欢木台阶
    "minecraft:acacia_stairs", // 金合欢木楼梯
    "minecraft:acacia_door", // 金合欢木门
    "minecraft:acacia_trapdoor", // 金合欢木活板门
    "minecraft:acacia_fence_gate", // 金合欢木栅栏门
    "minecraft:acacia_sign", // 金合欢木告示牌
    "minecraft:acacia_hanging_sign", // 金合欢悬挂告示牌
    "minecraft:acacia_button", // 金合欢木按钮
    "minecraft:acacia_pressure_plate", // 金合欢木压力板
    "minecraft:acacia_fence", // 金合欢木栅栏
    "minecraft:dark_oak_boat", // 深色橡木船
    "minecraft:dark_oak_chest_boat", // 深色橡木运输船
    "minecraft:dark_oak_planks", // 深色橡木板
    "minecraft:dark_oak_slab", // 深色橡木台阶
    "minecraft:dark_oak_stairs", // 深色橡木楼梯
    "minecraft:dark_oak_door", // 深色橡木门
    "minecraft:dark_oak_trapdoor", // 深色橡木活板门
    "minecraft:dark_oak_fence_gate", // 深色橡木栅栏门
    "minecraft:dark_oak_sign", // 深色橡木告示牌
    "minecraft:dark_oak_hanging_sign", // 深色橡木悬挂告示牌
    "minecraft:dark_oak_button", // 深色橡木按钮
    "minecraft:dark_oak_pressure_plate", // 深色橡木压力板
    "minecraft:dark_oak_fence", // 深色橡木栅栏
    "minecraft:mangrove_boat", // 红树木船
    "minecraft:mangrove_chest_boat", // 红树木运输船
    "minecraft:mangrove_planks", // 红树木木板
    "minecraft:mangrove_slab", // 红树木台阶
    "minecraft:mangrove_stairs", // 红树木楼梯
    "minecraft:mangrove_door", // 红树木门
    "minecraft:mangrove_trapdoor", // 红树木活板门
    "minecraft:mangrove_fence_gate", // 红树木栅栏大门
    "minecraft:mangrove_sign", // 红树木告示牌
    "minecraft:mangrove_hanging_sign", // 红树林悬挂告示牌
    "minecraft:mangrove_button", // 红树木按钮
    "minecraft:mangrove_pressure_plate", // 红树木压力板
    "minecraft:mangrove_fence", // 红树木栅栏
    "minecraft:cherry_planks", // 樱花木板
    "minecraft:cherry_slab", // 樱花木台阶
    "minecraft:cherry_stairs", // 樱花木楼梯
    "minecraft:cherry_door", // 樱花木门
    "minecraft:cherry_trapdoor", // 樱花木活板门
    "minecraft:cherry_fence_gate", // 樱花木栅栏门
    "minecraft:cherry_sign", // 樱花木告示牌
    "minecraft:cherry_hanging_sign", // 樱花木悬挂告示牌
    "minecraft:cherry_button", // 樱花木按钮
    "minecraft:cherry_pressure_plate", // 樱花木压力板
    "minecraft:cherry_fence", // 樱花木栅栏
    "minecraft:pale_oak_planks", // 苍白橡木木板
    "minecraft:pale_oak_slab", // 苍白橡木台阶
    "minecraft:pale_oak_stairs", // 苍白橡木楼梯
    "minecraft:pale_oak_door", // 苍白橡木门
    "minecraft:pale_oak_trapdoor", // 苍白橡木活板门
    "minecraft:pale_oak_fence_gate", // 苍白橡木栅栏大门
    "minecraft:pale_oak_sign", // 苍白橡木告示牌
    "minecraft:pale_oak_hanging_sign", // 苍白橡木悬挂告示牌
    "minecraft:pale_oak_button", // 苍白橡木按钮
    "minecraft:pale_oak_pressure_plate", // 苍白橡木压力板
    "minecraft:pale_oak_fence", // 苍白橡木栅栏
    "minecraft:fence_gate", // 橡木栅栏门
    "minecraft:trapdoor", // 橡木活板门
    "minecraft:wooden_door", // 橡木门
    "minecraft:wooden_button", // 橡木按钮
    "minecraft:wooden_pressure_plate", // 橡木压力板
    "minecraft:bamboo_planks", // 竹板
    "minecraft:bamboo_slab", // 竹制台阶
    "minecraft:bamboo_stairs", // 竹制楼梯
    "minecraft:bamboo_door", // 竹门
    "minecraft:bamboo_trapdoor", // 竹制活板门
    "minecraft:bamboo_fence", // 竹制围墙
    "minecraft:bamboo_fence_gate", // 竹制围墙大门
    "minecraft:bamboo_sign", // 竹制告示牌
    "minecraft:bamboo_hanging_sign", // 竹制悬挂告示牌
    "minecraft:bamboo_button", // 竹制按钮
    "minecraft:bamboo_pressure_plate", // 竹制压力板
    "minecraft:bamboo_mosaic", // 竹制马赛克
    "minecraft:bamboo_mosaic_slab", // 竹制马赛克台阶
    "minecraft:bamboo_mosaic_stairs", // 竹制马赛克楼梯
    "minecraft:bamboo_raft", // 竹筏
    "minecraft:bamboo_chest_raft", // 竹制运输筏
    "minecraft:pale_oak_boat", // 苍白橡木船
    "minecraft:pale_oak_chest_boat", // 苍白橡树运输船
    "minecraft:cherry_boat", // 樱花木船
    "minecraft:cherry_chest_boat", // 樱花木运输船
    "minecraft:crimson_planks", // 绯红木板
    "minecraft:crimson_slab", // 绯红木台阶
    "minecraft:crimson_stairs", // 绯红木楼梯
    "minecraft:crimson_door", // 绯红木门
    "minecraft:crimson_trapdoor", // 绯红木活板门
    "minecraft:crimson_fence", // 绯红木栅栏
    "minecraft:crimson_fence_gate", // 绯红木栅栏门
    "minecraft:crimson_sign", // 绯红木告示牌
    "minecraft:crimson_hanging_sign", // 绯红木悬挂告示牌
    "minecraft:crimson_button", // 绯红木按钮
    "minecraft:crimson_pressure_plate", // 绯红木压力板
    "minecraft:warped_planks", // 诡异木板
    "minecraft:warped_slab", // 诡异木台阶
    "minecraft:warped_stairs", // 诡异楼梯
    "minecraft:warped_door", // 诡异门
    "minecraft:warped_trapdoor", // 诡异木活板门
    "minecraft:warped_fence", // 诡异木栅栏
    "minecraft:warped_fence_gate", // 诡异木栅栏门
    "minecraft:warped_sign", // 诡异木告示牌
    "minecraft:warped_hanging_sign", // 翘曲悬挂告示牌
    "minecraft:warped_button", // 诡异木按钮
    "minecraft:warped_pressure_plate", // 诡异木压力板
    "minecraft:stick", // 木棍
  ],
};

const wood_misc: ItemFamily = {
  id: "wood_misc",
  displayName: "人工合成物",
  items: [
    "minecraft:ladder", // 梯子
    "minecraft:chest", // 箱子
    "minecraft:barrel", // 木桶
    "minecraft:crafting_table", // 工作台
    "minecraft:cartography_table", // 制图台
    "minecraft:fletching_table", // 制箭台
    "minecraft:smithing_table", // 锻造台
    "minecraft:loom", // 织布机
    "minecraft:grindstone", // 砂轮
    "minecraft:lectern", // 讲台
    "minecraft:jukebox", // 唱片机
    "minecraft:noteblock", // 音符盒
    "minecraft:scaffolding", // 脚手架
    "minecraft:flower_pot", // 花盆
    "minecraft:armor_stand", // 盔甲架
    "minecraft:beehive", // 蜂箱
    "minecraft:bee_nest", // 蜂巢
    "minecraft:bookshelf", // 书架
    "minecraft:chiseled_bookshelf", // 錾制书架
    "minecraft:composter", // 堆肥箱
    "minecraft:campfire", // 营火
    "minecraft:torch", // 火把
    "minecraft:lantern", // 灯
    "minecraft:painting", // 画
    "minecraft:frame", // 物品展示框
    "minecraft:glow_frame", // 荧光物品展示框
    "minecraft:furnace", // 熔炉
    "minecraft:blast_furnace", // 高炉
    "minecraft:smoker", // 烟熏炉
    "minecraft:stonecutter_block", // 切石机
    "minecraft:obsidian", // 黑曜石
    "minecraft:crying_obsidian", // 哭泣的黑曜石
    "minecraft:smooth_stone_slab", // Smooth Stone Slab
  ],
};

const stone_core: ItemFamily = {
  id: "stone_core", // 石头/圆石/石砖/安山岩/闪长岩/花岗岩 + 台阶/楼梯/墙/磨制变体 
  displayName: "普通石材",
  items: [
    "minecraft:stone", // 石头
    "minecraft:smooth_stone", // 平滑石
    "minecraft:cobblestone", // 石砖
    "minecraft:mossy_cobblestone", // 苔石
    "minecraft:stone_bricks", // 石砖
    "minecraft:mossy_stone_bricks", // 苔石砖
    "minecraft:cracked_stone_bricks", // 裂纹石砖
    "minecraft:chiseled_stone_bricks", // 錾制石砖
    "minecraft:stone_stairs", // 圆石楼梯
    "minecraft:normal_stone_stairs", // 石质楼梯
    "minecraft:cobblestone_stairs",
    "minecraft:stone_brick_stairs", // 石砖楼梯
    "minecraft:mossy_cobblestone_stairs", // 苔圆石楼梯
    "minecraft:mossy_stone_brick_stairs", // 苔石砖楼梯
    "minecraft:normal_stone_slab", // Normal Stone Slab
    "minecraft:cobblestone_slab", // 圆石台阶
    "minecraft:stone_brick_slab", // 石砖台阶
    "minecraft:mossy_cobblestone_slab", // 苔石台阶
    "minecraft:mossy_stone_brick_slab", // 苔石砖台阶
    "minecraft:cobblestone_wall", // 圆石墙
    "minecraft:stone_brick_wall", // Stone Brick Wall
    "minecraft:mossy_cobblestone_wall", // Mossy Cobblestone Wall
    "minecraft:mossy_stone_brick_wall", // Mossy Stone Brick Wall
    "minecraft:andesite", // 安山岩
    "minecraft:andesite_stairs", // 安山岩楼梯
    "minecraft:andesite_slab", // 安山岩台阶
    "minecraft:andesite_wall", // Andesite Wall
    "minecraft:polished_andesite", // 磨制安山岩
    "minecraft:polished_andesite_stairs", // 磨制安山岩楼梯
    "minecraft:polished_andesite_slab", // 磨制安山岩台阶
    "minecraft:diorite", // 闪长岩
    "minecraft:diorite_stairs", // 闪长岩楼梯
    "minecraft:diorite_slab", // 闪长岩台阶
    "minecraft:diorite_wall", // Diorite Wall
    "minecraft:polished_diorite", // 磨制闪长岩
    "minecraft:polished_diorite_stairs", // 磨制闪长岩楼梯
    "minecraft:polished_diorite_slab", // 磨制闪长岩台阶
    "minecraft:granite", // 花岗岩
    "minecraft:granite_stairs", // 花岗岩楼梯
    "minecraft:granite_slab", // 花岗岩台阶
    "minecraft:granite_wall", // Granite Wall
    "minecraft:polished_granite", // 磨制花岗岩
    "minecraft:polished_granite_stairs", // 磨制花岗岩楼梯
    "minecraft:polished_granite_slab", // 磨制花岗岩台阶
    "minecraft:stone_button", // 石头按钮
    "minecraft:stone_pressure_plate", // 石质压力板
  ],
};

const deep_rock: ItemFamily = {
  id: "deep_rock", // 深板岩/凝灰岩/方解石/滴水石 + 抛���/砖/瓦 + 台阶/楼梯/墙 
  displayName: "深层岩石",
  items: [
    "minecraft:deepslate", // 深板岩
    "minecraft:cobbled_deepslate", // 深板岩圆石
    "minecraft:polished_deepslate", // 磨制深板岩
    "minecraft:deepslate_bricks", // 深板岩砖
    "minecraft:deepslate_tiles", // 深板岩瓦
    "minecraft:cracked_deepslate_bricks", // 裂纹深板岩砖
    "minecraft:cracked_deepslate_tiles", // 裂纹深板岩瓦
    "minecraft:chiseled_deepslate", // 錾制深板岩
    "minecraft:cobbled_deepslate_stairs", // 深板岩圆石楼梯
    "minecraft:cobbled_deepslate_slab", // 深板岩圆石台阶
    "minecraft:cobbled_deepslate_wall", // 深板岩圆石墙
    "minecraft:polished_deepslate_stairs", // 磨制深板岩楼梯
    "minecraft:polished_deepslate_slab", // 磨制深板岩台阶
    "minecraft:polished_deepslate_wall", // 磨制深板岩墙
    "minecraft:deepslate_brick_stairs", // 深板岩砖楼梯
    "minecraft:deepslate_brick_slab", // 深板岩砖台阶
    "minecraft:deepslate_brick_wall", // 深板岩砖墙
    "minecraft:deepslate_tile_stairs", // 深板岩瓦楼梯
    "minecraft:deepslate_tile_slab", // 深板岩瓦台阶
    "minecraft:deepslate_tile_wall", // 深板岩瓦墙
    "minecraft:tuff", // 凝灰岩
    "minecraft:polished_tuff", // 磨制凝灰岩
    "minecraft:tuff_bricks", // 凝灰岩砖
    "minecraft:chiseled_tuff", // 雕纹凝灰岩
    "minecraft:chiseled_tuff_bricks", // 雕纹凝灰岩砖
    "minecraft:tuff_stairs", // 凝灰岩楼梯
    "minecraft:tuff_slab", // 凝灰岩台阶
    "minecraft:tuff_wall", // 凝灰岩墙
    "minecraft:polished_tuff_stairs", // 磨制凝灰岩楼梯
    "minecraft:polished_tuff_slab", // 磨制凝灰岩台阶
    "minecraft:polished_tuff_wall", // 磨制凝灰岩墙
    "minecraft:tuff_brick_stairs", // 凝灰岩砖楼梯
    "minecraft:tuff_brick_slab", // 凝灰岩砖台阶
    "minecraft:tuff_brick_wall", // 凝灰岩砖墙
    "minecraft:calcite", // 方解石
    "minecraft:pointed_dripstone", // 滴水石锥
    "minecraft:dripstone_block", // 滴水石块
    "minecraft:reinforced_deepslate", // 强化深板岩
  ],
};

const decorative_stone: ItemFamily = {
  id: "decorative_stone", // 砂岩/石英/紫珀/海晶石/砖 + 台阶/楼梯/墙 
  displayName: "装饰石材",
  items: [
    "minecraft:sandstone", // 砂岩
    "minecraft:sandstone_stairs", // 砂岩楼梯
    "minecraft:sandstone_slab", // 砂岩台阶
    "minecraft:sandstone_wall", // Sandstone Wall
    "minecraft:cut_sandstone", // 切制砂岩
    "minecraft:cut_sandstone_slab", // 切制砂岩台阶
    "minecraft:chiseled_sandstone", // 錾制砂岩
    "minecraft:smooth_sandstone", // 平滑砂岩
    "minecraft:smooth_sandstone_stairs", // 平滑砂岩楼梯
    "minecraft:smooth_sandstone_slab", // 平滑砂岩台阶
    "minecraft:red_sandstone", // 红砂岩
    "minecraft:red_sandstone_stairs", // 红砂岩楼梯
    "minecraft:red_sandstone_slab", // 红砂岩台阶
    "minecraft:red_sandstone_wall", // Red Sandstone Wall
    "minecraft:cut_red_sandstone", // 切制红砂岩
    "minecraft:cut_red_sandstone_slab", // 切制红砂岩台阶
    "minecraft:chiseled_red_sandstone", // 錾制红砂岩
    "minecraft:smooth_red_sandstone", // 平滑红砂岩
    "minecraft:smooth_red_sandstone_stairs", // 平滑红砂岩楼梯
    "minecraft:smooth_red_sandstone_slab", // Smooth Red Sandstone Slab
    "minecraft:prismarine", // 海晶石
    "minecraft:prismarine_stairs", // 海晶石楼梯
    "minecraft:prismarine_slab", // 海晶石台阶
    "minecraft:prismarine_wall", // Prismarine Wall
    "minecraft:prismarine_bricks", // 海晶石砖
    "minecraft:prismarine_bricks_stairs", // 海晶石砖楼梯
    "minecraft:prismarine_brick_slab", // Prismarine Brick Slab
    "minecraft:dark_prismarine", // 暗海晶石
    "minecraft:dark_prismarine_stairs", // 暗海晶石楼梯
    "minecraft:dark_prismarine_slab", // 暗海晶石台阶
    "minecraft:purpur_block", // 紫珀方块
    "minecraft:purpur_pillar", // Purpur Pillar
    "minecraft:purpur_slab", // 紫珀台阶
    "minecraft:purpur_stairs", // 紫珀楼梯
    "minecraft:quartz_block", // 石英块
    "minecraft:quartz_bricks", // 石英砖
    "minecraft:quartz_pillar", // Quartz Pillar
    "minecraft:quartz_slab", // 石英台阶
    "minecraft:quartz_stairs", // 石英楼梯
    "minecraft:smooth_quartz", // Smooth Quartz
    "minecraft:smooth_quartz_slab", // 平滑石英台阶
    "minecraft:smooth_quartz_stairs", // 平滑石英楼梯
    "minecraft:brick_block", // 砖
    "minecraft:brick_stairs", // 砖楼梯
    "minecraft:brick_slab", // 砖台阶
    "minecraft:brick_wall", // Brick Wall
    "minecraft:mud_bricks", // 泥砖
    "minecraft:mud_brick_stairs", // 泥砖楼梯
    "minecraft:mud_brick_slab", // 泥砖台阶
    "minecraft:mud_brick_wall", // 泥砖墙
    "minecraft:resin_bricks", // 树脂砖块
    "minecraft:resin_brick_stairs", // 树脂砖楼梯
    "minecraft:resin_brick_slab", // 树脂砖台阶
    "minecraft:resin_brick_wall", // 树脂砖墙
    "minecraft:chiseled_resin_bricks", // 錾制树脂砖块
    "minecraft:resin_block", // 树脂块
    "minecraft:resin_brick", // 树脂砖
    "minecraft:resin_clump", // 树脂团
  ],
};

const copper_blocks: ItemFamily = {
  id: "copper_blocks",
  displayName: "铜方块",
  items: [
    "minecraft:chiseled_copper", // 雕纹铜块
    "minecraft:copper_bulb", // 铜灯泡
    "minecraft:copper_grate", // 铜格栅
    "minecraft:cut_copper", // 切制铜块
    "minecraft:cut_copper_slab", // 切制铜块台阶
    "minecraft:cut_copper_stairs", // 切制铜楼梯
    "minecraft:exposed_chiseled_copper", // 外露錾制铜块
    "minecraft:exposed_copper", // 外露的铜块
    "minecraft:exposed_copper_block",
    "minecraft:exposed_copper_bulb", // 外露铜灯泡
    "minecraft:exposed_copper_grate", // 外露铜格栅
    "minecraft:exposed_cut_copper", // 外露切制铜块
    "minecraft:exposed_cut_copper_slab", // 外露切制铜块台阶
    "minecraft:exposed_cut_copper_stairs", // 外露切制铜楼梯
    "minecraft:oxidized_chiseled_copper", // 氧化錾制铜
    "minecraft:oxidized_copper", // 氧化的铜块
    "minecraft:oxidized_copper_block",
    "minecraft:oxidized_copper_bulb", // 氧化铜灯泡
    "minecraft:oxidized_copper_grate", // 氧化铜格栅
    "minecraft:oxidized_cut_copper", // 氧化切制铜块
    "minecraft:oxidized_cut_copper_slab", // 氧化切制铜块台阶
    "minecraft:oxidized_cut_copper_stairs", // 氧化切制铜楼梯
    "minecraft:waxed_chiseled_copper", // 涂蜡錾制铜
    "minecraft:waxed_copper", // 涂蜡铜方块
    "minecraft:waxed_copper_block",
    "minecraft:waxed_copper_bulb", // 涂蜡铜灯泡
    "minecraft:waxed_copper_grate", // 涂蜡铜格栅
    "minecraft:waxed_cut_copper", // 涂蜡切制铜块
    "minecraft:waxed_cut_copper_slab", // 涂蜡切制铜块台阶
    "minecraft:waxed_cut_copper_stairs", // 涂蜡切制铜楼梯
    "minecraft:waxed_exposed_chiseled_copper", // 涂蜡外露錾制铜
    "minecraft:waxed_exposed_copper", // 外露的涂蜡铜块
    "minecraft:waxed_exposed_copper_block",
    "minecraft:waxed_exposed_copper_bulb", // 涂蜡外露铜灯泡
    "minecraft:waxed_exposed_copper_grate", // 涂蜡外露铜格栅
    "minecraft:waxed_exposed_cut_copper", // 外露的涂蜡切制铜块
    "minecraft:waxed_exposed_cut_copper_slab", // 外露的涂蜡切制铜块台阶
    "minecraft:waxed_exposed_cut_copper_stairs", // 外露的涂蜡切制铜楼梯
    "minecraft:waxed_oxidized_chiseled_copper", // 涂蜡氧化錾制铜
    "minecraft:waxed_oxidized_copper", // 氧化的涂蜡铜块
    "minecraft:waxed_oxidized_copper_block",
    "minecraft:waxed_oxidized_copper_bulb", // 氧化的涂蜡铜灯泡
    "minecraft:waxed_oxidized_copper_grate", // 涂蜡氧化铜格栅
    "minecraft:waxed_oxidized_cut_copper", // 氧化的涂蜡切制铜块
    "minecraft:waxed_oxidized_cut_copper_slab", // 氧化的涂蜡切制铜块台阶
    "minecraft:waxed_oxidized_cut_copper_stairs", // 氧化的涂蜡切制铜楼梯
    "minecraft:waxed_weathered_chiseled_copper", // 涂蜡风化錾制铜
    "minecraft:waxed_weathered_copper", // 涂蜡风化铜块
    "minecraft:waxed_weathered_copper_block",
    "minecraft:waxed_weathered_copper_bulb", // 涂蜡风化铜灯泡
    "minecraft:waxed_weathered_copper_grate", // 涂蜡风化铜格栅
    "minecraft:waxed_weathered_cut_copper", // 涂蜡风化切制铜块
    "minecraft:waxed_weathered_cut_copper_slab", // 涂蜡风化切制铜块台阶
    "minecraft:waxed_weathered_cut_copper_stairs", // 涂蜡风化切制铜楼梯
    "minecraft:weathered_chiseled_copper", // 风化錾制铜
    "minecraft:weathered_copper", // 风化的铜块
    "minecraft:weathered_copper_block",
    "minecraft:weathered_copper_bulb", // 风化铜灯泡
    "minecraft:weathered_copper_grate", // 风化铜格栅
    "minecraft:weathered_cut_copper", // 风化切制铜块
    "minecraft:weathered_cut_copper_slab", // 风化切制铜块台阶
    "minecraft:weathered_cut_copper_stairs", // 风化切制铜楼梯
  ],
};

const rare_minerals: ItemFamily = {
  id: "rare_minerals",
  displayName: "稀有矿物",
  items: [
    "minecraft:diamond", // 钻石
    "minecraft:diamond_block", // 钻石块
    "minecraft:emerald", // 绿宝石
    "minecraft:emerald_block", // 绿宝石块
    "minecraft:netherite_ingot", // 下界合金锭
    "minecraft:netherite_block", // 下界合金块
  ],
};

const rare_ores: ItemFamily = {
  id: "rare_ores",
  displayName: "稀有矿石",
  items: [
    "minecraft:diamond_ore", // 钻石矿石
    "minecraft:deepslate_diamond_ore", // 深层钻石矿石
    "minecraft:emerald_ore", // 绿宝石矿石
    "minecraft:deepslate_emerald_ore", // 深层绿宝石矿石
    "minecraft:ancient_debris", // 远古残骸
  ],
};

const common_minerals: ItemFamily = {
  id: "common_minerals",
  displayName: "普通金属矿物",
  items: [
    "minecraft:iron_ingot", // 铁锭
    "minecraft:iron_nugget", // 铁粒
    "minecraft:iron_block", // 铁块
    "minecraft:gold_ingot", // 金锭
    "minecraft:gold_nugget", // 金粒
    "minecraft:gold_block", // 金块
    "minecraft:coal", // 煤炭
    "minecraft:coal_block", // 煤炭块
    "minecraft:lapis_block", // 青金石块
    "minecraft:quartz", // 下界石英
    "minecraft:raw_iron", // 粗铁
    "minecraft:raw_iron_block", // 粗铁块
    "minecraft:raw_gold", // 粗金
    "minecraft:raw_gold_block", // 粗金块
    "minecraft:raw_copper", // 粗铜
    "minecraft:raw_copper_block", // 粗铜块
    "minecraft:copper_ingot", // 铜锭
    "minecraft:amethyst_shard", // 紫水晶碎片
  ],
};

const common_ores: ItemFamily = {
  id: "common_ores",
  displayName: "普通矿石",
  items: [
    "minecraft:iron_ore", // 铁矿石
    "minecraft:deepslate_iron_ore", // 深层铁矿石
    "minecraft:gold_ore", // 金矿石
    "minecraft:deepslate_gold_ore", // 深层金矿石
    "minecraft:copper_ore", // 铜矿石
    "minecraft:deepslate_copper_ore", // 深层铜矿石
    "minecraft:coal_ore", // 煤矿石
    "minecraft:deepslate_coal_ore", // 深层煤矿石
    "minecraft:lapis_ore", // 青金石矿石
    "minecraft:deepslate_lapis_ore", // 深板岩青金石矿石
    "minecraft:redstone_ore", // 红石矿石
    "minecraft:deepslate_redstone_ore", // 深层红石矿石
    "minecraft:quartz_ore", // 下界石英矿石
    "minecraft:nether_gold_ore", // 下界金矿石
    "minecraft:gilded_blackstone", // 镶金黑石
  ],
};

const wearables: ItemFamily = {
  id: "wearables",
  displayName: "可穿戴装备",
  items: [
    "minecraft:leather_helmet", // 皮革帽子
    "minecraft:leather_chestplate", // 皮革胸甲
    "minecraft:leather_leggings", // 皮革裤子
    "minecraft:leather_boots", // 皮革靴子
    "minecraft:chainmail_helmet", // 链甲头盔
    "minecraft:chainmail_chestplate", // 链甲胸甲
    "minecraft:chainmail_leggings", // 链甲护腿
    "minecraft:chainmail_boots", // 链甲靴
    "minecraft:iron_helmet", // 铁头盔
    "minecraft:iron_chestplate", // 铁胸甲
    "minecraft:iron_leggings", // 铁护腿
    "minecraft:iron_boots", // 铁靴子
    "minecraft:golden_helmet", // 金头盔
    "minecraft:golden_chestplate", // 金胸甲
    "minecraft:golden_leggings", // 金护腿
    "minecraft:golden_boots", // 金靴子
    "minecraft:diamond_helmet", // 钻石头盔
    "minecraft:diamond_chestplate", // 钻石胸甲
    "minecraft:diamond_leggings", // 钻石护腿
    "minecraft:diamond_boots", // 钻石靴子
    "minecraft:netherite_helmet", // 下界合金头盔
    "minecraft:netherite_chestplate", // 下界合金胸甲
    "minecraft:netherite_leggings", // 下界合金护腿
    "minecraft:netherite_boots", // 下界合金靴子
    "minecraft:turtle_helmet", // 海龟壳
    "minecraft:elytra", // 鞘翅
    "minecraft:wolf_armor", // 狼铠
    "minecraft:shield", // 盾牌
  ],
};

const weapons: ItemFamily = {
  id: "weapons",
  displayName: "武器",
  items: [
    "minecraft:wooden_sword", // 木剑
    "minecraft:stone_sword", // 石剑
    "minecraft:iron_sword", // 铁剑
    "minecraft:golden_sword", // 金剑
    "minecraft:diamond_sword", // 钻石剑
    "minecraft:netherite_sword", // 下界合金剑
    "minecraft:bow", // 弓
    "minecraft:crossbow", // 弩
    "minecraft:trident", // 三叉戟
    "minecraft:mace", // 重锤
    "minecraft:arrow", // 箭
    "minecraft:wind_charge", // 风弹
  ],
};

const tools: ItemFamily = {
  id: "tools",
  displayName: "工具",
  items: [
    "minecraft:wooden_pickaxe", // 木镐
    "minecraft:stone_pickaxe", // 石镐
    "minecraft:iron_pickaxe", // 铁镐
    "minecraft:golden_pickaxe", // 金镐
    "minecraft:diamond_pickaxe", // 钻石镐
    "minecraft:netherite_pickaxe", // 下界合金镐
    "minecraft:wooden_axe", // 木斧
    "minecraft:stone_axe", // 石斧
    "minecraft:iron_axe", // 铁斧
    "minecraft:golden_axe", // 金斧
    "minecraft:diamond_axe", // 钻石斧
    "minecraft:netherite_axe", // 下界合金斧头
    "minecraft:wooden_shovel", // 木锹
    "minecraft:stone_shovel", // 石锹
    "minecraft:iron_shovel", // 铁锹
    "minecraft:golden_shovel", // 金锹
    "minecraft:diamond_shovel", // 钻石锹
    "minecraft:netherite_shovel", // 下界合金锹
    "minecraft:wooden_hoe", // 木锄
    "minecraft:stone_hoe", // 石锄
    "minecraft:iron_hoe", // 铁锄
    "minecraft:golden_hoe", // 金锄
    "minecraft:diamond_hoe", // 钻石锄
    "minecraft:netherite_hoe", // 下界合金锄头
    "minecraft:shears", // 剪刀
    "minecraft:fishing_rod", // 钓鱼竿
    "minecraft:flint_and_steel", // 打火石
    "minecraft:brush", // 刷子
    "minecraft:spyglass", // 望远镜
    "minecraft:clock", // 钟
    "minecraft:compass", // 指南针
    "minecraft:recovery_compass", // 追溯指针
    "minecraft:bucket", // 桶
    "minecraft:water_bucket", // 水桶
    "minecraft:lava_bucket", // 熔岩桶
    "minecraft:milk_bucket", // 牛奶桶
    "minecraft:powder_snow_bucket", // 细雪桶
    "minecraft:minecart", // 矿车
    "minecraft:chest_minecart", // 运输矿车
    "minecraft:hopper_minecart", // 漏斗矿车
    "minecraft:tnt_minecart", // TNT 矿车
    "minecraft:name_tag", // 命名牌
    "minecraft:lodestone_compass", // Lodestone Compass
  ],
};

const redstone: ItemFamily = {
  id: "redstone",
  displayName: "红石及原件",
  items: [
    "minecraft:redstone", // 红石粉
    "minecraft:redstone_block", // 红石块
    "minecraft:redstone_torch", // 红石火把
    "minecraft:redstone_lamp", // 红石灯
    "minecraft:repeater", // 红石中继器
    "minecraft:comparator", // 红石比较器
    "minecraft:observer", // 侦测器
    "minecraft:piston", // 活塞
    "minecraft:sticky_piston", // 黏性活塞
    "minecraft:dispenser", // 发射器
    "minecraft:dropper", // 投掷器
    "minecraft:hopper", // 漏斗
    "minecraft:crafter", // 合成器
    "minecraft:target", // 标靶
    "minecraft:lightning_rod", // 雷霆之杖
    "minecraft:daylight_detector", // 阳光探测器
    "minecraft:calibrated_sculk_sensor", // 已校准潜声感测器
    "minecraft:lever", // 拉杆
    "minecraft:tripwire_hook", // 绊线钩
    "minecraft:trapped_chest", // 陷阱箱
    "minecraft:heavy_weighted_pressure_plate", // 重质测重压力板
    "minecraft:light_weighted_pressure_plate", // 轻质测重压力板
    "minecraft:iron_door", // 铁门
    "minecraft:iron_trapdoor", // 铁活板门
    "minecraft:rail", // 铁轨
    "minecraft:activator_rail", // 激活铁轨
    "minecraft:detector_rail", // 探测铁轨
    "minecraft:golden_rail", // 动力铁轨
    "minecraft:sculk_sensor", // 潜声感测器
    "minecraft:tnt", // TNT
  ],
};

const crops_food: ItemFamily = {
  id: "crops_food",
  displayName: "农作物与食物",
  items: [
    "minecraft:wheat", // 小麦
    "minecraft:wheat_seeds", // 小麦种子
    "minecraft:carrot", // 胡萝卜
    "minecraft:potato", // 马铃薯
    "minecraft:poisonous_potato", // 毒马铃薯
    "minecraft:baked_potato", // 烤马铃薯
    "minecraft:beetroot", // 甜菜根
    "minecraft:beetroot_seeds", // 甜菜种子
    "minecraft:melon_block", // 西瓜
    "minecraft:melon_slice", // 西瓜片
    "minecraft:melon_seeds", // 西瓜种子
    "minecraft:pumpkin", // 南瓜
    "minecraft:pumpkin_seeds", // 南瓜种子
    "minecraft:carved_pumpkin", // 雕刻过的南瓜
    "minecraft:lit_pumpkin", // 南瓜灯
    "minecraft:pumpkin_pie", // 南瓜派
    "minecraft:apple", // 苹果
    "minecraft:golden_apple", // 金苹果
    "minecraft:enchanted_golden_apple", // 附魔金苹果
    "minecraft:chorus_fruit", // 紫颂果
    "minecraft:bread", // 面包
    "minecraft:cookie", // 曲奇
    "minecraft:cake", // 蛋糕
    "minecraft:mushroom_stew", // 蘑菇煲
    "minecraft:rabbit_stew", // 兔肉煲
    "minecraft:beetroot_soup", // 甜菜汤
    "minecraft:suspicious_stew", // 迷之炖菜
    "minecraft:honey_bottle", // 蜂蜜瓶
    "minecraft:sweet_berries", // 甜浆果
    "minecraft:glow_berries", // 发光浆果
    "minecraft:porkchop", // 生猪排
    "minecraft:cooked_porkchop", // 熟猪排
    "minecraft:beef", // 生牛肉
    "minecraft:cooked_beef", // 牛排
    "minecraft:chicken", // 生鸡肉
    "minecraft:cooked_chicken", // 熟鸡肉
    "minecraft:rabbit", // 生兔肉
    "minecraft:cooked_rabbit", // 熟兔肉
    "minecraft:mutton", // 生羊肉
    "minecraft:cooked_mutton", // 熟羊肉
    "minecraft:cod", // 鳕鱼
    "minecraft:cooked_cod", // 熟鳕鱼
    "minecraft:salmon", // 鲑鱼
    "minecraft:cooked_salmon", // 熟鲑鱼
    "minecraft:pufferfish", // 河豚
    "minecraft:tropical_fish", // 热带鱼
    "minecraft:kelp", // 海带
    "minecraft:sugar_cane", // 甘蔗
    "minecraft:cocoa_beans", // 可可豆
  ],
};

const plants: ItemFamily = {
  id: "plants",
  displayName: "植物与树苗",
  items: [
    "minecraft:short_grass", // Short Grass
    "minecraft:tall_grass", // 高草丛
    "minecraft:fern", // 蕨
    "minecraft:large_fern", // 大型蕨
    "minecraft:short_dry_grass", // 矮干草丛
    "minecraft:tall_dry_grass", // 高干草丛
    "minecraft:deadbush", // 枯萎的灌木
    "minecraft:vine", // 藤蔓
    "minecraft:hanging_roots", // 垂根
    "minecraft:moss_block", // 苔藓块
    "minecraft:moss_carpet", // 苔藓地毯
    "minecraft:pale_moss_block", // 苍白苔藓块
    "minecraft:pale_moss_carpet", // 苍白苔藓地毯
    "minecraft:pale_hanging_moss", // 苍白垂须
    "minecraft:big_dripleaf", // 大型垂滴叶
    "minecraft:small_dripleaf_block", // 小型垂滴叶
    "minecraft:spore_blossom", // 孢子花
    "minecraft:cactus", // 仙人掌
    "minecraft:cactus_flower", // 仙人掌花
    "minecraft:bamboo", // 竹子
    "minecraft:seagrass", // 海草
    "minecraft:azalea", // 杜鹃花
    "minecraft:flowering_azalea", // 盛开的杜鹃花
    "minecraft:pitcher_pod", // 猪笼草荚果
    "minecraft:torchflower_seeds", // 火把花种子
    "minecraft:pink_petals", // 粉红色花瓣
    "minecraft:leaf_litter", // 落叶堆
    "minecraft:wildflowers", // 野花
    "minecraft:waterlily", // 睡莲
    "minecraft:sea_pickle", // 海泡菜
    "minecraft:brown_mushroom", // 棕色蘑菇
    "minecraft:red_mushroom", // 红蘑菇
    "minecraft:brown_mushroom_block", // 棕色蘑菇方块
    "minecraft:red_mushroom_block", // 红蘑菇方块
    "minecraft:mushroom_stem", // 蘑菇柄
    "minecraft:firefly_bush", // 萤火虫灌木
    "minecraft:bush", // 灌木
    "minecraft:closed_eyeblossom", // 合拢的眼眸花
    "minecraft:open_eyeblossom", // 绽放的眼眸花
    "minecraft:oak_leaves", // 橡树叶
    "minecraft:oak_sapling", // 橡树苗
    "minecraft:spruce_leaves", // 云杉树叶
    "minecraft:spruce_sapling", // 云杉树苗
    "minecraft:birch_leaves", // 桦树叶
    "minecraft:birch_sapling", // 桦树苗
    "minecraft:jungle_leaves", // 丛林树叶
    "minecraft:jungle_sapling", // 丛林树苗
    "minecraft:acacia_leaves", // 金合欢树叶
    "minecraft:acacia_sapling", // 金合欢树苗
    "minecraft:dark_oak_leaves", // 深色橡树叶
    "minecraft:dark_oak_sapling", // 深色橡树苗
    "minecraft:mangrove_leaves", // 红树木树叶
    "minecraft:mangrove_sapling",
    "minecraft:cherry_leaves", // 樱花树叶
    "minecraft:cherry_sapling", // 樱花树苗
    "minecraft:pale_oak_leaves", // 苍白橡木树叶
    "minecraft:pale_oak_sapling", // 苍白橡木树苗
    "minecraft:mangrove_propagule", // 红树木繁殖体
    "minecraft:azalea_leaves", // 杜鹃花叶
    "minecraft:azalea_leaves_flowered", // 盛开的杜鹃花树叶
  ],
};

const flowers: ItemFamily = {
  id: "flowers",
  displayName: "花",
  items: [
    "minecraft:dandelion", // 花
    "minecraft:poppy", // 虞美人
    "minecraft:blue_orchid", // Blue Orchid
    "minecraft:allium", // 绒球葱
    "minecraft:azure_bluet", // 蓝花美耳草
    "minecraft:red_tulip", // 红色郁金香
    "minecraft:orange_tulip", // 橙色郁金香
    "minecraft:white_tulip", // 白色郁金香
    "minecraft:pink_tulip", // 粉红色郁金香
    "minecraft:oxeye_daisy", // Oxeye Daisy
    "minecraft:cornflower", // 矢车菊
    "minecraft:lily_of_the_valley", // 铃兰
    "minecraft:wither_rose", // 凋零玫瑰
    "minecraft:sunflower", // 向日葵
    "minecraft:lilac", // 丁香
    "minecraft:rose_bush", // 玫瑰丛
    "minecraft:peony", // 牡丹
    "minecraft:torchflower", // 火把花
    "minecraft:pitcher_plant", // 猪笼草
  ],
};

const coral: ItemFamily = {
  id: "coral",
  displayName: "珊瑚",
  items: [
    "minecraft:tube_coral", // 管珊瑚
    "minecraft:tube_coral_block", // 管珊瑚块
    "minecraft:tube_coral_fan", // 管珊瑚扇
    "minecraft:dead_tube_coral", // 失活的管珊瑚
    "minecraft:dead_tube_coral_block", // 管珊瑚块
    "minecraft:dead_tube_coral_fan", // 失活的管珊瑚扇
    "minecraft:brain_coral", // 脑纹珊瑚
    "minecraft:brain_coral_block", // 脑纹珊瑚块
    "minecraft:brain_coral_fan", // 脑纹珊瑚扇
    "minecraft:dead_brain_coral", // 失活的脑纹珊瑚
    "minecraft:dead_brain_coral_block", // 脑纹珊瑚块
    "minecraft:dead_brain_coral_fan", // 失活的脑纹珊瑚扇
    "minecraft:bubble_coral", // 气泡珊瑚
    "minecraft:bubble_coral_block", // 气泡珊瑚块
    "minecraft:bubble_coral_fan", // 气泡珊瑚扇
    "minecraft:dead_bubble_coral", // 失活的气泡珊瑚
    "minecraft:dead_bubble_coral_block", // 气泡珊瑚块
    "minecraft:dead_bubble_coral_fan", // 失活的气泡珊瑚扇
    "minecraft:fire_coral", // 火珊瑚
    "minecraft:fire_coral_block", // 火珊瑚块
    "minecraft:fire_coral_fan", // 火珊瑚扇
    "minecraft:dead_fire_coral", // 失活的火珊瑚
    "minecraft:dead_fire_coral_block", // 火珊瑚块
    "minecraft:dead_fire_coral_fan", // 失活的火珊瑚扇
    "minecraft:horn_coral", // 鹿角珊瑚
    "minecraft:horn_coral_block", // 鹿角珊瑚块
    "minecraft:horn_coral_fan", // 鹿角珊瑚扇
    "minecraft:dead_horn_coral", // 失活的鹿角珊瑚
    "minecraft:dead_horn_coral_block", // 鹿角珊瑚块
    "minecraft:dead_horn_coral_fan", // 失活的鹿角珊瑚扇
  ],
};

const nether: ItemFamily = {
  id: "nether",
  displayName: "地狱物品",
  items: [
    "minecraft:netherrack", // 下界岩
    "minecraft:crimson_nylium", // 绯红菌岩
    "minecraft:warped_nylium", // 诡异菌岩
    "minecraft:soul_sand", // 灵魂沙
    "minecraft:glowstone", // 荧石
    "minecraft:shroomlight", // 菌光体
    "minecraft:nether_wart_block", // 下界疣方块
    "minecraft:warped_wart_block", // 诡异疣方块
    "minecraft:magma", // 岩浆块
    "minecraft:respawn_anchor", // 重生锚
    "minecraft:nether_brick", // 下界砖
    "minecraft:netherbrick", // 下界砖
    "minecraft:nether_brick_fence", // 下界砖栅栏
    "minecraft:nether_brick_stairs", // 下界砖楼梯
    "minecraft:nether_brick_slab", // 下界砖台阶
    "minecraft:nether_brick_wall", // Nether Brick Wall
    "minecraft:red_nether_brick", // 红色下界砖块
    "minecraft:red_nether_brick_stairs", // 红色下界砖楼梯
    "minecraft:red_nether_brick_slab", // 红色下界砖台阶
    "minecraft:red_nether_brick_wall", // Red Nether Brick Wall
    "minecraft:chiseled_nether_bricks", // 錾制下界砖
    "minecraft:cracked_nether_bricks", // 裂纹下界砖
    "minecraft:weeping_vines", // 垂泪藤
    "minecraft:twisting_vines", // 缠怨藤
    "minecraft:nether_sprouts", // 下界苗
    "minecraft:warped_roots", // 诡异菌根
    "minecraft:crimson_roots", // 绯红菌索
    "minecraft:crimson_fungus", // 绯红菌
    "minecraft:warped_fungus", // 诡异真菌
    "minecraft:basalt", // 玄武岩
    "minecraft:polished_basalt", // 磨制玄武岩
    "minecraft:smooth_basalt", // 平滑玄武岩
    "minecraft:blackstone", // 黑石
    "minecraft:cracked_polished_blackstone_bricks", // 裂纹磨制黑石砖
    "minecraft:chiseled_polished_blackstone", // 錾制磨制黑石
    "minecraft:blackstone_stairs", // 黑石楼梯
    "minecraft:blackstone_slab", // 黑石台阶
    "minecraft:blackstone_wall", // 黑石墙
    "minecraft:polished_blackstone", // 磨制黑石
    "minecraft:polished_blackstone_stairs", // 磨制黑石楼梯
    "minecraft:polished_blackstone_slab", // 磨制黑石台阶
    "minecraft:polished_blackstone_wall", // 磨制黑石墙
    "minecraft:polished_blackstone_bricks", // 磨制黑石砖
    "minecraft:polished_blackstone_brick_stairs", // 磨制黑石砖楼梯
    "minecraft:polished_blackstone_brick_slab", // 磨制黑石砖台阶
    "minecraft:polished_blackstone_brick_wall", // 磨制黑石砖墙
    "minecraft:polished_blackstone_button", // 磨制黑石按钮
    "minecraft:polished_blackstone_pressure_plate", // 磨制黑石压力板
  ],
};

const end: ItemFamily = {
  id: "end",
  displayName: "末地物品",
  items: [
    "minecraft:end_stone", // 末地石
    "minecraft:end_bricks", // 末地石砖
    "minecraft:end_brick_stairs", // 末地石砖楼梯
    "minecraft:end_stone_brick_slab", // 末地石砖台阶
    "minecraft:end_stone_brick_wall", // End Stone Brick Wall
    "minecraft:end_portal_frame", // 末地传送门框架
    "minecraft:end_crystal", // 末地水晶
    "minecraft:end_rod", // 末地烛
    "minecraft:ender_chest", // 末影箱
    "minecraft:dragon_egg", // 龙蛋
    "minecraft:dragon_head", // 龙首
    "minecraft:ender_eye", // 末影之眼
    "minecraft:chorus_flower", // 紫颂花
    "minecraft:chorus_plant", // 紫颂植株
  ],
};

const surface: ItemFamily = {
  id: "surface",
  displayName: "地表方块",
  items: [
    "minecraft:grass_block", // 草方块
    "minecraft:dirt", // 泥土
    "minecraft:coarse_dirt", // 砂土
    "minecraft:dirt_with_roots", // 缠根泥土
    "minecraft:podzol", // 灰化土
    "minecraft:mycelium", // 菌丝
    "minecraft:sand", // 沙子
    "minecraft:red_sand", // 红沙
    "minecraft:gravel", // 砂砾
    "minecraft:clay", // 黏土
    "minecraft:mud", // 泥巴
    "minecraft:packed_mud", // 填充泥浆
    "minecraft:snow", // 雪块
    "minecraft:snow_layer", // 雪
    "minecraft:ice", // 冰
    "minecraft:packed_ice", // 浮冰
    "minecraft:blue_ice", // 蓝冰
    "minecraft:grass_path", // 土径
    "minecraft:farmland", // 耕地
    "minecraft:suspicious_sand", // 可疑的沙子
    "minecraft:suspicious_gravel", // 可疑砂砾
    "minecraft:frog_spawn", // 青蛙卵
  ],
};

const friendly_drops: ItemFamily = {
  id: "friendly_drops",
  displayName: "友好生物掉落",
  items: [
    "minecraft:feather", // 羽毛
    "minecraft:leather", // 皮革
    "minecraft:rabbit_hide", // 兔子皮
    "minecraft:egg", // 鸡蛋
    "minecraft:turtle_egg", // 海龟蛋
    "minecraft:sniffer_egg", // 嗅探兽蛋
    "minecraft:turtle_scute", // 海龟鳞甲
    "minecraft:armadillo_scute", // 犰狳鳞甲
    "minecraft:ink_sac", // 墨囊
    "minecraft:glow_ink_sac", // 荧光墨囊
    "minecraft:honeycomb", // 蜜脾
    "minecraft:honeycomb_block", // 蜜脾块
    "minecraft:honey_block", // 蜂蜜方块
    "minecraft:string", // 线
    "minecraft:slime_ball", // 黏液球
    "minecraft:clay_ball", // 粘土球
    "minecraft:brick", // 红砖
    "minecraft:bone_meal", // 骨粉
    "minecraft:paper", // 纸
    "minecraft:book", // 书
    "minecraft:writable_book", // 书与笔
    "minecraft:enchanted_book", // 附魔书
    "minecraft:filled_map", // Filled Map
    "minecraft:empty_map", // 地图
    "minecraft:nautilus_shell", // 鹦鹉螺壳
    "minecraft:heart_of_the_sea", // 海洋之心
    "minecraft:echo_shard", // 回响碎片
    "minecraft:prismarine_shard", // 海晶碎片
    "minecraft:prismarine_crystals", // 海晶砂粒
    "minecraft:sea_lantern", // 海晶灯
    "minecraft:sponge", // 海绵
    "minecraft:wet_sponge", // 湿海绵
    "minecraft:goat_horn", // 山羊角
    "minecraft:disc_fragment_5", // 唱片残片
    "minecraft:small_amethyst_bud", // 小型紫晶芽
    "minecraft:medium_amethyst_bud", // 中型紫晶芽
    "minecraft:large_amethyst_bud", // 大型紫晶芽
    "minecraft:amethyst_cluster", // 紫水晶簇
    "minecraft:fire_charge", // 火焰弹
    "minecraft:firework_rocket", // 烟花
    "minecraft:firework_star", // 烟火之星
  ],
};

const hostile_drops: ItemFamily = {
  id: "hostile_drops",
  displayName: "敌对生物掉落",
  items: [
    "minecraft:rotten_flesh", // 腐肉
    "minecraft:bone", // 骨头
    "minecraft:phantom_membrane", // 幻翼膜
    "minecraft:totem_of_undying", // 不死图腾
    "minecraft:nether_star", // 下界之星
    "minecraft:experience_bottle", // 附魔之瓶
    "minecraft:skeleton_skull", // 骷髅头颅
    "minecraft:wither_skeleton_skull", // 凋灵骷髅头颅
    "minecraft:zombie_head", // 僵尸的头
    "minecraft:creeper_head", // 苦力怕的头
    "minecraft:player_head", // 玩家头颅
    "minecraft:piglin_head", // 猪灵头颅
    "minecraft:breeze_rod", // 旋风棒
    "minecraft:heavy_core", // 沉重核心
    "minecraft:trial_key", // 试炼钥匙
    "minecraft:ominous_trial_key", // 不祥试炼钥匙
  ],
};

const potions: ItemFamily = {
  id: "potions",
  displayName: "药水与酿造",
  items: [
    "minecraft:potion", // Potion
    "minecraft:splash_potion", // 药水
    "minecraft:lingering_potion", // 滞留药水
    "minecraft:ominous_bottle", // 不祥之瓶
    "minecraft:glass_bottle", // 玻璃瓶
    "minecraft:brewing_stand", // 酿造台
    "minecraft:cauldron", // 炼药锅
    "minecraft:nether_wart", // 下界疣
    "minecraft:blaze_powder", // 烈焰粉
    "minecraft:blaze_rod", // 烈焰棒
    "minecraft:magma_cream", // 岩浆膏
    "minecraft:fermented_spider_eye", // 发酵蛛眼
    "minecraft:sugar", // 糖
    "minecraft:dried_kelp", // 干海带
  ],
};

const music_disc: ItemFamily = {
  id: "music_disc",
  displayName: "唱片",
  items: [
    "minecraft:music_disc_13", // C418 - 13
    "minecraft:music_disc_cat", // C418 - cat
    "minecraft:music_disc_blocks", // C418 - blocks
    "minecraft:music_disc_chirp", // C418 - chirp
    "minecraft:music_disc_creator", // 莉娜·雷恩 - 创作者
    "minecraft:music_disc_creator_music_box", // 莉娜·雷恩 - 创作者（音乐盒）
    "minecraft:music_disc_far", // C418 - far
    "minecraft:music_disc_mall", // C418 - mall
    "minecraft:music_disc_mellohi", // C418 - mellohi
    "minecraft:music_disc_otherside", // 莉娜·雷恩 - otherside
    "minecraft:music_disc_pigstep", // 莉娜·雷恩 - Pigstep
    "minecraft:music_disc_precipice", // 亚伦·切罗夫 - 峭壁
    "minecraft:music_disc_relic", // 亚伦·切罗夫 - Relic
    "minecraft:music_disc_stal", // C418 - stal
    "minecraft:music_disc_strad", // C418 - strad
    "minecraft:music_disc_tears", // Amos Roddy - 泪水
    "minecraft:music_disc_wait", // C418 - wait
    "minecraft:music_disc_ward", // C418 - ward
    "minecraft:music_disc_11", // C418 - 11
    "minecraft:music_disc_5", // 塞缪尔·阿伯格 - 5
  ],
};

const ancient_city: ItemFamily = {
  id: "ancient_city", // 古城方块（幽匿/灵魂灯笼/尖啸体/催发体）
  displayName: "古城方块",
  items: [
    "minecraft:sculk", // 幽匿块
    "minecraft:sculk_vein", // 幽匿脉络
    "minecraft:sculk_catalyst", // 幽匿催发体
    "minecraft:sculk_shrieker", // 幽匿尖啸体
    "minecraft:soul_soil", // 灵魂土
    "minecraft:soul_torch", // 灵魂火把
    "minecraft:soul_lantern", // 灵魂灯笼
    "minecraft:soul_campfire", // 灵魂营火
  ],
};

export const ALL_FAMILIES: readonly ItemFamily[] = [
  wool,
  carpet,
  stained_glass,
  concrete,
  concrete_powder,
  terracotta,
  glazed_terracotta,
  shulker_box,
  candle,
  dye,
  animal_gear,
  bundle,
  bed,
  logs,
  wood_products,
  wood_misc,
  stone_core,
  deep_rock,
  decorative_stone,
  copper_blocks,
  rare_minerals,
  rare_ores,
  common_minerals,
  common_ores,
  wearables,
  weapons,
  tools,
  redstone,
  crops_food,
  plants,
  flowers,
  coral,
  nether,
  end,
  surface,
  friendly_drops,
  hostile_drops,
  potions,
  music_disc,
];

/** typeId → familyId 逆向索引 */
const TYPE_TO_FAMILY = new Map<string, string>();
for (const f of ALL_FAMILIES) {
  for (const id of f.items) TYPE_TO_FAMILY.set(id, f.id);
}

/** familyId → ItemFamily 索引 */
const FAMILY_BY_ID = new Map<string, ItemFamily>();
for (const f of ALL_FAMILIES) FAMILY_BY_ID.set(f.id, f);

export function getFamily(typeId: string): ItemFamily | undefined {
  const fid = TYPE_TO_FAMILY.get(typeId);
  return fid !== undefined ? FAMILY_BY_ID.get(fid) : undefined;
}

export function getFamilyById(familyId: string): ItemFamily | undefined {
  return FAMILY_BY_ID.get(familyId);
}

export function isInFamily(typeId: string, familyId: string): boolean {
  return TYPE_TO_FAMILY.get(typeId) === familyId;
}
