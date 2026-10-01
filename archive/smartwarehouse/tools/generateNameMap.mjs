/**
 * ItemNameMap 生成脚本
 *
 * 从 @minecraft/vanilla-data 获取所有合法物品 ID，
 * 从 zh_CN.json 匹配中文名，输出静态 TypeScript 映射文件。
 *
 * 用法: node tools/generateNameMap.mjs
 */

import { MinecraftItemTypes } from "@minecraft/vanilla-data";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const zhCN = JSON.parse(fs.readFileSync(path.join(root, "scripts/data/zh_CN.json"), "utf-8"));

// ── 常量 ──────────────────────────────────────────────────

const COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime",
  "pink", "gray", "light_gray", "cyan", "purple", "blue",
  "brown", "green", "red", "black",
];

const WOODS = [
  "oak", "spruce", "birch", "jungle", "acacia", "dark_oak",
  "mangrove", "cherry", "bamboo", "crimson", "warped", "pale_oak",
];

const SILVER_ALIAS = { silver: "light_gray" };

/** 颜色在 zh_CN coral 键中的映射 */
const CORAL_COLOR_MAP = {
  blue: "tube", pink: "brain", purple: "bubble", red: "fire", yellow: "horn",
};

// ── 解析引擎 ──────────────────────────────────────────────

const allIds = Object.values(MinecraftItemTypes);
const result = {};

for (const id of allIds) {
  const name = resolveName(id, zhCN);
  if (name) result[id] = name;
}

// ── 用英文补全缺失 ──────────────────────────────────────

const englishFallback = [];
for (const id of allIds) {
  if (!result[id]) {
    const eng = id.slice("minecraft:".length).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    result[id] = eng;
    englishFallback.push(id);
  }
}

console.log(`\n✓ 总条目: ${Object.keys(result).length}`);
console.log(`✓ zh_CN 中文名: ${Object.keys(result).length - englishFallback.length}/${allIds.length}`);
console.log(`✓ 英文回退: ${englishFallback.length}/${allIds.length}`);

// ── 输出分类文件 ──────────────────────────────────────────

const outDir = path.join(root, "scripts/data/name-maps");
fs.mkdirSync(outDir, { recursive: true });

// 分类
const classified = classifyItems(result);

for (const [category, items] of Object.entries(classified)) {
  writeCategoryFile(outDir, category, items);
}

// 汇总索引
writeIndexFile(outDir, classified);

console.log("\n✓ 文件已生成到 scripts/data/name-maps/");

// ── 分类逻辑 ──────────────────────────────────────────────

function classifyItems(map) {
  const cats = {
    direct: {},
    spawnEggs: {},
    musicDiscs: {},
    colorVariants: {},
    woodVariants: {},
    compoundBlocks: {},
    legacy: {},
    fallback: {},
  };

  for (const [id, name] of Object.entries(map)) {
    const s = id.slice("minecraft:".length);
    const isEnglish = !isChinese(name);

    if (isEnglish) {
      cats.fallback[id] = name;
      continue;
    }

    // 分类优先级
    if (s.endsWith("_spawn_egg")) {
      cats.spawnEggs[id] = name;
    } else if (s.includes("music_disc_")) {
      cats.musicDiscs[id] = name;
    } else if (isColorVariant(s)) {
      cats.colorVariants[id] = name;
    } else if (isWoodVariant(s)) {
      cats.woodVariants[id] = name;
    } else if (isCompoundBlock(s)) {
      cats.compoundBlocks[id] = name;
    } else if (s.includes("_spawn_egg") || s.includes("_boat") || s.includes("_sign") ||
               s.includes("_door") || s.includes("_trapdoor") || s.includes("coral")) {
      cats.legacy[id] = name;
    } else {
      cats.direct[id] = name;
    }
  }

  return cats;
}

function isChinese(str) {
  return /[\u4e00-\u9fff]/.test(str);
}

function isColorVariant(s) {
  const colorItems = ["_wool", "_carpet", "_concrete", "_concrete_powder",
    "_terracotta", "_stained_glass", "_stained_glass_pane",
    "_glazed_terracotta", "_dye", "_bed", "_banner", "_shulker_box"];
  return colorItems.some((c) => s.includes(c)) &&
    COLORS.some((c) => s.startsWith(c + "_") || s.includes("_" + c));
}

