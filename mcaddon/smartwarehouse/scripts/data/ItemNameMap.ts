/**
 * ============================================================================
 * ItemNameMap —— Minecraft 物品 ID 与中文名的双向映射
 * ============================================================================
 *
 * 职责：
 * 1. 从 zh_CN.json 原始翻译数据中提取 item/tile 关键词条，构建 typeId→中文名映射
 * 2. 提供中文名→typeId 的反向模糊搜索索引
 * 3. 支持字符串级联模糊匹配
 *
 * 数据来源：从 Bedrock 官方资源包提取的 zh_CN.json，位于同目录下。
 * 当 Minecraft 版本更新时，只需替换 zh_CN.json 后重新编译即可。
 *
 * ## zh_CN.json 的键名规律
 *
 * Minecraft Bedrock 的中文翻译使用了一套历史遗留的命名体系，与现代物品 ID
 * （MinecraftItemTypes）之间存在多种映射关系。以下是已知的键模式：
 *
 * ### 1. 直通式
 *   item.<id>.name        → minecraft:<id>            如 item.apple.name
 *   tile.<id>.name        → minecraft:<id>            如 tile.stone_button.name
 *   item.<id> (无后缀)     → minecraft:<id>            如 item.bundle
 *
 * ### 2. PascalCase 式（旧版命名，需 snake_case）
 *   item.carrotOnAStick.name  → minecraft:carrot_on_a_stick
 *   tile.acaciaFence.name     → minecraft:acacia_fence       (旧版 fence)
 *   tile.shulkerBoxWhite.name → minecraft:white_shulker_box
 *
 * ### 3. 点分组合式（tile.<大类>.<变体>.name）
 *   tile.stone.andesite.name             → minecraft:andesite
 *   tile.sandstone.chiseled.name         → minecraft:chiseled_sandstone
 *   tile.sand.default.name               → minecraft:sand
 *   tile.wool.black.name                 → minecraft:black_wool    (颜色词在第二段)
 *   tile.concrete.red.name               → minecraft:red_concrete
 *   tile.stained_hardened_clay.black.name → minecraft:black_terracotta
 *   tile.glazedTerracotta.white.name      → minecraft:white_glazed_terracotta
 *   tile.leaves.acacia.name              → minecraft:acacia_leaves
 *
 * ### 4. 墙/台阶特殊式
 *   tile.cobblestone_wall.<type>.name → minecraft:<type>_wall
 *   tile.stone_slab<N>.<type>.name    → minecraft:<type>_slab
 *   tile.stonebrick.<variant>.name    → minecraft:<variant>_stone_bricks
 *
 * ### 5. 颜色展开式
 *   item.bed.<color>.name         → minecraft:<color>_bed
 *   item.banner.<color>.name      → minecraft:<color>_banner
 *   item.dye.<color>[_new].name   → minecraft:<color>_dye (部分有别名)
 *   item.shield.<color>.name      → minecraft:shield (统一)
 *   item.boat.<wood>.name         → minecraft:<wood>_boat
 *   item.chest_boat.<wood>.name   → minecraft:<wood>_chest_boat
 *
 * ### 6. 特殊物品
 *   item.spawn_egg.entity.<mob>.name    → minecraft:<mob>_spawn_egg
 *   item.bucket<Type>.name              → minecraft:<type>_bucket   (PascalCase)
 *   item.skull.<type>.name              → minecraft:<type>_skull/head
 *   item.appleEnchanted.name            → minecraft:enchanted_golden_apple
 *   item.steak.name                     → minecraft:cooked_beef
 *   item.record_<id>.desc               → minecraft:music_disc_<id>
 *   tipped_arrow.effect.*               → minecraft:tipped_arrow
 *
 * ### 7. 实体名转物品
 *   entity.tropicalfish.name   → minecraft:tropical_fish
 *   entity.splash_potion.name  → minecraft:splash_potion
 *
 * ### 8. 未覆盖项
 *   对于 zh_CN.json 中找不到对应条目的 MinecraftItemTypes，
 *   回退到 typeId 的英文可读名（minecraft:diamond → diamond）。
 * ============================================================================
 */

import zhCN from "./zh_CN.json";

// ─── 常量（颜色名映射表）─────────────────────────────────────────

/** 16 种 Minecraft 标准颜色的英文名，用于展开颜色类物品 */
const COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime",
  "pink", "gray", "light_gray", "cyan", "purple", "blue",
  "brown", "green", "red", "black",
] as const;

// ─── 公开常量 ───────────────────────────────────────────────────

/**
 * 物品 ID → 中文名的完全映射表。
 * 在模块首次加载时从 zh_CN.json 解析构建。
 */
export const ITEM_NAME_MAP: Record<string, string> = /* @__PURE__ */ buildItemNameMap(zhCN);

/**
 * 中文名（小写）→ typeId 列表的反向搜索索引。
 * 在模块首次加载时从 ITEM_NAME_MAP 构建。
 */
