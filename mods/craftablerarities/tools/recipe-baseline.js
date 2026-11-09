// 迁移前配方基线:由 tools/build-recipe-baseline.js 生成,供 tools/verify-recipes.js 比对。
// 每个配方归一化为 { kind, pattern, materials, result, count } 五元组,
// 归一化规则刻意抹平本次规范化会改变的部分(命名空间、前缀、大小写别名、辅助值写法)。
module.exports = {
  "moving_block": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "ACA"
    ],
    "materials": [
      "A=redstone",
      "B=piston",
      "C=sticky_piston"
    ],
    "result": "moving_block",
    "count": 1
  },
  "nether_star": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "BBB",
      "CBC"
    ],
    "materials": [
      "A=wither_skeleton_skull",
      "B=soul_sand",
      "C=tnt"
    ],
    "result": "nether_star",
    "count": 1
  },
  "nether_star_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "BBB",
      "CBC"
    ],
    "materials": [
      "A=wither_skeleton_skull",
      "B=soul_soil",
      "C=tnt"
    ],
    "result": "nether_star",
    "count": 1
  },
  "netherreactor": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=iron_ingot",
      "B=diamond",
      "C=gold_block"
    ],
    "result": "netherreactor",
    "count": 1
  },
  "nether_wart": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "nether_wart_block"
    ],
    "result": "nether_wart",
    "count": 9
  },
  "portal": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=obsidian",
      "B=purple_stained_glass_pane"
    ],
    "result": "portal",
    "count": 8
  },
  "zombie_spawn_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=egg",
      "B=zombie_head"
    ],
    "result": "zombie_spawn_egg",
    "count": 1
  },
  "wither_spawn_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "BBB",
      " B "
    ],
    "materials": [
      "A=wither_skeleton_skull",
      "B=soul_sand"
    ],
    "result": "wither_spawn_egg",
    "count": 1
  },
  "wither_spawn_egg_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "BBB",
      " B "
    ],
    "materials": [
      "A=wither_skeleton_skull",
      "B=soul_soil"
    ],
    "result": "wither_spawn_egg",
    "count": 1
  },
  "stonecutter_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=cobblestone",
      "B=stonecutter_block"
    ],
    "result": "stonecutter",
    "count": 1
  },
  "glow_lichen": {
    "kind": "recipe_shaped",
    "pattern": [
      "AB"
    ],
    "materials": [
      "A=glow_berries",
      "B=vine"
    ],
    "result": "glow_lichen",
    "count": 1
  },
  "glowingobsidian": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=obsidian",
      "B=nether_wart_block",
      "C=blaze_powder"
    ],
    "result": "glowingobsidian",
    "count": 8
  },
  "dispenser_1": {
    "kind": "recipe_shaped",
    "pattern": [
      " AB",
      "ACB",
      " AB"
    ],
    "materials": [
      "A=stick",
      "B=string",
      "C=dropper"
    ],
    "result": "dispenser",
    "count": 1
  },
  "command_block": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=orange_terracotta",
      "B=redstone",
      "C=netherreactor"
    ],
    "result": "command_block",
    "count": 1
  },
  "bedrock": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=obsidian",
      "B=reinforced_deepslate"
    ],
    "result": "bedrock",
    "count": 8
  },
  "client_request_placeholder_block": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABB",
      "ACB",
      "AAB"
    ],
    "materials": [
      "A=bedrock",
      "B=redstone",
      "C=moss_block"
    ],
    "result": "client_request_placeholder_block",
    "count": 1
  },
  "spore_blossom": {
    "kind": "recipe_shaped",
    "pattern": [
      " A",
      " B ",
      "B B"
    ],
    "materials": [
      "A=moss_block",
      "B=pink_tulip"
    ],
    "result": "spore_blossom",
    "count": 1
  },
  "spore_blossom_1": {
    "kind": "recipe_shaped",
    "pattern": [
      " A",
      " B ",
      "B B"
    ],
    "materials": [
      "A=moss_block",
      "B=peony"
    ],
    "result": "spore_blossom",
    "count": 1
  },
  "barrier": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "bedrock"
    ],
    "result": "barrier",
    "count": 1
  },
  "sculk_catalyst": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=sculk",
      "B=bone_block",
      "C=soul_soil"
    ],
    "result": "sculk_catalyst",
    "count": 1
  },
  "reinforced_deepslate": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BBB",
      "ABA"
    ],
    "materials": [
      "A=sculk_catalyst",
      "B=deepslate"
    ],
    "result": "reinforced_deepslate",
    "count": 1
  },
  "end_gateway": {
    "kind": "recipe_shaped",
    "pattern": [
      " A ",
      "ABA",
      " A "
    ],
    "materials": [
      "A=bedrock",
      "B=ender_eye"
    ],
    "result": "end_gateway",
    "count": 1
  },
  "calcite": {
    "kind": "recipe_shaped",
    "pattern": [
      "AB",
      "BA"
    ],
    "materials": [
      "A=quartz_block",
      "B=diorite"
    ],
    "result": "calcite",
    "count": 4
  },
  "end_portal": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=end_portal_frame",
      "B=ender_eye"
    ],
    "result": "end_portal",
    "count": 1
  },
  "end_portal_frame": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=end_stone",
      "B=ender_eye"
    ],
    "result": "end_portal_frame",
    "count": 1
  },
  "ender_dragon_spawn_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      "EBE",
      "BCB",
      "EBE"
    ],
    "materials": [
      "B=bedrock",
      "C=dragon_head",
      "E=end_crystal"
    ],
    "result": "ender_dragon_spawn_egg",
    "count": 1
  },
  "bubble_column": {
    "kind": "recipe_shaped",
    "pattern": [
      "A",
      "B"
    ],
    "materials": [
      "A=water",
      "B=soul_sand"
    ],
    "result": "bubble_column#1",
    "count": 1
  },
  "bubble_column_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "A",
      "B"
    ],
    "materials": [
      "A=water",
      "B=magma"
    ],
    "result": "bubble_column#0",
    "count": 1
  },
  "water_ice": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=ice"
    ],
    "result": "water",
    "count": 4
  },
  "piston_arm_collision": {
    "kind": "recipe_shaped",
    "pattern": [
      "AB"
    ],
    "materials": [
      "A=piston",
      "B=redstone"
    ],
    "result": "piston_arm_collision",
    "count": 1
  },
  "sticky_piston_arm_collision": {
    "kind": "recipe_shaped",
    "pattern": [
      "AB"
    ],
    "materials": [
      "A=sticky_piston",
      "B=redstone"
    ],
    "result": "piston_arm_collision",
    "count": 1
  },
  "flowing_water": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "blue_ice"
    ],
    "result": "flowing_water",
    "count": 1
  },
  "heart_of_the_sea": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=prismarine_shard",
      "B=prismarine_crystals",
      "C=sea_lantern"
    ],
    "result": "heart_of_the_sea",
    "count": 1
  },
  "sponge": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=yellow_wool",
      "B=hay_block",
      "C=slime_ball"
    ],
    "result": "sponge",
    "count": 4
  },
  "cobbled_deepslate_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=cobblestone"
    ],
    "result": "cobbled_deepslate",
    "count": 4
  },
  "camera": {
    "kind": "recipe_shaped",
    "pattern": [
      " A",
      " B ",
      "B B"
    ],
    "materials": [
      "A=barrier",
      "B=stick"
    ],
    "result": "camera",
    "count": 1
  },
  "coral-2": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "bubble_coral_block"
    ],
    "result": "bubble_coral",
    "count": 4
  },
  "coral-3": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "fire_coral_block"
    ],
    "result": "fire_coral",
    "count": 4
  },
  "coral-0": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "tube_coral_block"
    ],
    "result": "tube_coral",
    "count": 4
  },
  "coral-1": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "brain_coral_block"
    ],
    "result": "brain_coral",
    "count": 4
  },
  "coral-4": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "horn_coral_block"
    ],
    "result": "horn_coral",
    "count": 4
  },
  "coral_block-2": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=bubble_coral"
    ],
    "result": "bubble_coral_block",
    "count": 1
  },
  "coral_block-3": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=fire_coral"
    ],
    "result": "fire_coral_block",
    "count": 1
  },
  "coral_block-0": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=tube_coral"
    ],
    "result": "tube_coral_block",
    "count": 1
  },
  "coral_block-1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=brain_coral"
    ],
    "result": "brain_coral_block",
    "count": 1
  },
  "coral_block-4": {
    "kind": "recipe_shaped",
    "pattern": [
      "AA",
      "AA"
    ],
    "materials": [
      "A=horn_coral"
    ],
    "result": "horn_coral_block",
    "count": 1
  },
  "lodestone_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=chiseled_stone_bricks",
      "B=redstone"
    ],
    "result": "lodestone",
    "count": 1
  },
  "chest_1": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=log"
    ],
    "result": "chest",
    "count": 4
  },
  "chest_2": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=log2"
    ],
    "result": "chest",
    "count": 4
  },
  "chest_3": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=mangrove_log"
    ],
    "result": "chest",
    "count": 4
  },
  "chest_4": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=cherry_log"
    ],
    "result": "chest",
    "count": 4
  },
  "chest_5": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=crimson_stem"
    ],
    "result": "chest",
    "count": 4
  },
  "chest_6": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "AAA"
    ],
    "materials": [
      "A=warped_stem"
    ],
    "result": "chest",
    "count": 4
  },
  "budding_amethyst": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BAB",
      "ABA"
    ],
    "materials": [
      "A=amethyst_block",
      "B=amethyst_shard"
    ],
    "result": "budding_amethyst",
    "count": 4
  },
  "string": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "web"
    ],
    "result": "string",
    "count": 9
  },
  "powder_snow": {
    "kind": "recipe_shaped",
    "pattern": [
      "PSP",
      "SSS",
      "PSP"
    ],
    "materials": [
      "P=packed_ice",
      "S=snow"
    ],
    "result": "powder_snow",
    "count": 4
  },
  "structure_block": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "BCB",
      "ABA"
    ],
    "materials": [
      "A=crying_obsidian",
      "B=redstone",
      "C=command_block"
    ],
    "result": "structure_block",
    "count": 1
  },
  "structure_void": {
    "kind": "recipe_shaped",
    "pattern": [
      "ACA",
      "CBC",
      "ACA"
    ],
    "materials": [
      "A=redstone",
      "B=scaffolding",
      "C=barrier"
    ],
    "result": "structure_void",
    "count": 1
  },
  "monster_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=cobblestone",
      "B=egg"
    ],
    "result": "infested_cobblestone",
    "count": 1
  },
  "infested_deepslate": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=deepslate",
      "B=egg"
    ],
    "result": "infested_deepslate",
    "count": 1
  },
  "monster_egg-0": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=stone",
      "B=egg"
    ],
    "result": "infested_stone",
    "count": 1
  },
  "monster_egg-2": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=stone_bricks",
      "B=egg"
    ],
    "result": "infested_stone_bricks",
    "count": 1
  },
  "monster_egg-3": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=mossy_stone_bricks",
      "B=egg"
    ],
    "result": "infested_mossy_stone_bricks",
    "count": 1
  },
  "monster_egg-4": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=cracked_stone_bricks",
      "B=egg"
    ],
    "result": "infested_cracked_stone_bricks",
    "count": 1
  },
  "monster_egg-5": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=chiseled_stone_bricks",
      "B=egg"
    ],
    "result": "infested_chiseled_stone_bricks",
    "count": 1
  },
  "web": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "AAA",
      "AAA"
    ],
    "materials": [
      "A=string"
    ],
    "result": "web",
    "count": 1
  },
  "border_block": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "ABA",
      "ABA"
    ],
    "materials": [
      "A=bedrock",
      "B=red_dye"
    ],
    "result": "border_block",
    "count": 3
  },
  "ancient_debris": {
    "kind": "recipe_shaped",
    "pattern": [
      "ABA",
      "CDC",
      "ABA"
    ],
    "materials": [
      "A=obsidian",
      "B=copper_block",
      "C=iron_block",
      "D=nether_star"
    ],
    "result": "ancient_debris",
    "count": 4
  },
  "iron_golem_spawn_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      " A ",
      "BBB",
      " B "
    ],
    "materials": [
      "A=pumpkin",
      "B=iron_block"
    ],
    "result": "iron_golem_spawn_egg",
    "count": 1
  },
  "chainmail_helmet": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A"
    ],
    "materials": [
      "A=chain"
    ],
    "result": "chainmail_helmet",
    "count": 1
  },
  "chainmail_leggings": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "A A",
      "A A"
    ],
    "materials": [
      "A=chain"
    ],
    "result": "chainmail_leggings",
    "count": 1
  },
  "chainmail_chestplate": {
    "kind": "recipe_shaped",
    "pattern": [
      "A A",
      "AAA",
      "AAA"
    ],
    "materials": [
      "A=chain"
    ],
    "result": "chainmail_chestplate",
    "count": 1
  },
  "chainmail_boots": {
    "kind": "recipe_shaped",
    "pattern": [
      "A A",
      "A A"
    ],
    "materials": [
      "A=chain"
    ],
    "result": "chainmail_boots",
    "count": 1
  },
  "enchanted_golden_Apple": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "ABA",
      "AAA"
    ],
    "materials": [
      "A=gold_block",
      "B=apple"
    ],
    "result": "enchanted_golden_apple",
    "count": 1
  },
  "invisible_bedrock": {
    "kind": "recipe_shaped",
    "pattern": [
      "AB"
    ],
    "materials": [
      "A=bedrock",
      "B=potion#7"
    ],
    "result": "invisible_bedrock",
    "count": 1
  },
  "snow_golem_spawn_egg": {
    "kind": "recipe_shaped",
    "pattern": [
      "A",
      "B",
      "B"
    ],
    "materials": [
      "A=pumpkin",
      "B=snow"
    ],
    "result": "snow_golem_spawn_egg",
    "count": 1
  },
  "lava": {
    "kind": "recipe_shaped",
    "pattern": [
      "AAA",
      "AAA",
      "AAA"
    ],
    "materials": [
      "A=magma"
    ],
    "result": "lava",
    "count": 1
  },
  "water": {
    "kind": "recipe_shapeless",
    "pattern": null,
    "materials": [
      "packed_ice"
    ],
    "result": "water",
    "count": 1
  },
  "elytra": {
    "kind": "recipe_shaped",
    "pattern": [
      "DBD",
      "ACA",
      "A A"
    ],
    "materials": [
      "A=feather",
      "B=string",
      "C=nether_star",
      "D=phantom_membrane"
    ],
    "result": "elytra",
    "count": 1
  }
};
