/**
 * 附魔 ID → 中文名的映射。
 *
 * 数据来源：zh_CN.json（enchantment.* 键），vanilla-data MinecraftEnchantmentTypes 作为 key。
 * 人工从 zh_CN.json 抄写验算。
 */

import type { EnchantmentNameMap } from "./types";

const enchantments: EnchantmentNameMap = {
  "minecraft:aqua_affinity": "水下速掘",
  "minecraft:bane_of_arthropods": "节肢杀手",
  "minecraft:binding": "绑定诅咒",
  "minecraft:blast_protection": "爆炸保护",
  "minecraft:breach": "破甲",
  "minecraft:channeling": "引雷",
  "minecraft:depth_strider": "深海探索者",
  "minecraft:density": "致密",
  "minecraft:efficiency": "效率",
  "minecraft:feather_falling": "摔落保护",
  "minecraft:fire_aspect": "火焰附加",
  "minecraft:fire_protection": "火焰保护",
  "minecraft:flame": "火矢",
  "minecraft:fortune": "时运",
  "minecraft:frost_walker": "冰霜行者",
  "minecraft:impaling": "穿刺",
  "minecraft:infinity": "无限",
  "minecraft:knockback": "击退",
  "minecraft:looting": "抢夺",
  "minecraft:loyalty": "忠诚",
  "minecraft:luck_of_the_sea": "海之眷顾",
  "minecraft:lure": "饵钓",
  "minecraft:mending": "经验修补",
  "minecraft:multishot": "多重射击",
  "minecraft:piercing": "穿透",
  "minecraft:power": "力量",
  "minecraft:projectile_protection": "弹射物保护",
  "minecraft:protection": "保护",
  "minecraft:punch": "冲击",
  "minecraft:quick_charge": "快速装填",
  "minecraft:respiration": "水下呼吸",
  "minecraft:riptide": "激流",
  "minecraft:sharpness": "锋利",
  "minecraft:silk_touch": "精准采集",
  "minecraft:smite": "亡灵杀手",
  "minecraft:soul_speed": "灵魂疾行",
  "minecraft:swift_sneak": "迅捷潜行",
  "minecraft:thorns": "荆棘",
  "minecraft:unbreaking": "耐久",
  "minecraft:vanishing": "消失诅咒",
  "minecraft:wind_burst": "风爆",
};

export default enchantments;
export { enchantments };