export const NAME_INDEX: Map<string, string[]> = /* @__PURE__ */ buildNameIndex(ITEM_NAME_MAP);

// ─── 公开查询函数 ───────────────────────────────────────────────

/**
 * 根据 typeId 查找物品的中文名。
 *
 * @param typeId - 物品类型 ID（如 "minecraft:diamond"）
 * @returns 中文名，如果未找到则返回 typeId 本身
 */
export function getChineseName(typeId: string): string {
  return ITEM_NAME_MAP[typeId] ?? typeId.replace("minecraft:", "");
}

/**
 * 搜索匹配指定查询字符串的物品。
 * 支持：
 * - 按 typeId 精确匹配（minecraft:xxx）
 * - 按 typeId 部分匹配
 * - 按中文名模糊匹配
 *
 * @param query - 搜索查询
 * @returns 匹配的 typeId 数组（无重复，按字母排序）
 */
export function searchItems(query: string): string[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const results = new Set<string>();

  // 1. typeId 精确/前缀匹配
  if (q.startsWith("minecraft:")) {
    if (ITEM_NAME_MAP[q]) results.add(q);
    for (const typeId of Object.keys(ITEM_NAME_MAP)) {
      if (typeId.startsWith(q)) results.add(typeId);
    }
    return [...results].sort();
  }

  // 2. typeId 部分匹配
  for (const typeId of Object.keys(ITEM_NAME_MAP)) {
    if (typeId.includes(q)) results.add(typeId);
  }

  // 3. 中文名模糊匹配
  for (const [name, typeIds] of NAME_INDEX) {
    if (name.includes(q)) {
      for (const id of typeIds) results.add(id);
    }
  }

  return [...results].sort();
}

// ─── 构建函数 ───────────────────────────────────────────────────

/**
 * 从 Bedrock 翻译 JSON 中提取物品/方块的中文名，构建映射表。
 *
 * 分多层级处理：
 * 1. 直通 key（item.<id>.name, tile.<id>.name, bare items）
 * 2. PascalCase → snake_case 转换
 * 3. 点分组合式 legacy 键
 * 4. 颜色展开类键（color variants）
 * 5. 特殊家具类键（bed, banner, boat, chest_boat, shield）
 * 6. 特殊物品类键（spawn egg, bucket, skull, 别名）
 * 7. 音乐唱片
 * 8. 实体名转物品
 *
 * @param data - 原始翻译数据
 * @returns typeId → 中文名的映射
 */
function buildItemNameMap(data: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};

  // ─── 第 1 层：直通键 ──────────────────────────────────────────

  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string" || val.length === 0) continue;
    resolveSimpleKey(key, val, map);
  }

  // ─── 第 2 层：PascalCase 剥离前缀式 ──────────────────────────

  // tile.sand.default → minecraft:sand (取 default 变体为基名)
  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== "string") continue;

    // tile.<base>.<variant>.name where variant=default → minecraft:<base>
    const mDef = key.match(/^tile\.(.+)\.(default)\.name$/);
    if (mDef) {
      const typeId = "minecraft:" + mDef[1];
      if (!map[typeId]) map[typeId] = val;
    }
  }

  // ─── 第 3 层：点分组合式 legacy 键 ───────────────────────────

  applyLegacyCompoundRules(data, map);

  // ─── 第 4 层：颜色展开式（16 色） ────────────────────────────

  applyColorVariantRules(data, map);

  // ─── 第 5 层：木类展开式（木船、运输船） ────────────────────

  applyWoodVariantRules(data, map);

  // ─── 第 6 层：特殊规则（bucket、skull、dye、盾牌等） ─────────

  applySpecialItemRules(data, map);

  // ─── 第 7 层：入口名称（从 entity.*.name） ───────────────────

  applyEntityNameRules(data, map);

  // ─── 第 8 层：末覆盖条目的英文回退 ──────────────────────────

  // 注意：回退不在本函数处理，在 getChineseName() 的 ?? 中兜底

  return map;
}

/**
 * 解析直通式键：item/tile.<id>.name、item.<id>、tile.<id>。
 * 同时检测 PascalCase 并生成 snake_case 备选。
 */
