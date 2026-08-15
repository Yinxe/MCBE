// ─── 附魔中英映射（core 层） ────────────────────────────
// 纯数据 + 附魔文本组装（序列化物品版本，供 core 内展示逻辑使用；
// mc 层的 ItemStack 版本格式化在 mc/format.ts）。

import type { SerializedItemStack } from "../Types";

/**
 * 附魔 ID → 中文名映射（原版全附魔）。
 * 参考：https://zh.minecraft.wiki/w/附魔
 */
export const ENCH_ZH: Record<string, string> = {
  // 通用
  protection:       "保护",
  fire_protection:  "火焰保护",
  feather_falling:  "摔落保护",
  blast_protection: "爆炸保护",
  projectile_protection: "弹射物保护",
  respiration:      "水下呼吸",
  aqua_affinity:    "水下速掘",
  thorns:           "荆棘",
  depth_strider:    "深海探索者",
  frost_walker:     "冰霜行者",
  binding_curse:    "绑定诅咒",
  // 通用工具/武器
  sharpness:        "锋利",
  smite:            "亡灵杀手",
  bane_of_arthropods: "节肢杀手",
  knockback:        "击退",
  fire_aspect:      "火焰附加",
  looting:          "抢夺",
  sweeping:         "横扫之刃",
  efficiency:       "效率",
  silk_touch:       "精准采集",
  unbreaking:       "耐久",
  fortune:          "时运",
  mending:          "经验修补",
  vanilla_curse:    "消失诅咒",
  // 弓/弩
  power:            "力量",
  punch:            "冲击",
  flame:            "火焰",
  infinity:         "无限",
  multishot:        "多重射击",
  quick_charge:     "快速装填",
  piercing:         "穿透",
  // 三叉戟
  impaling:         "穿刺",
  riptide:          "激流",
  loyalty:          "忠诚",
  channeling:       "引雷",
  // 钓鱼竿
  luck_of_the_sea:  "海之眷顾",
  lure:             "诱饵",
  // 头盔专属
  soul_speed:       "灵魂疾行",
  swift_sneak:      "迅捷潜行",
  wind_burst:       "风爆",
  // 新增 1.21+
  density:          "致密",
  breach:           "破甲",
  // 不详附魔
  venom:            "渗毒",
  infestation:      "增生",
};

/** 附魔 ID → 中文显示（未知 ID 原样返回） */
export function enchantDisplayName(id: string): string {
  return ENCH_ZH[id] ?? id;
}

/** 序列化物品 → 附魔文本（"锋利III 击退II"，无附魔返回 ""） */
export function formatSerializedEnchantments(item: SerializedItemStack): string {
  if (!item.enchantments || item.enchantments.length === 0) return "";
  return item.enchantments
    .map((e) => `${enchantDisplayName(e.id)}${levelToRomanLocal(e.level)}`)
    .join(" ");
}

function levelToRomanLocal(level: number): string {
  if (level <= 10) return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][level] ?? `${level}`;
  return `${level}`;
}