function isWoodVariant(s) {
  const woodItems = ["_planks", "_log", "_wood", "_sapling", "_leaves",
    "_boat", "_chest_boat", "_raft", "_chest_raft",
    "_sign", "_hanging_sign", "_door", "_trapdoor",
    "_fence", "_fence_gate", "_pressure_plate", "_button",
    "_slab", "_stairs"];
  return woodItems.some((c) => s.endsWith(c)) &&
    WOODS.some((w) => s.startsWith(w + "_") || s.includes("_" + w));
}

function isCompoundBlock(s) {
  const compoundEndings = ["_slab", "_stairs", "_wall", "_stone_bricks",
    "_bricks", "cobblestone", "_sandstone", "_quartz_block",
    "_quartz_pillar", "_pillar"];
  return compoundEndings.some((e) => s.endsWith(e));
}

// ── 名称解析（核心） ─────────────────────────────────────

function resolveName(id, data) {
  const suffix = id.slice("minecraft:".length);

  // 1. 直通键
  let found = data["item." + suffix + ".name"] || data["tile." + suffix + ".name"];
  if (found) return found;

  // 2. spawn_egg
  const se = suffix.match(/^(.+)_spawn_egg$/);
  if (se) {
    found = data["item.spawn_egg.entity." + se[1] + ".name"];
    if (found) return found;
    // 特殊 entity 名修正
    const entityFix = {
      "tropical_fish": "tropicalfish",
      "villager": "villager_v2",
      "zombie_villager": "zombie_villager_v2",
      "evoker": "evocation_illager",
      "wandering_trader": "wandering_trader",
    };
    const fixed = entityFix[se[1]];
    if (fixed) {
      found = data["item.spawn_egg.entity." + fixed + ".name"];
      if (found) return found;
    }
  }

  // 3. music_disc
  const md = suffix.match(/^music_disc_(.+)$/);
  if (md) {
    found = data["item.record_" + md[1] + ".desc"];
    if (found) return found;
  }

  // 4. 颜色展开式: color_item → tile.<item>.<color>.name
  for (const color of COLORS) {
    const c = SILVER_ALIAS[color] || color;
    // color_stained_glass, color_wool, color_concrete, etc.
    const prefix = color + "_";
    const rest = suffix.startsWith(prefix) ? suffix.slice(prefix.length) : null;
    if (rest) {
      // 反向推导 zh_CN 键
      const legacyKeys = getColorZhCNKeys(color, rest);
      for (const k of legacyKeys) {
        if (data[k]) return data[k];
      }
    }
  }

  // 5. 颜色中置式: item_shulker_box → tile.shulker_box.color.name
  for (const color of COLORS) {
    const c = SILVER_ALIAS[color] || color;
    const midPattern = "_" + color + "_";
    const idx = suffix.indexOf(midPattern);
    if (idx > 0) {
      const prefix = suffix.slice(0, idx);
      const postfix = suffix.slice(idx + midPattern.length - 1); // keep trailing _
      // Try tile.<prefix>.<color>.name and tile.<prefix>colored.<color>.name
      const tries = [
        `tile.${prefix}.${color}.name`,
        `tile.${prefix}.colored.${color}.name`,
        `tile.${prefix}Colored.${color}.name`,
      ];
      for (const t of tries) {
        if (data[t]) return data[t];
      }
    }
  }

  // 6. 木类展开式
  for (const wood of WOODS) {
    const prefix = wood + "_";
    if (suffix.startsWith(prefix) || suffix === wood) {
      const rest = suffix.startsWith(prefix) ? suffix.slice(prefix.length) : "";
      if (!rest) continue;
      const legacyKeys = getWoodZhCNKeys(wood, rest, suffix);
      for (const k of legacyKeys) {
        if (data[k]) return data[k];
      }
    }
  }

  // 7. wood 类特殊: bamboo_xxx ≠ bamboo_前缀在 zh_CN
  if (suffix.startsWith("bamboo_")) {
    const rest = suffix.slice("bamboo_".length);
    if (rest === "boat") {
      found = data["item.bamboo_raft.name"];
      if (found) return found;
    }
    if (rest === "chest_boat") {
      found = data["item.bamboo_chest_raft.name"];
      if (found) return found;
    }
    // bamboo_planks, bamboo_sign, etc.
    found = data["tile.bamboo_" + rest + ".name"];
    if (found) return found;
    found = data["item.bamboo_" + rest + ".name"];
    if (found) return found;
  }

  // 8. 颜色后置式: tile.wool.colored.red.name (已在上层覆盖)

  // 9. legacy compound: tile.stone.andesite → minecraft:andesite
  const stoneLegacy = { andesite: "andesite", granite: "granite", diorite: "diorite", stone: "stone" };
  if (stoneLegacy[suffix]) {
    found = data["tile.stone." + suffix + ".name"] || data["tile.stone." + suffix + ".default.name"];
    if (found) return found;
  }

  // 10. tile.sand.red → red_sand
  if (suffix === "red_sand" && data["tile.sand.red.name"]) return data["tile.sand.red.name"];

  // 11. tile.grass → grass_block
  if (suffix === "grass_block" && data["tile.grass.name"]) return data["tile.grass.name"];

  // 12. tile.stonecutter → stonecutter_block
  if (suffix === "stonecutter_block" && data["tile.stonecutter.name"]) return data["tile.stonecutter.name"];

  // 13. tile.dirt.coarse → coarse_dirt
  if (suffix === "coarse_dirt" && data["tile.dirt.coarse.name"]) return data["tile.dirt.coarse.name"];

  // 14. tile.dirt.podzol → podzol
  if (suffix === "podzol" && data["tile.dirt.podzol.name"]) return data["tile.dirt.podzol.name"];

  // 15. tile.waterlily → lily_pad
  if (suffix === "lily_pad" && data["tile.waterlily.name"]) return data["tile.waterlily.name"];

  // 16. tile.fence → oak_fence (默认橡木)
  if (suffix === "oak_fence" && data["tile.fence.name"]) return data["tile.fence.name"];
  if (suffix === "oak_fence_gate" && data["tile.fence_gate.name"]) return data["tile.fence_gate.name"];

  // 17. tile.hardened_clay → terracotta
  if (suffix === "terracotta" && data["tile.hardened_clay.name"]) return data["tile.hardened_clay.name"];

  // 18. skulls
  const skullMap = {
    "skeleton_skull": "skeleton", "wither_skeleton_skull": "wither",
    "zombie_head": "zombie", "player_head": "char", "creeper_head": "creeper",
    "dragon_head": "dragon", "piglin_head": "piglin",
  };
  if (skullMap[suffix]) {
    found = data["item.skull." + skullMap[suffix] + ".name"];
    if (found) return found;
  }

  // 19. legacy item names
  const legacyItems = {
    "enchanted_golden_apple": "item.appleEnchanted.name",
    "cooked_beef": "item.steak.name",
    "cooked_cod": "item.cooked_fish.name",
    "melon_slice": "item.melon.name",
    "nether_wart": "item.netherwart.name",
    "firework_rocket": "item.fireworks.flight", // 有 flight 字段即可
    "firework_star": "item.fireworksCharge.customColor",
    "tipped_arrow": null, // 特殊处理
  };
  if (legacyItems[suffix] && data[legacyItems[suffix]]) {
    if (suffix === "firework_rocket") return "烟花";
    if (suffix === "firework_star") return "烟火之星";
    return data[legacyItems[suffix]];
  }

  // 19b. tipped_arrow
  if (suffix === "tipped_arrow") {
    for (const k of Object.keys(data)) {
      if (k.startsWith("tipped_arrow.effect.")) return data[k];
    }
  }

  // 20. shield
  if (suffix === "shield") {
    found = data["item.shield.name"];
    if (found) return found;
    for (const color of COLORS) {
      found = data["item.shield." + color + ".name"];
      if (found) return found;
    }
  }

  // 21. entity → item
  const entityMap = {
    "tropical_fish": "entity.tropicalfish.name",
    "lingering_potion": "entity.lingering_potion.name",
    "splash_potion": "entity.splash_potion.name",
    "potion": "entity.potion.name",
    "cod": "entity.cod.name",
  };
  if (entityMap[suffix] && data[entityMap[suffix]]) return data[entityMap[suffix]];

  // 22. red_flower / yellow_flower
  const flowerMap = {
    "poppy": "poppy", "blue_orchid": "orchid", "allium": "allium",
    "azure_bluet": "houstonia", "red_tulip": "tulipRed", "orange_tulip": "tulipOrange",
    "white_tulip": "tulipWhite", "pink_tulip": "tulipPink", "oxeye_daisy": "oxeye",
    "cornflower": "cornflower", "lily_of_the_valley": "lilyOfTheValley",
  };
  if (flowerMap[suffix]) {
    found = data["tile.red_flower." + flowerMap[suffix] + ".name"];
    if (found) return found;
  }
  if (suffix === "dandelion" && data["tile.yellow_flower.name"]) return data["tile.yellow_flower.name"];

  // 23. sandstone variants
  const sandstoneMap = {
    "sandstone": "default", "chiseled_sandstone": "chiseled",
    "smooth_sandstone": "smooth", "cut_sandstone": "cut",
  };
  if (sandstoneMap[suffix]) {
    found = data["tile.sandstone." + sandstoneMap[suffix] + ".name"];
    if (found) return found;
  }

  // 24. red sandstone variants
  const redSandstoneMap = {
    "red_sandstone": "default", "chiseled_red_sandstone": "chiseled",
    "smooth_red_sandstone": "smooth", "cut_red_sandstone": "cut",
  };
  if (redSandstoneMap[suffix]) {
    found = data["tile.red_sandstone." + redSandstoneMap[suffix] + ".name"];
    if (found) return found;
  }

  // 25. quartz block variants
  const quartzMap = {
    "quartz_block": "default", "chiseled_quartz_block": "chiseled",
    "quartz_pillar": "pillar", "smooth_quartz": "smooth",
  };
  if (quartzMap[suffix]) {
    found = data["tile.quartzBlock." + quartzMap[suffix] + ".name"];
    if (found) return found;
  }

  // 26. stone bricks
  const brickMap = {
    "stone_bricks": "default", "mossy_stone_bricks": "mossy",
    "cracked_stone_bricks": "cracked", "chiseled_stone_bricks": "chiseled",
  };
  if (brickMap[suffix]) {
    found = data["tile.stonebrick." + brickMap[suffix] + ".name"];
    if (found) return found;
  }

  // 27. double_plant flowers
  const doublePlantMap = {
    "sunflower": "sunflower", "lilac": "syringa",
    "tall_grass": "grass", "large_fern": "fern",
    "rose_bush": "rose", "peony": "paeonia",
  };
  if (doublePlantMap[suffix]) {
    found = data["tile.double_plant." + doublePlantMap[suffix] + ".name"];
    if (found) return found;
  }

  // 28. tallgrass
  const tallGrassMap = { "short_grass": "default", "fern": "fern" };
  if (tallGrassMap[suffix]) {
    found = data["tile.tallgrass." + tallGrassMap[suffix] + ".name"];
    if (found) return found;
  }

  // 29. anvil
  if (suffix === "anvil" || suffix === "chipped_anvil" || suffix === "damaged_anvil") {
    const anvilStates = ["intact", "slightlyDamaged", "veryDamaged"];
    for (const st of anvilStates) {
      found = data["tile.anvil." + st + ".name"];
      if (found) return found;
    }
  }

  // 30. coral: minecraft:tube_coral → tile.coral.blue.name
  for (const [color, coralType] of Object.entries(CORAL_COLOR_MAP)) {
    const prefix = coralType + "_coral";
    if (suffix === prefix || suffix.startsWith(prefix)) {
      // tube_coral, tube_coral_fan, tube_coral_block
      found = data["tile.coral." + color + ".name"];
      if (found) {
        const rest = suffix.slice(prefix.length);
        if (rest === "_fan") {
          found = data["tile.coral_fan." + color + ".name"] || found;
        } else if (rest === "_block") {
          found = data["tile.coral_block." + color + ".name"] || found;
        }
        return found;
      }
    }
  }

  // 31. dying coral
  for (const [color, coralType] of Object.entries(CORAL_COLOR_MAP)) {
    const dPrefix = "dead_" + coralType + "_coral";
    if (suffix.startsWith(dPrefix)) {
      found = data["tile.coral." + color + ".name"];
      if (found) return "失活的" + found;
    }
  }

  // 32. short_grass
  if (suffix === "short_grass" && data["tile.tallgrass.default.name"]) return data["tile.tallgrass.default.name"];

  // 33. black bundle / blue bundle etc.
  if (suffix.endsWith("_bundle") && !suffix.endsWith("bundle")) {
    // color_bundle — if the main bundle exists, try to find in zh_CN
    found = data["item.bundle.name"] || data["item." + suffix + ".name"];
    if (found) return found;
  }

  // 34. Not found
  return undefined;
}