function resolveSimpleKey(key: string, val: string, map: Record<string, string>): void {
  // item.<id>.name / tile.<id>.name
  const m1 = key.match(/^(?:item|tile)\.(.+)\.name$/);
  if (m1) {
    const rawId = m1[1];

    // 如果 rawId 不含点，直接映射
    if (!rawId.includes(".")) {
      const typeId = "minecraft:" + rawId;
      if (!map[typeId]) map[typeId] = val;

      // PascalCase 检测 → snake_case
      if (/[A-Z]/.test(rawId)) {
        const snake = "minecraft:" + rawId
          .replace(/([A-Z])/g, "_$1")
          .toLowerCase()
          .replace(/^minecraft:_/, "minecraft:");
        if (snake !== typeId && !map[snake]) {
          map[snake] = val;
        }
      }
      return;
    }
    return; // 带点的在复合规则中处理
  }

  // item.<id>（无后缀，纯小写下划线式 ID）
  const m2 = key.match(/^item\.([a-z0-9_]+)$/);
  if (m2) {
    const typeId = "minecraft:" + m2[1];
    if (!map[typeId]) map[typeId] = val;
    return;
  }

  // tile.<id>（无后缀）
  const m3 = key.match(/^tile\.([a-z0-9_]+)$/);
  if (m3) {
    const typeId = "minecraft:" + m3[1];
    if (!map[typeId]) map[typeId] = val;
    return;
  }

  // tipped_arrow
  if (key.startsWith("tipped_arrow.effect.") && !map["minecraft:tipped_arrow"]) {
    map["minecraft:tipped_arrow"] = val;
    return;
  }

  // spawn_egg
  const m4 = key.match(/^item\.spawn_egg\.entity\.(.+)\.name$/);
  if (m4) {
    const typeId = "minecraft:" + m4[1] + "_spawn_egg";
    if (!map[typeId]) map[typeId] = val;
    return;
  }
}

/**
 * 应用遗留的复合键规则（tile.<大类>.<变体>.name）。
 *
 * 规则优先级（越靠上优先级越高）：
 * 1. 特殊的 legacy 映射（stone.<variant>, sandstone.*, etc.）
 * 2. 点分组合颜色式（tile.wool.<color>, tile.concrete.<color> 等）
 * 3. 墙/台阶/砖等特殊结构
 */
