/**
 * 全物品家族分类生成器。
 * 从 name-maps 读取物品 ID，按规则分配到互斥的家族中。
 * 输出 ItemFamilies.ts
 *
 * 用法: node tools/generateItemFamilies.mjs > /dev/null && # writes file
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../scripts/data/ItemFamilies.ts");
const NAMEMAP_DIR = path.resolve(__dirname, "../scripts/data/name-maps");

function extractItemIds() {
  const files = fs.readdirSync(NAMEMAP_DIR).filter(f => f.endsWith(".ts") && f !== "types.ts" && f !== "index.ts");
  const items = new Set();
  for (const file of files) {
    const content = fs.readFileSync(path.join(NAMEMAP_DIR, file), "utf-8");
    const matches = content.matchAll(/"minecraft:[^"]+"/g);
    for (const m of matches) items.add(m[0].slice(1, -1));
  }
  // Filter to only actual items (no entities, effects, enchantments)
  // Entities: spawn_egg, minecraft: followed by entity names like "zombie", "creeper"
  const filtered = [...items].filter(id => {
    const name = id.replace("minecraft:", "");
    // Exclude pure entity names (no _ in name, lowercase single word)
    if (!name.includes("_") && /^[a-z]+$/.test(name) && name.length < 15) return false;
    // Exclude effects and enchantments
    if (["absorption","bad_omen","blindness","conduit_power","darkness","fatal_poison","fire_resistance","haste","health_boost","hunger","instant_damage","instant_health","invisibility","jump_boost","levitation","mining_fatigue","nausea","night_vision","poison","raid_omen","regeneration","resistance","saturation","slow_falling","slowness","speed","strength","trial_omen","village_hero","water_breathing","weakness","wind_charged","weaving","oozing","infested"].includes(name)) return false;
    if (["aqua_affinity","bane_of_arthropods","blast_protection","breach","channeling","density","depth_strider","efficiency","feather_falling","fire_aspect","fire_protection","flame","fortune","frost_walker","impaling","infinity","knockback","looting","loyalty","luck_of_the_sea","lure","mending","multishot","piercing","power","projectile_protection","protection","punch","quick_charge","respiration","riptide","sharpness","silk_touch","smite","soul_speed","swift_sneak","thorns","unbreaking","vanishing","wind_burst","binding"].includes(name)) return false;
    return true;
  });
  return filtered.sort();
}

const COLORS = ["white","orange","magenta","light_blue","yellow","lime","pink","gray","light_gray","cyan","purple","blue","brown","green","red","black"];
function listColor(s) { return COLORS.map(c => `minecraft:${c}_${s}`); }
const WOOD_TYPES = ["oak","spruce","birch","jungle","acacia","dark_oak","mangrove","cherry","pale_oak"];

// ── 逐个定义家族（互斥） ──────────────────────────────────
const ALL = {};

// === 颜色变体系列（完全互斥） ===
ALL.wool = { id:"wool", displayName:"羊毛", items:listColor("wool") };
ALL.carpet = { id:"carpet", displayName:"地毯", items:listColor("carpet") };
ALL.stained_glass = { id:"stained_glass", displayName:"玻璃", items:[...listColor("stained_glass"), ...listColor("stained_glass_pane"), "minecraft:glass","minecraft:glass_pane","minecraft:tinted_glass"] };
ALL.concrete = { id:"concrete", displayName:"混凝土", items:listColor("concrete") };
ALL.concrete_powder = { id:"concrete_powder", displayName:"混凝土粉末", items:listColor("concrete_powder") };
ALL.terracotta = { id:"terracotta", displayName:"陶瓦", items:[...listColor("terracotta"), "minecraft:hardened_clay"] };
ALL.glazed_terracotta = { id:"glazed_terracotta", displayName:"带釉陶瓦", items:[...listColor("glazed_terracotta"), "minecraft:silver_glazed_terracotta"] };
ALL.shulker_box = { id:"shulker_box", displayName:"潜影盒", items:[...listColor("shulker_box"),"minecraft:undyed_shulker_box"] };
ALL.candle = { id:"candle", displayName:"蜡烛", items:[...listColor("candle"),"minecraft:candle"] };
ALL.dye = { id:"dye", displayName:"染料", items:listColor("dye") };
ALL.harness = { id:"harness", displayName:"挽具", items:listColor("harness") };
ALL.bundle = { id:"bundle", displayName:"同捆包", items:[..."white,orange,magenta,light_blue,yellow,lime,pink,gray,light_gray,cyan,purple,blue,brown,green,red,black".split(",").map(c=>`minecraft:${c}_bundle`),"minecraft:bundle"] };
ALL.bed = { id:"bed", displayName:"床", items:listColor("bed") };

// === 原木（log / wood / stripped / stems / hyphae） ===
const logItems = [];
for (const t of [...WOOD_TYPES,"crimson","warped"]) {
  if (t==="crimson") { logItems.push("minecraft:crimson_stem","minecraft:crimson_hyphae","minecraft:stripped_crimson_stem","minecraft:stripped_crimson_hyphae"); continue; }
  if (t==="warped") { logItems.push("minecraft:warped_stem","minecraft:warped_hyphae","minecraft:stripped_warped_stem","minecraft:stripped_warped_hyphae"); continue; }
  logItems.push(`minecraft:${t}_log`,`minecraft:${t}_wood`,`minecraft:stripped_${t}_log`,`minecraft:stripped_${t}_wood`);
}
logItems.push("minecraft:bamboo_block","minecraft:stripped_bamboo_block","minecraft:creaking_heart","minecraft:mangrove_roots");
ALL.logs = { id:"logs", displayName:"原木/菌柄", items:logItems };

// === 木制品（不含原木/树叶/树苗） ===
const woodItems = [];
for (const t of WOOD_TYPES) {
  const hasBoat = !["cherry","pale_oak"].includes(t);
  if (hasBoat) woodItems.push(`minecraft:${t}_boat`,`minecraft:${t}_chest_boat`);
  woodItems.push(`minecraft:${t}_planks`,`minecraft:${t}_slab`,`minecraft:${t}_stairs`,
    `minecraft:${t}_door`,`minecraft:${t}_trapdoor`,`minecraft:${t}_fence_gate`,
    `minecraft:${t}_sign`,`minecraft:${t}_hanging_sign`,`minecraft:${t}_button`,`minecraft:${t}_pressure_plate`,
    `minecraft:${t}_fence`);
}
woodItems.push("minecraft:fence_gate","minecraft:trapdoor","minecraft:wooden_door","minecraft:wooden_button","minecraft:wooden_pressure_plate");
woodItems.push("minecraft:bamboo_planks","minecraft:bamboo_slab","minecraft:bamboo_stairs","minecraft:bamboo_door","minecraft:bamboo_trapdoor","minecraft:bamboo_fence","minecraft:bamboo_fence_gate","minecraft:bamboo_sign","minecraft:bamboo_hanging_sign","minecraft:bamboo_button","minecraft:bamboo_pressure_plate","minecraft:bamboo_mosaic","minecraft:bamboo_mosaic_slab","minecraft:bamboo_mosaic_stairs","minecraft:bamboo_raft","minecraft:bamboo_chest_raft","minecraft:pale_oak_boat","minecraft:pale_oak_chest_boat","minecraft:cherry_boat","minecraft:cherry_chest_boat","minecraft:stick");
for (const t of ["crimson","warped"]) {
  woodItems.push(`minecraft:${t}_planks`,`minecraft:${t}_slab`,`minecraft:${t}_stairs`,
    `minecraft:${t}_door`,`minecraft:${t}_trapdoor`,`minecraft:${t}_fence`,`minecraft:${t}_fence_gate`,
    `minecraft:${t}_sign`,`minecraft:${t}_hanging_sign`,`minecraft:${t}_button`,`minecraft:${t}_pressure_plate`);
}
woodItems.push("minecraft:boat","minecraft:chest_boat","minecraft:petrified_oak_slab");
ALL.wood_products = { id:"wood_products", displayName:"木制品", items:woodItems };

// === 其他木制品 ===
ALL.wood_misc = { id:"wood_misc", displayName:"人工合成物",
  items:["minecraft:bowl","minecraft:ladder","minecraft:chest","minecraft:barrel",
    "minecraft:crafting_table","minecraft:enchanting_table","minecraft:cartography_table","minecraft:fletching_table","minecraft:smithing_table","minecraft:loom","minecraft:grindstone",
    "minecraft:lectern","minecraft:jukebox","minecraft:noteblock",
    "minecraft:scaffolding","minecraft:flower_pot","minecraft:armor_stand","minecraft:beehive","minecraft:bee_nest",
    "minecraft:bookshelf","minecraft:chiseled_bookshelf","minecraft:composter","minecraft:campfire",
    "minecraft:torch",
    "minecraft:lantern",
    "minecraft:painting","minecraft:frame","minecraft:glow_frame",
    "minecraft:furnace","minecraft:blast_furnace","minecraft:smoker",
    "minecraft:stonecutter_block",
    "minecraft:obsidian","minecraft:crying_obsidian",
    "minecraft:smooth_stone_slab",
    "minecraft:anvil","minecraft:chipped_anvil","minecraft:damaged_anvil",
    "minecraft:bell","minecraft:bone_block",
    "minecraft:honeycomb_block","minecraft:web",
  ] };

// === 石材建筑 ===
ALL.stone_building = { id:"stone_building", displayName:"石材建筑",
  items:["minecraft:stone","minecraft:smooth_stone","minecraft:cobblestone","minecraft:mossy_cobblestone",
    "minecraft:stone_bricks","minecraft:mossy_stone_bricks","minecraft:cracked_stone_bricks","minecraft:chiseled_stone_bricks",
    "minecraft:stone_stairs","minecraft:normal_stone_stairs","minecraft:cobblestone_stairs","minecraft:stone_brick_stairs","minecraft:mossy_cobblestone_stairs","minecraft:mossy_stone_brick_stairs",
    "minecraft:normal_stone_slab","minecraft:cobblestone_slab","minecraft:stone_brick_slab","minecraft:mossy_cobblestone_slab","minecraft:mossy_stone_brick_slab",
    "minecraft:cobblestone_wall","minecraft:stone_brick_wall","minecraft:mossy_cobblestone_wall","minecraft:mossy_stone_brick_wall",
    "minecraft:andesite","minecraft:andesite_stairs","minecraft:andesite_slab","minecraft:andesite_wall",
    "minecraft:polished_andesite","minecraft:polished_andesite_stairs","minecraft:polished_andesite_slab",
    "minecraft:diorite","minecraft:diorite_stairs","minecraft:diorite_slab","minecraft:diorite_wall",
    "minecraft:polished_diorite","minecraft:polished_diorite_stairs","minecraft:polished_diorite_slab",
    "minecraft:granite","minecraft:granite_stairs","minecraft:granite_slab","minecraft:granite_wall",
    "minecraft:polished_granite","minecraft:polished_granite_stairs","minecraft:polished_granite_slab",
    "minecraft:deepslate","minecraft:cobbled_deepslate","minecraft:polished_deepslate",
    "minecraft:deepslate_bricks","minecraft:deepslate_tiles","minecraft:cracked_deepslate_bricks","minecraft:cracked_deepslate_tiles","minecraft:chiseled_deepslate",
    "minecraft:cobbled_deepslate_stairs","minecraft:cobbled_deepslate_slab","minecraft:cobbled_deepslate_wall",
    "minecraft:polished_deepslate_stairs","minecraft:polished_deepslate_slab","minecraft:polished_deepslate_wall",
    "minecraft:deepslate_brick_stairs","minecraft:deepslate_brick_slab","minecraft:deepslate_brick_wall",
    "minecraft:deepslate_tile_stairs","minecraft:deepslate_tile_slab","minecraft:deepslate_tile_wall",
    "minecraft:tuff","minecraft:polished_tuff","minecraft:tuff_bricks","minecraft:chiseled_tuff","minecraft:chiseled_tuff_bricks",
    "minecraft:tuff_stairs","minecraft:tuff_slab","minecraft:tuff_wall",
    "minecraft:polished_tuff_stairs","minecraft:polished_tuff_slab","minecraft:polished_tuff_wall",
    "minecraft:tuff_brick_stairs","minecraft:tuff_brick_slab","minecraft:tuff_brick_wall",
    "minecraft:sandstone","minecraft:sandstone_stairs","minecraft:sandstone_slab","minecraft:sandstone_wall",
    "minecraft:cut_sandstone","minecraft:cut_sandstone_slab","minecraft:chiseled_sandstone","minecraft:smooth_sandstone",
    "minecraft:smooth_sandstone_stairs","minecraft:smooth_sandstone_slab",
    "minecraft:red_sandstone","minecraft:red_sandstone_stairs","minecraft:red_sandstone_slab","minecraft:red_sandstone_wall",
    "minecraft:cut_red_sandstone","minecraft:cut_red_sandstone_slab","minecraft:chiseled_red_sandstone","minecraft:smooth_red_sandstone",
    "minecraft:smooth_red_sandstone_stairs","minecraft:smooth_red_sandstone_slab",
    "minecraft:prismarine","minecraft:prismarine_stairs","minecraft:prismarine_slab","minecraft:prismarine_wall",
    "minecraft:prismarine_bricks","minecraft:prismarine_bricks_stairs","minecraft:prismarine_brick_slab",
    "minecraft:dark_prismarine","minecraft:dark_prismarine_stairs","minecraft:dark_prismarine_slab",
    "minecraft:purpur_block","minecraft:purpur_pillar","minecraft:purpur_slab","minecraft:purpur_stairs",
    "minecraft:quartz_block","minecraft:quartz_bricks","minecraft:quartz_pillar","minecraft:quartz_slab","minecraft:quartz_stairs",
    "minecraft:smooth_quartz","minecraft:smooth_quartz_slab","minecraft:smooth_quartz_stairs",
    "minecraft:brick_block","minecraft:brick_stairs","minecraft:brick_slab","minecraft:brick_wall",
    "minecraft:mud_bricks","minecraft:mud_brick_stairs","minecraft:mud_brick_slab","minecraft:mud_brick_wall",
    "minecraft:resin_bricks","minecraft:resin_brick_stairs","minecraft:resin_brick_slab","minecraft:resin_brick_wall",
    "minecraft:chiseled_resin_bricks","minecraft:resin_block","minecraft:resin_brick","minecraft:resin_clump",
    "minecraft:stone_button","minecraft:stone_pressure_plate",
    "minecraft:calcite","minecraft:pointed_dripstone","minecraft:dripstone_block",
    "minecraft:reinforced_deepslate",
  ] };

// === 装饰性石材 ===
ALL.decorative_stone = { id:"decorative_stone", displayName:"装饰性石材",
  items:[
    "minecraft:chain","minecraft:iron_bars",
    "minecraft:ochre_froglight","minecraft:pearlescent_froglight","minecraft:verdant_froglight",
    "minecraft:chiseled_quartz_block",
    "minecraft:amethyst_block","minecraft:budding_amethyst",
    "minecraft:sea_lantern",
    "minecraft:small_amethyst_bud","minecraft:medium_amethyst_bud","minecraft:large_amethyst_bud","minecraft:amethyst_cluster",
  ] };

// === 石材核心（被虫蚀方块等） ===
ALL.stone_core = { id:"stone_core", displayName:"石材核心",
  items:[
    "minecraft:infested_stone","minecraft:infested_cobblestone","minecraft:infested_stone_bricks",
    "minecraft:infested_mossy_stone_bricks","minecraft:infested_cracked_stone_bricks",
    "minecraft:infested_chiseled_stone_bricks","minecraft:infested_deepslate",
  ] };

// === 铜方块（不含铜锭/铜块/粗铜 — 这些在矿物族） ===
const copperVariants = ["cut_copper","chiseled_copper","copper_bulb","copper_grate","cut_copper_slab","cut_copper_stairs"];
const copperItems = [];
for (const pre of ["","exposed_","weathered_","oxidized_","waxed_","waxed_exposed_","waxed_weathered_","waxed_oxidized_"]) {
  for (const v of copperVariants) copperItems.push(`minecraft:${pre}${v}`);
}
// Also the base copper_block + its oxidation/wax variants
for (const pre of ["","exposed_","weathered_","oxidized_","waxed_","waxed_exposed_","waxed_weathered_","waxed_oxidized_"]) {
  if (["exposed_","weathered_","oxidized_","waxed_","waxed_exposed_","waxed_weathered_","waxed_oxidized_"].includes(pre)) copperItems.push(`minecraft:${pre}copper_block`);
}
copperItems.push("minecraft:copper_block","minecraft:exposed_copper","minecraft:weathered_copper","minecraft:oxidized_copper","minecraft:waxed_copper","minecraft:waxed_exposed_copper","minecraft:waxed_weathered_copper","minecraft:waxed_oxidized_copper");
// Copper doors and trapdoors
copperItems.push(
  "minecraft:copper_door","minecraft:exposed_copper_door","minecraft:weathered_copper_door","minecraft:oxidized_copper_door",
  "minecraft:copper_trapdoor","minecraft:exposed_copper_trapdoor","minecraft:weathered_copper_trapdoor","minecraft:oxidized_copper_trapdoor",
  "minecraft:waxed_copper_door","minecraft:waxed_exposed_copper_door","minecraft:waxed_weathered_copper_door","minecraft:waxed_oxidized_copper_door",
  "minecraft:waxed_copper_trapdoor","minecraft:waxed_exposed_copper_trapdoor","minecraft:waxed_weathered_copper_trapdoor","minecraft:waxed_oxidized_copper_trapdoor",
);
ALL.copper_blocks = { id:"copper_blocks", displayName:"铜方块", items:[...new Set(copperItems)].sort() };

// === 稀有矿物 ===
ALL.rare_minerals = { id:"rare_minerals", displayName:"稀有矿物",
  items:["minecraft:diamond","minecraft:diamond_block","minecraft:emerald","minecraft:emerald_block","minecraft:netherite_scrap","minecraft:netherite_ingot","minecraft:netherite_block"] };
ALL.rare_ores = { id:"rare_ores", displayName:"稀有矿石",
  items:["minecraft:diamond_ore","minecraft:deepslate_diamond_ore","minecraft:emerald_ore","minecraft:deepslate_emerald_ore","minecraft:ancient_debris"] };

// === 普通金属/矿物 ===
ALL.common_minerals = { id:"common_minerals", displayName:"普通金属矿物",
  items:["minecraft:iron_ingot","minecraft:iron_nugget","minecraft:iron_block","minecraft:gold_ingot","minecraft:gold_nugget","minecraft:gold_block",
    "minecraft:coal","minecraft:coal_block","minecraft:lapis_block","minecraft:lapis_lazuli",
    "minecraft:quartz","minecraft:raw_iron","minecraft:raw_iron_block","minecraft:raw_gold","minecraft:raw_gold_block",
    "minecraft:raw_copper","minecraft:raw_copper_block","minecraft:copper_ingot",
    "minecraft:amethyst_shard",
    "minecraft:charcoal","minecraft:flint",
    "minecraft:clay_ball","minecraft:brick",
  ] };
ALL.common_ores = { id:"common_ores", displayName:"普通矿石",
  items:["minecraft:iron_ore","minecraft:deepslate_iron_ore","minecraft:gold_ore","minecraft:deepslate_gold_ore",
    "minecraft:copper_ore","minecraft:deepslate_copper_ore","minecraft:coal_ore","minecraft:deepslate_coal_ore",
    "minecraft:lapis_ore","minecraft:deepslate_lapis_ore","minecraft:redstone_ore","minecraft:deepslate_redstone_ore",
    "minecraft:quartz_ore","minecraft:nether_gold_ore","minecraft:gilded_blackstone",
  ] };

// === 可穿戴装备 ===
const wear = [];
for (const m of ["leather","chainmail","iron","golden","diamond","netherite"]) {
  wear.push(`minecraft:${m}_helmet`,`minecraft:${m}_chestplate`,`minecraft:${m}_leggings`,`minecraft:${m}_boots`);
}
wear.push("minecraft:turtle_helmet","minecraft:elytra","minecraft:wolf_armor","minecraft:shield");
for (const m of ["leather","iron","golden","diamond"]) wear.push(`minecraft:${m}_horse_armor`);
ALL.wearables = { id:"wearables", displayName:"可穿戴装备", items:wear };

// === 武器 ===
ALL.weapons = { id:"weapons", displayName:"武器",
  items:["minecraft:wooden_sword","minecraft:stone_sword","minecraft:iron_sword","minecraft:golden_sword","minecraft:diamond_sword","minecraft:netherite_sword",
    "minecraft:bow","minecraft:crossbow","minecraft:trident","minecraft:mace",
    "minecraft:wooden_pickaxe","minecraft:stone_pickaxe","minecraft:iron_pickaxe","minecraft:golden_pickaxe","minecraft:diamond_pickaxe","minecraft:netherite_pickaxe",
    "minecraft:wooden_axe","minecraft:stone_axe","minecraft:iron_axe","minecraft:golden_axe","minecraft:diamond_axe","minecraft:netherite_axe",
    "minecraft:wooden_shovel","minecraft:stone_shovel","minecraft:iron_shovel","minecraft:golden_shovel","minecraft:diamond_shovel","minecraft:netherite_shovel",
  ] };

// === 弹射物 ===
ALL.projectiles = { id:"projectiles", displayName:"弹射物",
  items:["minecraft:arrow","minecraft:snowball","minecraft:experience_bottle","minecraft:wind_charge"] };

// === 工具 ===
ALL.tools = { id:"tools", displayName:"工具",
  items:["minecraft:wooden_hoe","minecraft:stone_hoe","minecraft:iron_hoe","minecraft:golden_hoe","minecraft:diamond_hoe","minecraft:netherite_hoe",
    "minecraft:shears","minecraft:fishing_rod","minecraft:flint_and_steel","minecraft:brush","minecraft:spyglass","minecraft:clock","minecraft:compass","minecraft:recovery_compass",
    "minecraft:minecart","minecraft:chest_minecart","minecraft:hopper_minecart","minecraft:tnt_minecart",
    "minecraft:carrot_on_a_stick","minecraft:warped_fungus_on_a_stick","minecraft:lead","minecraft:name_tag","minecraft:saddle",
    "minecraft:lodestone_compass",
  ] };

// === 桶与桶装物 ===
ALL.buckets = { id:"buckets", displayName:"桶",
  items:["minecraft:bucket","minecraft:water_bucket","minecraft:lava_bucket","minecraft:milk_bucket","minecraft:powder_snow_bucket",
    "minecraft:axolotl_bucket","minecraft:cod_bucket","minecraft:pufferfish_bucket","minecraft:salmon_bucket","minecraft:tadpole_bucket","minecraft:tropical_fish_bucket"] };

// === 红石 ===
ALL.redstone = { id:"redstone", displayName:"红石及原件",
  items:["minecraft:redstone","minecraft:redstone_block","minecraft:redstone_torch","minecraft:redstone_lamp",
    "minecraft:repeater","minecraft:comparator","minecraft:observer","minecraft:piston","minecraft:sticky_piston",
    "minecraft:dispenser","minecraft:dropper","minecraft:hopper","minecraft:crafter",
    "minecraft:target","minecraft:lightning_rod","minecraft:daylight_detector","minecraft:calibrated_sculk_sensor",
    "minecraft:lever","minecraft:tripwire_hook","minecraft:trapped_chest",
    "minecraft:heavy_weighted_pressure_plate","minecraft:light_weighted_pressure_plate",
    "minecraft:iron_door","minecraft:iron_trapdoor",
    "minecraft:rail","minecraft:activator_rail","minecraft:detector_rail","minecraft:golden_rail",
    "minecraft:sculk_sensor",
    "minecraft:tnt",
    "minecraft:honey_block",
  ] };

// === 农作物与食物（不含植物/树苗/花） ===
ALL.crops_food = { id:"crops_food", displayName:"农作物与食物",
  items:["minecraft:wheat","minecraft:wheat_seeds","minecraft:carrot","minecraft:potato","minecraft:poisonous_potato","minecraft:baked_potato",
    "minecraft:beetroot","minecraft:beetroot_seeds",
    "minecraft:melon_block","minecraft:melon_slice","minecraft:melon_seeds",
    "minecraft:pumpkin","minecraft:pumpkin_seeds","minecraft:carved_pumpkin","minecraft:lit_pumpkin","minecraft:pumpkin_pie",
    "minecraft:apple","minecraft:golden_apple","minecraft:enchanted_golden_apple",
    "minecraft:chorus_fruit",
    "minecraft:bread","minecraft:cookie","minecraft:cake","minecraft:mushroom_stew","minecraft:rabbit_stew","minecraft:beetroot_soup","minecraft:suspicious_stew",
    "minecraft:honey_bottle","minecraft:sweet_berries","minecraft:glow_berries",
    "minecraft:porkchop","minecraft:cooked_porkchop","minecraft:beef","minecraft:cooked_beef",
    "minecraft:chicken","minecraft:cooked_chicken","minecraft:rabbit","minecraft:cooked_rabbit",
    "minecraft:mutton","minecraft:cooked_mutton","minecraft:cod","minecraft:cooked_cod","minecraft:salmon","minecraft:cooked_salmon",
    "minecraft:pufferfish","minecraft:tropical_fish",
    "minecraft:dried_kelp","minecraft:kelp","minecraft:sugar_cane","minecraft:cocoa_beans",
    "minecraft:hay_block","minecraft:dried_kelp_block",
    "minecraft:bone_meal",
  ] };

// === 植物与树苗 ===
ALL.plants = { id:"plants", displayName:"植物与树苗",
  items:["minecraft:short_grass","minecraft:tall_grass","minecraft:fern","minecraft:large_fern","minecraft:short_dry_grass","minecraft:tall_dry_grass",
    "minecraft:deadbush","minecraft:vine",
    "minecraft:hanging_roots","minecraft:moss_block","minecraft:moss_carpet","minecraft:pale_moss_block","minecraft:pale_moss_carpet","minecraft:pale_hanging_moss",
    "minecraft:big_dripleaf","minecraft:small_dripleaf_block","minecraft:spore_blossom",
    "minecraft:cactus","minecraft:cactus_flower","minecraft:bamboo","minecraft:seagrass","minecraft:glow_lichen",
    "minecraft:azalea","minecraft:flowering_azalea",
    "minecraft:pitcher_plant","minecraft:pitcher_pod","minecraft:torchflower","minecraft:torchflower_seeds",
    "minecraft:pink_petals","minecraft:leaf_litter","minecraft:wildflowers",
    "minecraft:waterlily","minecraft:sea_pickle",
    "minecraft:brown_mushroom","minecraft:red_mushroom","minecraft:brown_mushroom_block","minecraft:red_mushroom_block","minecraft:mushroom_stem",
    "minecraft:firefly_bush","minecraft:bush",
    "minecraft:closed_eyeblossom","minecraft:open_eyeblossom",
    ...WOOD_TYPES.flatMap(t => t==="crimson"||t==="warped"?[]:[`minecraft:${t}_leaves`,`minecraft:${t}_sapling`]),
    "minecraft:mangrove_propagule","minecraft:azalea_leaves","minecraft:azalea_leaves_flowered",
  ] };

// === 花（装饰性花朵，不含蘑菇/菌类） ===
ALL.flowers = { id:"flowers", displayName:"花",
  items:["minecraft:dandelion","minecraft:poppy","minecraft:blue_orchid","minecraft:allium","minecraft:azure_bluet",
    "minecraft:red_tulip","minecraft:orange_tulip","minecraft:white_tulip","minecraft:pink_tulip",
    "minecraft:oxeye_daisy","minecraft:cornflower","minecraft:lily_of_the_valley","minecraft:wither_rose",
    "minecraft:sunflower","minecraft:lilac","minecraft:rose_bush","minecraft:peony",
  ] };

// === 珊瑚 ===
ALL.coral = { id:"coral", displayName:"珊瑚",
  items:"tube_coral,brain_coral,bubble_coral,fire_coral,horn_coral".split(",").flatMap(base =>
    [`minecraft:${base}`,`minecraft:${base}_block`,`minecraft:${base}_fan`,
     `minecraft:dead_${base}`,`minecraft:dead_${base}_block`,`minecraft:dead_${base}_fan`])
};

// === 地狱物品（不含与 stone_building 重叠的项目） ===
ALL.nether = { id:"nether", displayName:"地狱物品",
  items:["minecraft:netherrack","minecraft:crimson_nylium","minecraft:warped_nylium","minecraft:soul_sand","minecraft:soul_soil",
    "minecraft:glowstone","minecraft:glowstone_dust","minecraft:shroomlight",
    "minecraft:nether_wart_block","minecraft:warped_wart_block",
    "minecraft:magma","minecraft:respawn_anchor",
    "minecraft:nether_brick","minecraft:netherbrick","minecraft:nether_brick_fence","minecraft:nether_brick_stairs","minecraft:nether_brick_slab","minecraft:nether_brick_wall",
    "minecraft:red_nether_brick","minecraft:red_nether_brick_stairs","minecraft:red_nether_brick_slab","minecraft:red_nether_brick_wall",
    "minecraft:chiseled_nether_bricks","minecraft:cracked_nether_bricks",
    "minecraft:weeping_vines","minecraft:twisting_vines","minecraft:nether_sprouts",
    "minecraft:warped_roots","minecraft:crimson_roots","minecraft:crimson_fungus","minecraft:warped_fungus",
    "minecraft:basalt","minecraft:polished_basalt","minecraft:smooth_basalt",
    "minecraft:blackstone","minecraft:cracked_polished_blackstone_bricks","minecraft:chiseled_polished_blackstone",
    "minecraft:blackstone_stairs","minecraft:blackstone_slab","minecraft:blackstone_wall",
    "minecraft:polished_blackstone","minecraft:polished_blackstone_stairs","minecraft:polished_blackstone_slab","minecraft:polished_blackstone_wall",
    "minecraft:polished_blackstone_bricks","minecraft:polished_blackstone_brick_stairs","minecraft:polished_blackstone_brick_slab","minecraft:polished_blackstone_brick_wall",
    "minecraft:polished_blackstone_button","minecraft:polished_blackstone_pressure_plate",
  ] };

// === 末地物品 ===
ALL.end = { id:"end", displayName:"末地物品",
  items:["minecraft:end_stone","minecraft:end_bricks","minecraft:end_brick_stairs","minecraft:end_stone_brick_slab","minecraft:end_stone_brick_wall",
    "minecraft:end_portal_frame","minecraft:ender_chest",
    "minecraft:dragon_head",
    "minecraft:ender_eye","minecraft:ender_pearl","minecraft:shulker_shell","minecraft:chorus_flower","minecraft:chorus_plant",
    "minecraft:popped_chorus_fruit",
  ] };

// === 地表常见方块 ===
ALL.surface = { id:"surface", displayName:"地表方块",
  items:["minecraft:grass_block","minecraft:dirt","minecraft:coarse_dirt","minecraft:dirt_with_roots","minecraft:podzol","minecraft:mycelium",
    "minecraft:sand","minecraft:red_sand","minecraft:gravel","minecraft:clay","minecraft:mud","minecraft:packed_mud","minecraft:muddy_mangrove_roots",
    "minecraft:snow","minecraft:snow_layer","minecraft:ice","minecraft:packed_ice","minecraft:blue_ice",
    "minecraft:grass_path","minecraft:farmland","minecraft:suspicious_sand","minecraft:suspicious_gravel",
    "minecraft:frog_spawn",
    "minecraft:frosted_ice",
  ] };

// === 友好生物掉落物 ===
ALL.friendly_drops = { id:"friendly_drops", displayName:"友好生物掉落",
  items:["minecraft:feather","minecraft:leather","minecraft:rabbit_hide",
    "minecraft:egg","minecraft:turtle_egg","minecraft:sniffer_egg",
    "minecraft:turtle_scute","minecraft:armadillo_scute",
    "minecraft:ink_sac","minecraft:glow_ink_sac",
    "minecraft:honeycomb","minecraft:goat_horn",
  ] };

// === 敌对生物掉落物（不与末地/药水重叠） ===
ALL.hostile_drops = { id:"hostile_drops", displayName:"敌对生物掉落",
  items:["minecraft:rotten_flesh","minecraft:bone","minecraft:phantom_membrane",
    "minecraft:skeleton_skull","minecraft:wither_skeleton_skull",
    "minecraft:zombie_head","minecraft:creeper_head","minecraft:player_head","minecraft:piglin_head",
    "minecraft:breeze_rod",
    "minecraft:string","minecraft:slime_ball",
    "minecraft:prismarine_shard","minecraft:prismarine_crystals",
    "minecraft:sponge","minecraft:wet_sponge",
  ] };

// === 道具 ===
ALL.accessories = { id:"accessories", displayName:"道具",
  items:["minecraft:trial_key","minecraft:ominous_trial_key","minecraft:ominous_bottle",
    "minecraft:fire_charge","minecraft:firework_rocket","minecraft:firework_star","minecraft:fireworks_rocket",
    "minecraft:blue_egg","minecraft:brown_egg","minecraft:xp_bottle",
  ] };

// === 附魔 ===
ALL.enchanted = { id:"enchanted", displayName:"附魔",
  items:["minecraft:enchanted_book"] };

// === 书与地图 ===
ALL.books_maps = { id:"books_maps", displayName:"书与地图",
  items:["minecraft:paper","minecraft:book","minecraft:writable_book","minecraft:filled_map","minecraft:empty_map"] };

// === 药水与酿造 ===
ALL.potions = { id:"potions", displayName:"药水与酿造",
  items:["minecraft:potion","minecraft:splash_potion","minecraft:lingering_potion",
    "minecraft:glass_bottle","minecraft:brewing_stand","minecraft:cauldron",
    "minecraft:nether_wart","minecraft:blaze_powder","minecraft:blaze_rod","minecraft:magma_cream",
    "minecraft:fermented_spider_eye","minecraft:glistering_melon_slice","minecraft:golden_carrot",
    "minecraft:rabbit_foot","minecraft:ghast_tear","minecraft:dragon_breath",
    "minecraft:spider_eye","minecraft:gunpowder",
    "minecraft:sugar",
  ] };

// === 唱片 ===
ALL.music_disc = { id:"music_disc", displayName:"唱片",
  items:["minecraft:music_disc_13","minecraft:music_disc_cat","minecraft:music_disc_blocks","minecraft:music_disc_chirp",
    "minecraft:music_disc_creator","minecraft:music_disc_creator_music_box","minecraft:music_disc_far",
    "minecraft:music_disc_mall","minecraft:music_disc_mellohi","minecraft:music_disc_otherside",
    "minecraft:music_disc_pigstep","minecraft:music_disc_precipice","minecraft:music_disc_relic",
    "minecraft:music_disc_stal","minecraft:music_disc_strad","minecraft:music_disc_tears",
    "minecraft:music_disc_wait","minecraft:music_disc_ward","minecraft:music_disc_11","minecraft:music_disc_5",
    "minecraft:disc_fragment_5",
  ] };

// === 宝藏 ===
ALL.treasure = { id:"treasure", displayName:"宝藏",
  items:["minecraft:beacon","minecraft:conduit","minecraft:dragon_egg",
    "minecraft:end_crystal","minecraft:end_rod","minecraft:heart_of_the_sea","minecraft:heavy_core",
    "minecraft:lodestone","minecraft:mob_spawner","minecraft:nether_star","minecraft:totem_of_undying",
    "minecraft:trial_spawner","minecraft:vault",
    "minecraft:nautilus_shell","minecraft:echo_shard",
  ] };

// === 古城方块 ===
ALL.ancient_city = { id:"ancient_city", displayName:"古城方块",
  items:["minecraft:sculk","minecraft:sculk_vein","minecraft:sculk_catalyst","minecraft:sculk_shrieker",
    "minecraft:soul_torch","minecraft:soul_lantern","minecraft:soul_campfire",
  ] };

// === 刷怪蛋 ===
ALL.spawn_eggs = { id:"spawn_eggs", displayName:"刷怪蛋",
  items:[
    "minecraft:allay_spawn_egg","minecraft:armadillo_spawn_egg","minecraft:axolotl_spawn_egg",
    "minecraft:bat_spawn_egg","minecraft:bee_spawn_egg","minecraft:blaze_spawn_egg",
    "minecraft:bogged_spawn_egg","minecraft:breeze_spawn_egg","minecraft:camel_spawn_egg",
    "minecraft:cat_spawn_egg","minecraft:cave_spider_spawn_egg","minecraft:chicken_spawn_egg",
    "minecraft:cod_spawn_egg","minecraft:cow_spawn_egg","minecraft:creaking_spawn_egg",
    "minecraft:creeper_spawn_egg","minecraft:dolphin_spawn_egg","minecraft:donkey_spawn_egg",
    "minecraft:drowned_spawn_egg","minecraft:elder_guardian_spawn_egg","minecraft:ender_dragon_spawn_egg",
    "minecraft:enderman_spawn_egg","minecraft:endermite_spawn_egg","minecraft:evoker_spawn_egg",
    "minecraft:fox_spawn_egg","minecraft:frog_spawn_egg","minecraft:ghast_spawn_egg",
    "minecraft:glow_squid_spawn_egg","minecraft:goat_spawn_egg","minecraft:guardian_spawn_egg",
    "minecraft:happy_ghast_spawn_egg","minecraft:hoglin_spawn_egg","minecraft:horse_spawn_egg",
    "minecraft:husk_spawn_egg","minecraft:iron_golem_spawn_egg","minecraft:llama_spawn_egg",
    "minecraft:magma_cube_spawn_egg","minecraft:mooshroom_spawn_egg","minecraft:mule_spawn_egg",
    "minecraft:ocelot_spawn_egg","minecraft:panda_spawn_egg","minecraft:parrot_spawn_egg",
    "minecraft:phantom_spawn_egg","minecraft:pig_spawn_egg","minecraft:piglin_brute_spawn_egg",
    "minecraft:piglin_spawn_egg","minecraft:pillager_spawn_egg","minecraft:polar_bear_spawn_egg",
    "minecraft:pufferfish_spawn_egg","minecraft:rabbit_spawn_egg","minecraft:ravager_spawn_egg",
    "minecraft:salmon_spawn_egg","minecraft:sheep_spawn_egg","minecraft:shulker_spawn_egg",
    "minecraft:silverfish_spawn_egg","minecraft:skeleton_horse_spawn_egg","minecraft:skeleton_spawn_egg",
    "minecraft:slime_spawn_egg","minecraft:sniffer_spawn_egg","minecraft:snow_golem_spawn_egg",
    "minecraft:spider_spawn_egg","minecraft:squid_spawn_egg","minecraft:stray_spawn_egg",
    "minecraft:strider_spawn_egg","minecraft:tadpole_spawn_egg","minecraft:trader_llama_spawn_egg",
    "minecraft:tropical_fish_spawn_egg","minecraft:turtle_spawn_egg","minecraft:vex_spawn_egg",
    "minecraft:villager_spawn_egg","minecraft:vindicator_spawn_egg","minecraft:wandering_trader_spawn_egg",
    "minecraft:warden_spawn_egg","minecraft:witch_spawn_egg","minecraft:wither_skeleton_spawn_egg",
    "minecraft:wither_spawn_egg","minecraft:wolf_spawn_egg","minecraft:zoglin_spawn_egg",
    "minecraft:zombie_horse_spawn_egg","minecraft:zombie_pigman_spawn_egg","minecraft:zombie_spawn_egg",
    "minecraft:zombie_villager_spawn_egg",
  ] };

// === 锻造模板 ===
ALL.smithing_templates = { id:"smithing_templates", displayName:"锻造模板",
  items:["minecraft:bolt_armor_trim_smithing_template","minecraft:coast_armor_trim_smithing_template",
    "minecraft:dune_armor_trim_smithing_template","minecraft:eye_armor_trim_smithing_template",
    "minecraft:flow_armor_trim_smithing_template","minecraft:host_armor_trim_smithing_template",
    "minecraft:netherite_upgrade_smithing_template","minecraft:raiser_armor_trim_smithing_template",
    "minecraft:rib_armor_trim_smithing_template","minecraft:sentry_armor_trim_smithing_template",
    "minecraft:shaper_armor_trim_smithing_template","minecraft:silence_armor_trim_smithing_template",
    "minecraft:snout_armor_trim_smithing_template","minecraft:spire_armor_trim_smithing_template",
    "minecraft:tide_armor_trim_smithing_template","minecraft:vex_armor_trim_smithing_template",
    "minecraft:ward_armor_trim_smithing_template","minecraft:wayfinder_armor_trim_smithing_template",
    "minecraft:wild_armor_trim_smithing_template",
  ] };

// === 陶片 ===
ALL.pottery_sherds = { id:"pottery_sherds", displayName:"陶片",
  items:["minecraft:angler_pottery_sherd","minecraft:archer_pottery_sherd","minecraft:arms_up_pottery_sherd",
    "minecraft:blade_pottery_sherd","minecraft:brewer_pottery_sherd","minecraft:burn_pottery_sherd",
    "minecraft:danger_pottery_sherd","minecraft:explorer_pottery_sherd","minecraft:flow_pottery_sherd",
    "minecraft:friend_pottery_sherd","minecraft:guster_pottery_sherd","minecraft:heart_pottery_sherd",
    "minecraft:heartbreak_pottery_sherd","minecraft:howl_pottery_sherd","minecraft:miner_pottery_sherd",
    "minecraft:mourner_pottery_sherd","minecraft:plenty_pottery_sherd","minecraft:prize_pottery_sherd",
    "minecraft:scrape_pottery_sherd","minecraft:sheaf_pottery_sherd","minecraft:shelter_pottery_sherd",
    "minecraft:skull_pottery_sherd","minecraft:snort_pottery_sherd","minecraft:decorated_pot",
  ] };

// === 旗帜图案 ===
ALL.banner_patterns = { id:"banner_patterns", displayName:"旗帜图案",
  items:["minecraft:banner","minecraft:bordure_indented_banner_pattern","minecraft:creeper_banner_pattern",
    "minecraft:field_masoned_banner_pattern","minecraft:flow_banner_pattern","minecraft:flower_banner_pattern",
    "minecraft:globe_banner_pattern","minecraft:guster_banner_pattern","minecraft:mojang_banner_pattern",
    "minecraft:piglin_banner_pattern","minecraft:skull_banner_pattern",
  ] };

// === 创造专属 ===
ALL.creative_only = { id:"creative_only", displayName:"创造专属",
  items:["minecraft:agent","minecraft:allow","minecraft:barrier","minecraft:bedrock",
    "minecraft:border_block","minecraft:chain_command_block","minecraft:command_block","minecraft:deny",
    "minecraft:jigsaw","minecraft:light_block_0","minecraft:light_block_1","minecraft:light_block_10",
    "minecraft:light_block_11","minecraft:light_block_12","minecraft:light_block_13","minecraft:light_block_14",
    "minecraft:light_block_15","minecraft:light_block_2","minecraft:light_block_3","minecraft:light_block_4",
    "minecraft:light_block_5","minecraft:light_block_6","minecraft:light_block_7","minecraft:light_block_8",
    "minecraft:light_block_9","minecraft:npc","minecraft:repeating_command_block","minecraft:command_block_minecart","minecraft:structure_block",
    "minecraft:structure_void","minecraft:tripod_camera",
  ] };

// ── 验证 ──────────────────────────────────────────────────
const allIds = extractItemIds();
const assigned = new Set();
const typeToFamily = {};
const conflicts = [];

for (const [key, family] of Object.entries(ALL)) {
  for (const item of family.items) {
    if (typeToFamily[item]) {
      conflicts.push(`${item}: ${typeToFamily[item]} vs ${key}`);
      continue;
    }
    typeToFamily[item] = key;
    assigned.add(item);
  }
}
const leftovers = allIds.filter(id => !assigned.has(id));

console.log(`总物品: ${allIds.length}`);
console.log(`已分类: ${assigned.size}`);
console.log(`未分类: ${leftovers.length}`);
console.log(`冲突: ${conflicts.length}`);
if (conflicts.length) { console.log("\n冲突:"); conflicts.forEach(c => console.log(`  ${c}`)); }
if (leftovers.length) { console.log("\n未分类物品（前50）:"); leftovers.slice(0,50).forEach(id => console.log(`  ${id}`)); }

// ── 输出 TS 文件 ────────────────────────────────────────
let ts = `/**
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

import type { ItemFamily } from "../types";

`;

for (const [key, family] of Object.entries(ALL)) {
  ts += `const ${key}: ItemFamily = {\n`;
  ts += `  id: "${family.id}",\n`;
  ts += `  displayName: "${family.displayName}",\n`;
  ts += `  items: [\n`;
  for (const item of family.items) {
    ts += `    "${item}",\n`;
  }
  ts += `  ],\n`;
  ts += `};\n\n`;
}

ts += `export const ALL_FAMILIES: readonly ItemFamily[] = [\n`;
for (const key of Object.keys(ALL)) {
  ts += `  ${key},\n`;
}
ts += `];\n`;

// Also add the helper functions at the bottom
ts += `
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
`;

fs.writeFileSync(OUT, ts);
console.log(`\n已写入 ${OUT}`);
console.log(`总家族: ${Object.keys(ALL).length}`);
