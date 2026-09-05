// ─── 钓鱼战利品掉落物白名单（core 规则） ──────────────
// 磁吸拾取（vacuumNearbyDrops）的"感兴趣掉落物"过滤——钓鱼模式每轮收竿后
// 只磁吸**鱼获类**掉落物（不误吸其他玩家/环境的掉落）。
// 纯数据：typeId 列表（vanilla 钓鱼掉落池：鱼/河豚/墨囊/海鞘/骨头/木棍等）。

/** 钓鱼模式感兴趣掉落物 typeId 白名单（鱼获 + 常见钓鱼垃圾中的可拾物） */
export const FISHING_LOOT_TYPES: readonly string[] = [
  // 鱼获（钓上来直接掉落成实体的场景）
  "minecraft:cod",
  "minecraft:salmon",
  "minecraft:tropical_fish",
  "minecraft:pufferfish",
  "minecraft:cod_bucket",
  "minecraft:salmon_bucket",
  "minecraft:tropical_fish_bucket",
  "minecraft:pufferfish_bucket",
  // 附魔书/钓竿（钓到的装备）
  "minecraft:fishing_rod",
  "minecraft:enchanted_book",
  "minecraft:book",
  "minecraft:bowl",
  "minecraft:stick",
  "minecraft:string",
  "minecraft:bone",
  "minecraft:ink_sac",
  "minecraft:glow_ink_sac",
  "minecraft:prismarine_shard",
  "minecraft:prismarine_crystals",
  "minecraft:nautilus_shell",
  "minecraft:saddle",
  "minecraft:name_tag",
  "minecraft:leather",
  "minecraft:rotten_flesh",
  "minecraft:lily_pad",
];
