// ─── 命名映射与位置格式化 ───────────────────────────────────────
//
// 群系 ID → 中文名、维度 ID → 中文名、坐标 → 展示串。
// 纯数据 + 纯函数,未知标识回落为去掉命名空间的原串。

import type { Position } from "./types";

/** 维度 ID → 短名。用于列表里的紧凑展示。 */
const DIMENSION_NAMES: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界",
  "minecraft:the_end": "末地",
};

/** 维度 ID → 带英文的全名。用于详情页。 */
const DIMENSION_FULL_NAMES: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界 (Nether)",
  "minecraft:the_end": "末地 (The End)",
};

/** 群系 ID(不含命名空间)→ 中文名。覆盖主世界、下界、末地。 */
const BIOME_NAMES: Record<string, string> = {
  // 主世界 · 平原与森林
  plains: "平原",
  sunflower_plains: "向日葵平原",
  forest: "森林",
  flower_forest: "繁花森林",
  birch_forest: "白桦林",
  old_growth_birch_forest: "原始白桦林",
  dark_forest: "黑森林",
  taiga: "针叶林",
  old_growth_pine_taiga: "原始松针叶林",
  old_growth_spruce_taiga: "原始云杉针叶林",
  snowy_taiga: "雪原针叶林",
  jungle: "丛林",
  bamboo_jungle: "竹林",
  sparse_jungle: "稀疏丛林",

  // 主世界 · 寒冷与雪地
  snowy_plains: "雪原",
  ice_spikes: "冰刺平原",
  frozen_ocean: "冻洋",
  frozen_river: "冻河",
  snowy_beach: "雪滩",
  grove: "雪林",
  snowy_slopes: "积雪山坡",
  frozen_peaks: "冰封山峰",
  jagged_peaks: "尖峭山峰",

  // 主世界 · 山地与洞穴
  meadow: "草甸",
  windswept_hills: "风袭丘陵",
  windswept_forest: "风袭森林",
  windswept_gravelly_hills: "风袭砾石丘陵",
  stony_peaks: "石峰",
  dripstone_caves: "溶洞",
  lush_caves: "繁茂洞穴",
  deep_dark: "深暗之域",

  // 主世界 · 沼泽、河流与海滩
  swamp: "沼泽",
  mangrove_swamp: "红树林沼泽",
  river: "河流",
  beach: "沙滩",
  stone_shore: "石岸",
  mushroom_fields: "蘑菇岛",

  // 主世界 · 恶地与热带
  badlands: "恶地",
  wooded_badlands: "林地恶地",
  eroded_badlands: "侵蚀恶地",
  savanna: "热带草原",
  savanna_plateau: "热带高原",
  windswept_savanna: "风袭热带草原",

  // 主世界 · 海洋
  ocean: "海洋",
  deep_ocean: "深海",
  warm_ocean: "暖水海洋",
  lukewarm_ocean: "温水海洋",
  deep_lukewarm_ocean: "深温水海洋",
  cold_ocean: "冷水海洋",
  deep_cold_ocean: "深冷水海洋",
  deep_frozen_ocean: "深冻洋",

  // 下界
  nether_wastes: "下界荒地",
  crimson_forest: "绯红森林",
  warped_forest: "诡异森林",
  soul_sand_valley: "灵魂沙峡谷",
  basalt_deltas: "玄武岩三角洲",

  // 末地
  the_end: "末地",
  small_end_islands: "末地小型岛屿",
  end_midlands: "末地内陆",
  end_highlands: "末地高地",
  end_barrens: "末地荒地",
};

/** 去掉 "minecraft:" 前缀。 */
export function stripNamespace(identifier: string): string {
  const index = identifier.indexOf(":");
  return index === -1 ? identifier : identifier.slice(index + 1);
}

/**
 * 群系 ID → 中文名。
 *
 * 未知群系回落为去掉命名空间的原标识,便于玩家与 wiki 对照。
 */
export function biomeDisplayName(biomeId: string): string {
  const key = stripNamespace(biomeId);
  const known = BIOME_NAMES[key];
  return known === undefined ? key : known;
}

/** 维度 ID → 短名。未知维度回落为去掉命名空间的原标识。 */
export function dimensionDisplayName(dimensionId: string): string {
  const known = DIMENSION_NAMES[dimensionId];
  return known === undefined ? stripNamespace(dimensionId) : known;
}

/** 维度 ID → 带英文的全名。未知维度回落为原标识。 */
export function dimensionFullName(dimensionId: string): string {
  const known = DIMENSION_FULL_NAMES[dimensionId];
  return known === undefined ? dimensionId : known;
}

/** 坐标取整后拼成 "x y z"。 */
export function formatCoordinates(position: Position): string {
  return `${Math.floor(position.x)} ${Math.floor(position.y)} ${Math.floor(position.z)}`;
}

/** 坐标 + 维度,例如 "§6主世界 §f120 64 -300"。 */
export function formatLocation(
  position: Position,
  dimensionId: string,
): string {
  return `§6${dimensionDisplayName(dimensionId)} §f${formatCoordinates(position)}`;
}

/** 两点距离(三维欧氏距离,取整到格)。 */
export function distanceBetween(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
}

/**
 * 时间戳 → 相对时间描述。
 *
 * @param now 当前时间,可注入便于测试
 */
export function formatTimeAgo(
  timestamp: number,
  now: number = Date.now(),
): string {
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
}