// ── 颜色 zh_CN 键生成 ────────────────────────────────────

function getColorZhCNKeys(color, itemType) {
  const c = SILVER_ALIAS[color] || color;
  const keys = [];

  // 潜影盒
  if (itemType.endsWith("shulker_box")) {
    const base = itemType.slice(0, -"shulker_box".length).replace(/_$/, "");
    if (base === "undyed" || !base) {
      keys.push("tile.shulker_box.name");
      keys.push("tile.undyed_shulker_box.name");
    } else {
      // PascalCase: tile.shulkerBoxWhite.name
      const pascal = "shulkerBox" + color.charAt(0).toUpperCase() + color.slice(1);
      keys.push("tile." + pascal + ".name");
      keys.push("item." + pascal + ".name");
    }
  }

  // 羊毛
  if (itemType === "wool") {
    keys.push("tile.wool.colored." + color + ".name");
    keys.push("tile.wool." + color + ".name");
  }

  // 地毯
  if (itemType === "carpet") {
    keys.push("tile.carpet.colored." + color + ".name");
    keys.push("tile.carpet." + color + ".name");
  }

  // 混凝土
  if (itemType === "concrete") {
    keys.push("tile.concrete." + color + ".name");
  }

  // 混凝土粉末
  if (itemType === "concrete_powder") {
    keys.push("tile.concrete.powdered." + color + ".name");
    keys.push("tile.concretePowder." + color + ".name");
  }

  // 陶瓦
  if (itemType === "terracotta") {
    keys.push("tile.stained_hardened_clay." + color + ".name");
  }

  // 带釉陶瓦
  if (itemType === "glazed_terracotta") {
    keys.push("tile.glazedTerracotta." + color + ".name");
  }

  // 染色玻璃
  if (itemType === "stained_glass") {
    keys.push("tile.stained_glass." + color + ".name");
  }

  // 染色玻璃板
  if (itemType === "stained_glass_pane") {
    keys.push("tile.stained_glass_pane." + color + ".name");
  }

  // 床
  if (itemType === "bed") {
    keys.push("item.bed." + color + ".name");
  }

  // 旗帜
  if (itemType === "banner") {
    keys.push("item.banner." + color + ".name");
  }

  // 染料
  if (itemType === "dye") {
    keys.push("item.dye.powder." + color + ".name");
    keys.push("item.dyePowder." + color + ".name");
    keys.push("item.dye." + color + ".name");
    keys.push("item.dye." + color + "_new.name");
  }

  return keys;
}

