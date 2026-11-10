// ─── 附魔中英映射（domain 纯数据） ────────────────────────────────
// 展示层两种口径并存：序列化文本用罗马级，面板条目用阿拉伯级。

/** 附魔 ID（去前缀） → 中文名映射（原版全附魔，参考 zh.minecraft.wiki/w/附魔） */
export const ENCH_ZH: Record<string, string> = {
  // 通用
  protection: "保护",
  fire_protection: "火焰保护",
  feather_falling: "摔落保护",
  blast_protection: "爆炸保护",
  projectile_protection: "弹射物保护",
  respiration: "水下呼吸",
  aqua_affinity: "水下速掘",
  thorns: "荆棘",
  depth_strider: "深海探索者",
  frost_walker: "冰霜行者",
  binding_curse: "绑定诅咒",
  // 通用工具/武器
  sharpness: "锋利",
  smite: "亡灵杀手",
  bane_of_arthropods: "节肢杀手",
  knockback: "击退",
  fire_aspect: "火焰附加",
  looting: "抢夺",
  sweeping: "横扫之刃",
  efficiency: "效率",
  silk_touch: "精准采集",
  unbreaking: "耐久",
  fortune: "时运",
  mending: "经验修补",
  vanilla_curse: "消失诅咒",
  // 弓/弩
  power: "力量",
  punch: "冲击",
  flame: "火焰",
  infinity: "无限",
  multishot: "多重射击",
  quick_charge: "快速装填",
  piercing: "穿透",
  // 三叉戟
  impaling: "穿刺",
  riptide: "激流",
  loyalty: "忠诚",
  channeling: "引雷",
  // 钓鱼竿
  luck_of_the_sea: "海之眷顾",
  lure: "诱饵",
  // 头盔专属
  soul_speed: "灵魂疾行",
  swift_sneak: "迅捷潜行",
  wind_burst: "风爆",
  // 1.21+
  density: "致密",
  breach: "破甲",
  // 不详附魔
  venom: "渗毒",
  infestation: "增生",
};

/** 附魔 ID → 中文显示（未知 ID 原样返回；自动去 minecraft: 前缀） */
export function enchantDisplayName(id: string): string {
  const bare = id.startsWith("minecraft:") ? id.slice(10) : id;
  return ENCH_ZH[bare] ?? bare;
}

/** 附魔等级 → 罗马数字（1-10；越界回退 [n]） */
export function levelToRoman(level: number): string {
  const map: Record<number, string> = {
    1: "I",
    2: "II",
    3: "III",
    4: "IV",
    5: "V",
    6: "VI",
    7: "VII",
    8: "VIII",
    9: "IX",
    10: "X",
  };
  return map[level] || `[${level}]`;
}
