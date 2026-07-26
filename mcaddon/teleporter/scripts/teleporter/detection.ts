import { Dimension, Vector3 } from "@minecraft/server";

// ─── 群系名称映射 ───────────────────────────────────────────────────

const BIOME_NAMES: Record<string, string> = {
  // 主世界 - 平原/森林/沙漠
  plains: "平原",
  sunflower_plains: "向日葵平原",
  desert: "沙漠",
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

  // 主世界 - 寒冷/雪地
  snowy_plains: "雪原",
  ice_spikes: "冰刺平原",
  frozen_ocean: "冻洋",
  frozen_river: "冻河",
  snowy_beach: "雪滩",
  grove: "雪林",
  snowy_slopes: "积雪山坡",
  frozen_peaks: "冰封山峰",
  jagged_peaks: "尖峭山峰",

  // 主世界 - 山地/高地
  meadow: "草甸",
  windswept_hills: "风袭丘陵",
  windswept_forest: "风袭森林",
  windswept_gravelly_hills: "风袭砾石丘陵",
  stony_peaks: "石峰",
  dripstone_caves: "溶洞",
  lush_caves: "繁茂洞穴",
  deep_dark: "深暗之域",

  // 主世界 - 沼泽/海滩/河流
  swamp: "沼泽",
  mangrove_swamp: "红树林沼泽",
  river: "河流",
  beach: "沙滩",
  stone_shore: "石岸",
  mushroom_fields: "蘑菇岛",

  // 主世界 - 恶地/热带
  badlands: "恶地",
  wooded_badlands: "林地恶地",
  eroded_badlands: "侵蚀恶地",
  savanna: "热带草原",
  savanna_plateau: "热带高原",
  windswept_savanna: "风袭热带草原",

  // 主世界 - 海洋
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

// ─── 公开 API ──────────────────────────────────────────────────────

/**
 * 检测所在位置的群系名称（中文）。
 * 返回类似 "平原"、"沙漠"、"深暗之域" 等。
 * 无法获取时返回 null。
 */
export function getBiomeName(dimension: Dimension, pos: Vector3): string | null {
  try {
    const biome = dimension.getBiome(pos);
    const id = biome.id.replace("minecraft:", "");
    return BIOME_NAMES[id] ?? id;
  } catch {
    return null;
  }
}

/**
 * 获取 biomeId（原始 Minecraft ID，如 "minecraft:plains"）。
 */
export function getRawBiomeId(dimension: Dimension, pos: Vector3): string | null {
  try {
    return dimension.getBiome(pos).id;
  } catch {
    return null;
  }
}