// ── 木类 zh_CN 键生成 ────────────────────────────────────

function getWoodZhCNKeys(wood, rest, fullSuffix) {
  const keys = [];
  const woodAlias = wood === "dark_oak" ? "big_oak" : wood;

  // 木板
  if (rest === "planks") {
    keys.push("tile.planks." + woodAlias + ".name");
    keys.push("tile.wood.planks." + woodAlias + ".name");
    keys.push("tile." + fullSuffix + ".name"); // direct
  }

  // 原木
  if (rest === "log") {
    keys.push("tile.log." + woodAlias + ".name");
  }

  // 木头
  if (rest === "wood") {
    keys.push("tile.wood." + woodAlias + ".name");
  }

  // 树苗
  if (rest === "sapling") {
    keys.push("tile.sapling." + woodAlias + ".name");
  }

  // 树叶
  if (rest === "leaves") {
    keys.push("tile.leaves." + woodAlias + ".name");
  }

  // 栅栏
  if (rest === "fence") {
    keys.push("tile.fence." + woodAlias + ".name");
    keys.push("tile.fence_" + wood + ".name");
  }

  // 栅栏门
  if (rest === "fence_gate") {
    keys.push("tile.fence_gate." + woodAlias + ".name");
    keys.push("tile.fence_gate_" + wood + ".name");
  }

  // 门
  if (rest === "door") {
    keys.push("tile.door." + woodAlias + ".name");
    keys.push("tile.door_" + wood + ".name");
  }

  // 活版门
  if (rest === "trapdoor") {
    keys.push("tile.trapdoor." + woodAlias + ".name");
    keys.push("tile.trapdoor_" + wood + ".name");
  }

  // 压力板
  if (rest === "pressure_plate") {
    keys.push("tile.pressure_plate." + woodAlias + ".name");
  }

  // 按钮
  if (rest === "button") {
    keys.push("tile.button." + woodAlias + ".name");
  }

  // 台阶（木头台阶在旧版用 wood_slab）
  if (rest === "slab") {
    keys.push("tile.wood_slab." + woodAlias + ".name");
    keys.push("tile.stone_slab." + wood + ".name"); // stone_slab.wood = oak_slab
  }

  // 楼梯
  if (rest === "stairs") {
    keys.push("tile.stairsWood." + woodAlias + ".name");
    keys.push("tile.stairs_" + woodAlias + ".name");
  }

  // 船
  if (rest === "boat") {
    keys.push("item.boat." + woodAlias + ".name");
  }

  // 运输船
  if (rest === "chest_boat") {
    keys.push("item.chest_boat." + woodAlias + ".name");
  }

  // 木筏（竹子）
  if (rest === "raft") {
    keys.push("item.bamboo_raft.name");
  }
  if (rest === "chest_raft") {
    keys.push("item.bamboo_chest_raft.name");
  }

  // 告示牌
  if (rest === "sign") {
    keys.push("item.sign." + woodAlias + ".name");
    keys.push("tile.sign." + woodAlias + ".name");
  }

  // 悬挂式告示牌
  if (rest === "hanging_sign") {
    keys.push("item.hanging_sign." + woodAlias + ".name");
  }

  // stripped_xxx_log / stripped_xxx_wood
  if (fullSuffix.startsWith("stripped_")) {
    const inner = fullSuffix.slice("stripped_".length);
    if (inner.endsWith("_log")) {
      keys.push("tile.wood.stripped." + woodAlias + ".name");
    }
    if (inner.endsWith("_wood")) {
      // stripped_xxx_wood 可能和 stripped_xxx_log 共用翻译
      keys.push("tile.wood.stripped." + woodAlias + ".name");
    }
  }

  return keys;
}

