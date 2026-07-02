/**
 * ============================================================================
 * item-families —— 同族物品分类定义和运行时索引
 * ============================================================================
 *
 * 同族物品（ItemFamily）是一组功能相同但颜色/变体不同的物品，
 * 如各色羊毛（16 色）、各色玻璃（16 色）、各种唱片等。
 *
 * 分拣引擎在启用同族分类后，会将同一族的物品路由到同一个容器中，
 * 实现"同族聚集"效果，提升仓库的整洁度和查找便利性。
 *
 * 所有分类均为模组预定义，玩家可在仓库设置中选择启用/禁用。
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

// ─── 族定义 ─────────────────────────────────────────────────────

/** 羊毛（16 色） */
const WOOL: ItemFamily = {
  id: "wool",
  displayName: "羊毛",
  items: [
    "minecraft:white_wool",
    "minecraft:orange_wool",
    "minecraft:magenta_wool",
    "minecraft:light_blue_wool",
    "minecraft:yellow_wool",
    "minecraft:lime_wool",
    "minecraft:pink_wool",
    "minecraft:gray_wool",
    "minecraft:light_gray_wool",
    "minecraft:cyan_wool",
    "minecraft:purple_wool",
    "minecraft:blue_wool",
    "minecraft:brown_wool",
    "minecraft:green_wool",
    "minecraft:red_wool",
    "minecraft:black_wool",
  ],
};

/** 彩色玻璃（16 色） */
const STAINED_GLASS: ItemFamily = {
  id: "stained_glass",
  displayName: "彩色玻璃",
  items: [
    "minecraft:white_stained_glass",
    "minecraft:orange_stained_glass",
    "minecraft:magenta_stained_glass",
    "minecraft:light_blue_stained_glass",
    "minecraft:yellow_stained_glass",
    "minecraft:lime_stained_glass",
    "minecraft:pink_stained_glass",
    "minecraft:gray_stained_glass",
    "minecraft:light_gray_stained_glass",
    "minecraft:cyan_stained_glass",
    "minecraft:purple_stained_glass",
    "minecraft:blue_stained_glass",
    "minecraft:brown_stained_glass",
    "minecraft:green_stained_glass",
    "minecraft:red_stained_glass",
    "minecraft:black_stained_glass",
  ],
};

/** 唱片（所有音乐唱片） */
const MUSIC_DISC: ItemFamily = {
  id: "music_disc",
  displayName: "唱片",
  items: [
    "minecraft:music_disc_13",
    "minecraft:music_disc_cat",
    "minecraft:music_disc_blocks",
    "minecraft:music_disc_chirp",
    "minecraft:music_disc_creator",
    "minecraft:music_disc_creator_music_box",
    "minecraft:music_disc_far",
    "minecraft:music_disc_mall",
    "minecraft:music_disc_mellohi",
    "minecraft:music_disc_otherside",
    "minecraft:music_disc_pigstep",
    "minecraft:music_disc_precipice",
    "minecraft:music_disc_relic",
    "minecraft:music_disc_stal",
    "minecraft:music_disc_strad",
    "minecraft:music_disc_tears",
    "minecraft:music_disc_wait",
    "minecraft:music_disc_ward",
    "minecraft:music_disc_11",
    "minecraft:music_disc_5",
  ],
};

// ─── 索引 ───────────────────────────────────────────────────────

/** 所有预定义的同族分类列表 */
export const ALL_FAMILIES: readonly ItemFamily[] = [
  WOOL,
  STAINED_GLASS,
  MUSIC_DISC,
];

/** typeId → FamilyId 的逆向查找表 */
const TYPE_TO_FAMILY = /* @__PURE__ */ buildTypeToFamily(ALL_FAMILIES);

/** FamilyId → ItemFamily 的查找表 */
const FAMILY_BY_ID = /* @__PURE__ */ buildFamilyById(ALL_FAMILIES);

// ─── 查询函数 ──────────────────────────────────────────────────

/**
 * 获取物品 typeId 所属的同族分类。
 *
 * @param typeId - 物品类型 ID
 * @returns 所属的族，如果不属于任何预定义族则返回 undefined
 */
export function getFamily(typeId: string): ItemFamily | undefined {
  const familyId = TYPE_TO_FAMILY.get(typeId);
  return familyId !== undefined ? FAMILY_BY_ID.get(familyId) : undefined;
}

/**
 * 根据族 ID 获取族定义。
 *
 * @param familyId - 族 ID
 * @returns 族定义，不存在则返回 undefined
 */
export function getFamilyById(familyId: string): ItemFamily | undefined {
  return FAMILY_BY_ID.get(familyId);
}

/**
 * 判断物品 typeId 是否属于指定族。
 *
 * @param typeId  - 物品类型 ID
 * @param familyId - 族 ID
 * @returns 是否属于该族
 */
export function isInFamily(typeId: string, familyId: string): boolean {
  return TYPE_TO_FAMILY.get(typeId) === familyId;
}

// ─── 内部构建 ──────────────────────────────────────────────────

/**
 * 从族列表构建 typeId → familyId 的逆向索引。
 */
function buildTypeToFamily(families: readonly ItemFamily[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const family of families) {
    for (const typeId of family.items) {
      map.set(typeId, family.id);
    }
  }
  return map;
}

/**
 * 从族列表构建 familyId → ItemFamily 的索引。
 */
function buildFamilyById(families: readonly ItemFamily[]): Map<string, ItemFamily> {
  const map = new Map<string, ItemFamily>();
  for (const family of families) {
    map.set(family.id, family);
  }
  return map;
}