function applyLegacyCompoundRules(data: Record<string, string>, map: Record<string, string>): void {
  // ─── tile.stone.<variant>.name → minecraft:<variant> ───
  // tile.stone.andesite.name → minecraft:andesite
  // tile.stone.granite.name → minecraft:granite
  // tile.stone.diorite.name → minecraft:diorite
  // tile.stone.stone.name → minecraft:stone
  const stoneLegacy: Record<string, string> = {
    "andesite": "andesite",
    "granite": "granite",
    "diorite": "diorite",
    "stone": "stone",
  };
  for (const [variant, target] of Object.entries(stoneLegacy)) {
    const key = `tile.stone.${variant}.name`;
    if (data[key] && !map["minecraft:" + target]) {
      map["minecraft:" + target] = data[key];
    }
  }

  // ─── tile.leaves.<wood>.name → minecraft:<wood>_leaves ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.leaves?\.(.+)\.name$/);
    if (m) {
      const wood = m[1];
      const target = "minecraft:" + wood + "_leaves";
      if (!map[target]) map[target] = val;
    }
  }

  // ─── 颜色词在第二段的 tile 键 ───
  // 模式: tile.<type>.<color>.name  → minecraft:<color>_<modern_type>
  // 其中 <type> 与 modern_type 可能不同

  // 基础映射: type (zh_CN key 中段) → modern typeId 后缀
  const colorBlockMappings: Record<string, string> = {
    "wool": "wool",
    "carpet": "carpet",
    "concrete": "concrete",
    "stained_glass": "stained_glass",
    "stained_glass_pane": "stained_glass_pane",
    "stained_hardened_clay": "terracotta",         // legacy → modern
    "hardened_clay": "terracotta",                  // 无色
  };

  for (const [baseType, modernType] of Object.entries(colorBlockMappings)) {
    for (const color of COLORS) {
      const key = `tile.${baseType}.${color}.name`;
      if (typeof data[key] !== "string") continue;
      const target = "minecraft:" + color + "_" + modernType;
      if (!map[target]) map[target] = data[key];
    }
    // 无色版本: tile.hardened_clay.name → minecraft:terracotta
    if (baseType === "hardened_clay") {
      const noColorKey = `tile.${baseType}.name`;
      if (data[noColorKey] && !map["minecraft:" + modernType]) {
        map["minecraft:" + modernType] = data[noColorKey];
      }
    }
  }

  // ─── tile.glazedTerracotta.<color>.name → minecraft:<color>_glazed_terracotta ───
  for (const color of COLORS) {
    const key = `tile.glazedTerracotta.${color}.name`;
    if (typeof data[key] !== "string") continue;
    const target = "minecraft:" + color + "_glazed_terracotta";
    if (!map[target]) map[target] = data[key];
  }

  // ─── tile.shulkerBox<Color>.name → minecraft:<color>_shulker_box ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.shulkerBox([A-Z][a-zA-Z]*)\.name$/);
    if (m) {
      const colorPascal = m[1];
      const color = colorPascal.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
      const target = "minecraft:" + color + "_shulker_box";
      if (!map[target]) map[target] = val;
    }
  }

  // ─── tile.sand.<variant>.name → sand / red_sand ───
  // tile.sand.default.name → minecraft:sand
  // tile.sand.red.name → minecraft:red_sand
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.sand\.(.+)\.name$/);
    if (!m) continue;
    const target = m[1] === "red" ? "minecraft:red_sand" : "minecraft:sand";
    if (!map[target]) map[target] = val;
  }

  // ─── tile.grass.name → minecraft:grass_block ───
  if (data["tile.grass.name"] && !map["minecraft:grass_block"]) {
    map["minecraft:grass_block"] = data["tile.grass.name"];
  }

  // ─── tile.stonecutter.name → minecraft:stonecutter_block ───
  if (data["tile.stonecutter.name"] && !map["minecraft:stonecutter_block"]) {
    map["minecraft:stonecutter_block"] = data["tile.stonecutter.name"];
  }

  // ─── tile.fence.name / tile.fence_gate.name → minecraft:oak_fence / oak_fence_gate ───
  if (data["tile.fence.name"] && !map["minecraft:oak_fence"]) {
    map["minecraft:oak_fence"] = data["tile.fence.name"];
  }
  if (data["tile.fence_gate.name"] && !map["minecraft:oak_fence_gate"]) {
    map["minecraft:oak_fence_gate"] = data["tile.fence_gate.name"];
  }

  // ─── dirt.coarse.name → minecraft:coarse_dirt ───
  if (data["tile.dirt.coarse.name"] && !map["minecraft:coarse_dirt"]) {
    map["minecraft:coarse_dirt"] = data["tile.dirt.coarse.name"];
  }

  // ─── tile.red_flower.<name>.name / tile.yellow_flower.<name>.name → flowers ───
  const flowerLegacy: Record<string, string> = {
    "tile.red_flower.poppy.name": "minecraft:poppy",
    "tile.red_flower.blueOrchid.name": "minecraft:blue_orchid",
    "tile.red_flower.allium.name": "minecraft:allium",
    "tile.red_flower.cornflower.name": "minecraft:cornflower",
    "tile.red_flower.oxeyeDaisy.name": "minecraft:oxeye_daisy",
    "tile.red_flower.lilyOfTheValley.name": "minecraft:lily_of_the_valley",
    "tile.yellow_flower.dandelion.name": "minecraft:dandelion",
    "tile.double_plant.sunflower.name": "minecraft:sunflower",
    "tile.double_plant.lilac.name": "minecraft:lilac",
    "tile.double_plant.rose.name": "minecraft:rose_bush",
    "tile.double_plant.peony.name": "minecraft:peony",
  };
  for (const [key, target] of Object.entries(flowerLegacy)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── tile.tallgrass.<type>.name → short_grass / fern ───
  const grassLegacy: Record<string, string> = {
    "tile.tallgrass.grass.name": "minecraft:short_grass",
    "tile.tallgrass.fern.name": "minecraft:fern",
    "tile.tallgrass.name": "minecraft:tall_grass",
  };
  for (const [key, target] of Object.entries(grassLegacy)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── tile.double_plant.<name>.name → tall flowers ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.double_plant\.(.+)\.name$/);
    if (!m) continue;
    const name = m[1];
    // snake_case conversion for PascalCase names
    const snake = name.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "");
    const target = "minecraft:" + snake;
    if (!map[target]) map[target] = val;
  }

  // ─── tile.sponge.<variant>.name → sponge / wet_sponge ───
  if (data["tile.sponge.dry.name"] && !map["minecraft:sponge"]) {
    map["minecraft:sponge"] = data["tile.sponge.dry.name"];
  }
  if (data["tile.sponge.wet.name"] && !map["minecraft:wet_sponge"]) {
    map["minecraft:wet_sponge"] = data["tile.sponge.wet.name"];
  }

  // ─── tile.monster_egg.<variant>.name → infested_<variant> ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.monster_egg\.(.+)\.name$/);
    if (!m) continue;
    const variant = m[1].replace(/([A-Z])/g, "_$1").toLowerCase();
    const target = "minecraft:infested_" + variant;
    if (!map[target]) map[target] = val;
  }

  // ─── tile.cobblestone_wall.<type>.name → <type>_wall ───
  const wallLegacy: Record<string, string> = {
    "normal": "cobblestone_wall",
    "mossy": "mossy_cobblestone_wall",
    "granite": "granite_wall",
    "diorite": "diorite_wall",
    "andesite": "andesite_wall",
    "sandstone": "sandstone_wall",
    "brick": "brick_wall",
    "stone_brick": "stone_brick_wall",
    "mossy_stone_brick": "mossy_stone_brick_wall",
    "nether_brick": "nether_brick_wall",
    "red_nether_brick": "red_nether_brick_wall",
    "red_sandstone": "red_sandstone_wall",
    "end_brick": "end_stone_brick_wall",
    "prismarine": "prismarine_wall",
  };
  for (const [variant, target] of Object.entries(wallLegacy)) {
    const key = `tile.cobblestone_wall.${variant}.name`;
    if (data[key] && !map["minecraft:" + target]) {
      map["minecraft:" + target] = data[key];
    }
  }

  // ─── stone_slab<N>.<type>.name → <type>_slab ───
  const slabGroups: Record<string, Record<string, string>> = {
    "stone_slab": {
      "brick": "brick_slab",
      "cobble": "cobblestone_slab",
      "nether_brick": "nether_brick_slab",
      "quartz": "quartz_slab",
      "sand": "sandstone_slab",
      "smoothStoneBrick": "stone_brick_slab",
      "wood": "oak_slab",
      "stone": "smooth_stone_slab",
    },
    "stone_slab2": {
      "red_sandstone": "red_sandstone_slab",
      "purpur": "purpur_slab",
      "prismarine.rough": "prismarine_slab",
      "prismarine.dark": "dark_prismarine_slab",
      "prismarine.bricks": "prismarine_brick_slab",
      "mossy_cobblestone": "mossy_cobblestone_slab",
      "red_nether_brick": "red_nether_brick_slab",
      "sandstone.smooth": "smooth_sandstone_slab",
    },
    "stone_slab3": {
      "end_brick": "end_stone_brick_slab",
      "red_sandstone.smooth": "smooth_red_sandstone_slab",
      "andesite": "andesite_slab",
      "andesite.smooth": "polished_andesite_slab",
      "diorite": "diorite_slab",
      "diorite.smooth": "polished_diorite_slab",
      "granite": "granite_slab",
      "granite.smooth": "polished_granite_slab",
    },
    "stone_slab4": {
      "mossy_stone_brick": "mossy_stone_brick_slab",
      "smooth_quartz": "smooth_quartz_slab",
      "stone": "normal_stone_slab",
      "cut_sandstone": "cut_sandstone_slab",
      "cut_red_sandstone": "cut_red_sandstone_slab",
    },
  };

  for (const [group, variants] of Object.entries(slabGroups)) {
    for (const [variant, target] of Object.entries(variants)) {
      const key = `tile.${group}.${variant}.name`;
      if (data[key] && !map["minecraft:" + target]) {
        map["minecraft:" + target] = data[key];
      }
    }
  }

  // ─── stonebrick.<variant>.name → <variant>_stone_bricks ───
  const stonebrickLegacy: Record<string, string> = {
    "tile.stonebrick.default.name": "minecraft:stone_bricks",
    "tile.stonebrick.chiseled.name": "minecraft:chiseled_stone_bricks",
    "tile.stonebrick.cracked.name": "minecraft:cracked_stone_bricks",
    "tile.stonebrick.mossy.name": "minecraft:mossy_stone_bricks",
  };
  for (const [key, target] of Object.entries(stonebrickLegacy)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── sandstone.<variant>.name / red_sandstone.<variant>.name ───
  const sandstoneVariants: Record<string, string> = {
    "tile.sandstone.chiseled.name": "minecraft:chiseled_sandstone",
    "tile.sandstone.cut.name": "minecraft:cut_sandstone",
    "tile.sandstone.smooth.name": "minecraft:smooth_sandstone",
    "tile.sandstone.default.name": "minecraft:sandstone",
    "tile.red_sandstone.chiseled.name": "minecraft:chiseled_red_sandstone",
    "tile.red_sandstone.cut.name": "minecraft:cut_red_sandstone",
    "tile.red_sandstone.smooth.name": "minecraft:smooth_red_sandstone",
    "tile.red_sandstone.default.name": "minecraft:red_sandstone",
  };
  for (const [key, target] of Object.entries(sandstoneVariants)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── purpur_block.<variant>.name ───
  const purpurVariants: Record<string, string> = {
    "tile.purpur_block.default.name": "minecraft:purpur_block",
    "tile.purpur_block.lines.name": "minecraft:purpur_pillar",
    "tile.purpur_block.chiseled.name": "minecraft:chiseled_purpur",
  };
  for (const [key, target] of Object.entries(purpurVariants)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── crimson_roots / warped_roots ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.(crimson|warped)_roots\.(.+)\.name$/);
    if (m) {
      const target = "minecraft:" + m[1] + "_roots";
      if (!map[target]) map[target] = val;
    }
  }

  // ─── seagrass ───
  for (const [key, val] of Object.entries(data)) {
    if (key.match(/^tile\.seagrass\.(.+)\.name$/) && !map["minecraft:seagrass"]) {
      map["minecraft:seagrass"] = val;
    }
  }

  // ─── brown_mushroom_block / red_mushroom_block ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.(brown|red)_mushroom_block\.(.+)\.name$/);
    if (m) {
      const target = "minecraft:" + m[1] + "_mushroom_block";
      if (!map[target]) map[target] = val;
    }
  }

  // ─── silver → light_gray（遗留颜色词映射） ───
  // zh_CN 中 "silver" 即 "light_gray"
  for (const baseType of ["wool", "carpet", "concrete", "stained_glass", "stained_glass_pane", "stained_hardened_clay"]) {
    const key = `tile.${baseType}.silver.name`;
    if (typeof data[key] !== "string") continue;
    const modernType = baseType === "stained_hardened_clay" ? "terracotta" : baseType;
    const target = "minecraft:light_gray_" + modernType;
    if (!map[target]) map[target] = data[key];
  }
  // glazedTerracotta silver
  if (data["tile.glazedTerracotta.silver.name"] && !map["minecraft:light_gray_glazed_terracotta"]) {
    map["minecraft:light_gray_glazed_terracotta"] = data["tile.glazedTerracotta.silver.name"];
  }
  // shulkerBoxSilver
  if (data["tile.shulkerBoxSilver.name"] && !map["minecraft:light_gray_shulker_box"]) {
    map["minecraft:light_gray_shulker_box"] = data["tile.shulkerBoxSilver.name"];
  }
  // concrete_powder silver
  if (data["tile.concrete_powder.silver.name"] && !map["minecraft:light_gray_concrete_powder"]) {
    map["minecraft:light_gray_concrete_powder"] = data["tile.concrete_powder.silver.name"];
  }
  // carpet / wool silver
  if (data["tile.carpet.silver.name"] && !map["minecraft:light_gray_carpet"]) {
    map["minecraft:light_gray_carpet"] = data["tile.carpet.silver.name"];
  }

  // ─── tile.log.<wood>.name → minecraft:<wood>_log ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.log\.(.+)\.name$/);
    if (!m) continue;
    const wood = m[1] === "big_oak" ? "dark_oak" : m[1];
    const target = "minecraft:" + wood + "_log";
    if (!map[target]) map[target] = val;
  }

  // ─── tile.wood.<type>.name → minecraft:<type>_wood ───
  // tile.wood.stripped.<type>.name → minecraft:stripped_<type>_wood
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.wood(?:\.stripped)?\.(.+)\.name$/);
    if (!m) continue;
    const wood = m[1] === "big_oak" ? "dark_oak" : m[1];
    const stripped = key.includes(".stripped.");
    const target = stripped ? "minecraft:stripped_" + wood + "_wood" : "minecraft:" + wood + "_wood";
    if (!map[target]) map[target] = val;
  }

  // ─── tile.wooden_slab.<type>.name → minecraft:<type>_slab ───
  // tile.wooden_slab.oak.name → minecraft:oak_slab
  // tile.wooden_slab.name（无 variant）→ minecraft:oak_slab
  if (data["tile.wooden_slab.name"] && !map["minecraft:oak_slab"]) {
    map["minecraft:oak_slab"] = data["tile.wooden_slab.name"];
  }
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.wooden_slab\.(.+)\.name$/);
    if (!m) continue;
    const wood = m[1] === "big_oak" ? "dark_oak" : m[1];
    const target = "minecraft:" + wood + "_slab";
    if (!map[target]) map[target] = val;
  }

  // ─── tile.coral / tile.coral_block / tile.coral_fan ───
  // coral color mapping: blue → tube, pink → brain, purple → bubble, red → fire, yellow → horn
  const coralColorMap: Record<string, string> = {
    "blue": "tube", "pink": "brain", "purple": "bubble", "red": "fire", "yellow": "horn",
  };
  // tile.coral.<color>.name → minecraft:<coral>_coral
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.coral\.(.+)\.name$/);
    if (!m) continue;
    const color = m[1].replace("_dead", "");
    const coral = coralColorMap[color];
    if (!coral) continue;
    const dead = m[1].includes("_dead") ? "dead_" : "";
    const target = "minecraft:" + dead + coral + "_coral";
    if (!map[target]) map[target] = val;
  }
  // tile.coral_block.<color>.name → minecraft:<coral>_coral_block
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.coral_block\.(.+)\.name$/);
    if (!m) continue;
    const color = m[1].replace("_dead", "");
    const coral = coralColorMap[color];
    if (!coral) continue;
    const dead = m[1].includes("_dead") ? "dead_" : "";
    const target = "minecraft:" + dead + coral + "_coral_block";
    if (!map[target]) map[target] = val;
  }
  // tile.coral_fan / tile.coral_fan_dead
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^tile\.coral_fan(?:_dead)?\.(.+)_fan\.name$/);
    if (!m) continue;
    const color = m[1];
    const coral = coralColorMap[color];
    if (!coral) continue;
    const dead = key.includes("_dead") ? "dead_" : "";
    const target = "minecraft:" + dead + coral + "_coral_fan";
    if (!map[target]) map[target] = val;
  }

  // ─── tile.anvil variants ───
  // tile.anvil.intact.name → minecraft:anvil
  // tile.anvil.slightlyDamaged.name → minecraft:chipped_anvil
  // tile.anvil.veryDamaged.name → minecraft:damaged_anvil
  if (data["tile.anvil.intact.name"] && !map["minecraft:anvil"]) {
    map["minecraft:anvil"] = data["tile.anvil.intact.name"];
  }
  if (data["tile.anvil.slightlyDamaged.name"] && !map["minecraft:chipped_anvil"]) {
    map["minecraft:chipped_anvil"] = data["tile.anvil.slightlyDamaged.name"];
  }
  if (data["tile.anvil.veryDamaged.name"] && !map["minecraft:damaged_anvil"]) {
    map["minecraft:damaged_anvil"] = data["tile.anvil.veryDamaged.name"];
  }
}