// ── 输出文件 ──────────────────────────────────────────────

function writeCategoryFile(dir, category, items) {
  const entries = Object.entries(items);
  if (entries.length === 0) {
    fs.writeFileSync(path.join(dir, category + ".ts"), `// ${category} — 无条目\n`);
    return;
  }

  const lines = [
    "// 自动生成，请勿手动修改",
    "// 生成命令: node tools/generateNameMap.mjs",
    "",
  ];

  if (category === "fallback") {
    lines.push("// -- 英文回退（zh_CN 中无对应中文名的条目） --");
  } else if (category === "spawnEggs") {
    lines.push("// -- 刷怪蛋 --");
  } else if (category === "musicDiscs") {
    lines.push("// -- 音乐唱片 --");
  } else if (category === "colorVariants") {
    lines.push("// -- 颜色变体（羊毛、地毯、混凝土、陶瓦等） --");
  } else if (category === "woodVariants") {
    lines.push("// -- 木类变体（木板、原木、栅栏、门等） --");
  } else if (category === "compoundBlocks") {
    lines.push("// -- 复合方块（台阶、楼梯、墙、石砖等） --");
  } else if (category === "legacy") {
    lines.push("// -- 遗留特殊映射 --");
  } else {
    lines.push("// -- 直通条目 --");
  }
  lines.push("");

  lines.push("import type { ItemNameMap } from \"./types\";");
  lines.push("");

  // 为了让文件较小，每行一个条目
  lines.push(`const ${category}: ItemNameMap = {`);
  for (const [id, name] of entries) {
    lines.push(`  "${id}": ${JSON.stringify(name)},`);
  }
  lines.push("};");
  lines.push("");
  lines.push(`export default ${category};`);
  lines.push(`export { ${category} };`);

  fs.writeFileSync(path.join(dir, category + ".ts"), lines.join("\n"));
}

function writeIndexFile(dir, classified) {
  const lines = [
    "// 自动生成，请勿手动修改",
    "// 生成命令: node tools/generateNameMap.mjs",
    "",
    "import type { ItemNameMap } from \"./types\";",
    "",
  ];

  const imports = [];
  const merges = [];

  for (const [cat, items] of Object.entries(classified)) {
    if (Object.keys(items).length === 0) continue;
    imports.push(`import ${cat} from "./${cat}";`);
    merges.push(`  ...${cat},`);
  }

  lines.push(...imports);
  lines.push("");
  lines.push("const full: ItemNameMap = {");
  lines.push(...merges);
  lines.push("};");
  lines.push("");
  lines.push("export default full;");

  fs.writeFileSync(path.join(dir, "index.ts"), lines.join("\n"));

  // 输出统计
  const categories = Object.entries(classified)
    .filter(([, items]) => Object.keys(items).length > 0)
    .map(([cat, items]) => `  ${cat}: ${Object.keys(items).length}`)
    .join("\n");
  console.log(`\n分类统计:\n${categories}`);
}