/**
 * 应用颜色展开式规则（床、旗帜、染料、盾牌、Bundle 等 16 色变体）。
 */
function applyColorVariantRules(data: Record<string, string>, map: Record<string, string>): void {
  // ─── bed / banner ───
  // item.bed.<color>.name      → minecraft:<color>_bed
  // item.banner.<color>.name   → minecraft:<color>_banner
  for (const itemType of ["bed", "banner"] as const) {
    for (const color of COLORS) {
      const key = `item.${itemType}.${color}.name`;
      if (typeof data[key] !== "string") continue;
      const target = "minecraft:" + color + "_" + itemType;
      if (!map[target]) map[target] = data[key];
    }
  }

  // ─── shield（16 色都映射到同一个 minecraft:shield） ───
  for (const [key, val] of Object.entries(data)) {
    if (key.match(/^item\.shield\.(.+)\.name$/)) {
      if (!map["minecraft:shield"]) {
        map["minecraft:shield"] = val;
      }
    }
  }

  // ─── dye（部分 legacy 染料有别名） ───
  // item.dye.black.name → minecraft:ink_sac（不是 black_dye）
  // item.dye.red.name → minecraft:red_dye（bedrock 版中，red_dye = 玫瑰红）
  // item.dye.blue.name → minecraft:lapis_lazuli
  // item.dye.brown.name → minecraft:cocoa_beans
  // item.dye.white.name → minecraft:bone_meal
  const dyeAliases: Record<string, string> = {
    "black": "minecraft:ink_sac",
    "red": "minecraft:red_dye",
    "blue": "minecraft:lapis_lazuli",
    "brown": "minecraft:cocoa_beans",
    "white": "minecraft:bone_meal",
  };
  for (const color of COLORS) {
    // Try item.dye.<color>.name and item.dye.<color>_new.name
    const key1 = `item.dye.${color}.name`;
    const key2 = `item.dye.${color}_new.name`;
    const val = data[key1] || data[key2];
    if (!val) continue;

    const target = dyeAliases[color] || ("minecraft:" + color + "_dye");
    if (!map[target]) map[target] = val;
  }

  // ─── color_<bundle>（bare item 键） ───
  // item.black_bundle → minecraft:black_bundle
  for (const color of COLORS) {
    const key = "item." + color + "_bundle";
    if (typeof data[key] === "string") {
      const target = "minecraft:" + color + "_bundle";
      if (!map[target]) map[target] = data[key];
    }
  }
}

/**
 * 应用木类展开式规则（船、运输船）。
 * item.boat.<wood>.name       → minecraft:<wood>_boat
 * item.chest_boat.<wood>.name → minecraft:<wood>_chest_boat
 */
function applyWoodVariantRules(data: Record<string, string>, map: Record<string, string>): void {
  const woodTypes = [
    "oak", "spruce", "birch", "jungle", "acacia", "dark_oak",
    "pale_oak", "mangrove", "cherry", "bamboo", "crimson", "warped",
  ];

  for (const wood of woodTypes) {
    const boatKey = `item.boat.${wood}.name`;
    if (data[boatKey]) {
      const target = "minecraft:" + wood + "_boat";
      if (!map[target]) map[target] = data[boatKey];
    }

    const chestBoatKey = `item.chest_boat.${wood}.name`;
    if (data[chestBoatKey]) {
      const target = "minecraft:" + wood + "_chest_boat";
      if (!map[target]) map[target] = data[chestBoatKey];
    }
  }
}

/**
 * 应用特殊物品规则：bucket、skull、dye、mutton、音乐唱片、烟花等。
 */
function applySpecialItemRules(data: Record<string, string>, map: Record<string, string>): void {
  // ─── PascalCase bucket 物品 ───
  const bucketMap: Record<string, string> = {
    "item.bucketLava.name": "minecraft:lava_bucket",
    "item.bucketWater.name": "minecraft:water_bucket",
    "item.bucketFish.name": "minecraft:cod_bucket",
    "item.bucketSalmon.name": "minecraft:salmon_bucket",
    "item.bucketTropical.name": "minecraft:tropical_fish_bucket",
    "item.bucketPuffer.name": "minecraft:pufferfish_bucket",
    "item.bucketAxolotl.name": "minecraft:axolotl_bucket",
  };
  for (const [key, target] of Object.entries(bucketMap)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }
  // Powder snow bucket
  if (data["item.powderSnowBucket.name"] && !map["minecraft:powder_snow_bucket"]) {
    map["minecraft:powder_snow_bucket"] = data["item.powderSnowBucket.name"];
  }

  // ─── Skull variants ───
  const skullMap: Record<string, string> = {
    "item.skull.skeleton.name": "minecraft:skeleton_skull",
    "item.skull.wither.name": "minecraft:wither_skeleton_skull",
    "item.skull.zombie.name": "minecraft:zombie_head",
    "item.skull.char.name": "minecraft:player_head",
    "item.skull.creeper.name": "minecraft:creeper_head",
    "item.skull.dragon.name": "minecraft:dragon_head",
    "item.skull.piglin.name": "minecraft:piglin_head",
  };
  for (const [key, target] of Object.entries(skullMap)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── 别名物品 ───
  const aliasMap: Record<string, string> = {
    "item.steak.name": "minecraft:cooked_beef",
    "item.appleEnchanted.name": "minecraft:enchanted_golden_apple",
    "item.muttonCooked.name": "minecraft:cooked_mutton",
    "item.muttonRaw.name": "minecraft:mutton",
    "item.milk.name": "minecraft:milk_bucket",
    "item.totem.name": "minecraft:totem_of_undying",
    "item.melon.name": "minecraft:melon_slice",
    "item.speckled_melon.name": "minecraft:glistering_melon_slice",
    "item.chorus_fruit_popped.name": "minecraft:popped_chorus_fruit",
    "item.copper_horse_armor.name": "minecraft:copper_horse_armor",
    "item.sugar.name": "minecraft:sugar",
    "item.glass_bottle.name": "minecraft:glass_bottle",
    "item.dragon_breath.name": "minecraft:dragon_breath",
    "item.magma_cream.name": "minecraft:magma_cream",
    "item.chainmail_boots.name": "minecraft:chainmail_boots",
  };
  for (const [key, target] of Object.entries(aliasMap)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── PascalCase 单物品 ───
  const miscPascal: Record<string, string> = {
    "item.carrotOnAStick.name": "minecraft:carrot_on_a_stick",
    "item.emptyMap.name": "minecraft:empty_map",
    "item.netherStar.name": "minecraft:nether_star",
    "item.lodestonecompass.name": "minecraft:lodestone_compass",
    "item.darkoak_sign.name": "minecraft:dark_oak_sign",
    "item.pale_oak_sign.name": "minecraft:pale_oak_sign",
    "item.prismarine_crystals.name": "minecraft:prismarine_crystals",
    "item.prismarine_shard.name": "minecraft:prismarine_shard",
    "item.glow_ink_sac.name": "minecraft:glow_ink_sac",
    "item.horsearmordiamond.name": "minecraft:diamond_horse_armor",
    "item.horsearmorgold.name": "minecraft:golden_horse_armor",
    "item.horsearmoriron.name": "minecraft:iron_horse_armor",
    "item.horsearmorleather.name": "minecraft:leather_horse_armor",
  };
  for (const [key, target] of Object.entries(miscPascal)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }

  // ─── 音乐唱片（item.record_<id>.desc → minecraft:music_disc_<id>） ───
  for (const [key, val] of Object.entries(data)) {
    const m = key.match(/^item\.record_(.+)\.desc$/);
    if (m) {
      const target = "minecraft:music_disc_" + m[1];
      if (!map[target]) map[target] = val;
    }
  }

  // disc_fragment_5
  if (data["item.disc_fragment_5.desc"] && !map["minecraft:disc_fragment_5"]) {
    map["minecraft:disc_fragment_5"] = data["item.disc_fragment_5.desc"];
  }

  // ─── 烟花（zh_CN 中没有直接的 item.firework_rocket.name 等） ───
  // 使用硬编码默认值
  if (data["item.fireworks.flight"] && !map["minecraft:firework_rocket"]) {
    map["minecraft:firework_rocket"] = "烟花";
  }
  if (data["item.fireworksCharge.customColor"] && !map["minecraft:firework_star"]) {
    map["minecraft:firework_star"] = "烟火之星";
  }
}

/**
 * 从实体名称键提取物品名（entity.<id>.name → item typeId）。
 */
function applyEntityNameRules(data: Record<string, string>, map: Record<string, string>): void {
  const entityToItem: Record<string, string> = {
    "entity.tropicalfish.name": "minecraft:tropical_fish",
    "entity.lingering_potion.name": "minecraft:lingering_potion",
    "entity.splash_potion.name": "minecraft:splash_potion",
    "entity.potion.name": "minecraft:potion",
    "entity.cod.name": "minecraft:cod",
  };
  for (const [key, target] of Object.entries(entityToItem)) {
    if (data[key] && !map[target]) map[target] = data[key];
  }
}

// ─── 索引构建 ────────────────────────────────────────────────────

/**
 * 从 ITEM_NAME_MAP 构建中文名→typeId 的反向搜索索引。
 *
 * @param map - typeId → 中文名的映射
 * @returns 中文名（小写）→ typeId 列表的索引
 */
function buildNameIndex(map: Record<string, string>): Map<string, string[]> {
  const idx = new Map<string, string[]>();

  for (const [typeId, name] of Object.entries(map)) {
    const key = name.toLowerCase();
    const existing = idx.get(key);
    if (existing) {
      existing.push(typeId);
    } else {
      idx.set(key, [typeId]);
    }
  }

  return idx;
}
