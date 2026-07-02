/**
 * 效果 ID → 中文名的映射。
 *
 * 数据来源：zh_CN.json（effect.* 键），vanilla-data MinecraftEffectTypes 作为 key。
 * 人工从 zh_CN.json 抄写验算。
 */

import type { EffectNameMap } from "./types";

const effects: EffectNameMap = {
  "minecraft:absorption": "伤害吸收",
  "minecraft:bad_omen": "不祥之兆",
  "minecraft:blindness": "失明",
  "minecraft:conduit_power": "潮涌能量",
  "minecraft:darkness": "黑暗",
  "minecraft:fatal_poison": "致命中毒",
  "minecraft:fire_resistance": "抗火",
  "minecraft:hunger": "饥饿",
  "minecraft:infested": "寄生",
  "minecraft:invisibility": "隐身",
  "minecraft:jump_boost": "跳跃提升",
  "minecraft:levitation": "飘浮",
  "minecraft:mining_fatigue": "挖掘疲劳",
  "minecraft:nausea": "反胃",
  "minecraft:night_vision": "夜视",
  "minecraft:oozing": "渗浆",
  "minecraft:poison": "中毒",
  "minecraft:raid_omen": "袭击之兆",
  "minecraft:regeneration": "生命恢复",
  "minecraft:resistance": "抗性",
  "minecraft:saturation": "饱和",
  "minecraft:slow_falling": "缓降",
  "minecraft:slowness": "缓慢",
  "minecraft:speed": "速度",
  "minecraft:strength": "力量",
  "minecraft:trial_omen": "试炼之兆",
  "minecraft:village_hero": "村庄英雄",
  "minecraft:water_breathing": "水下呼吸",
  "minecraft:weakness": "虚弱",
  "minecraft:weaving": "编织",
  "minecraft:wind_charged": "蓄风",
  "minecraft:wither": "凋零",
  // zh_CN 中无对应条目的效果（英文回退）
  "minecraft:haste": "Haste",
  "minecraft:health_boost": "Health Boost",
  "minecraft:instant_damage": "Instant Damage",
  "minecraft:instant_health": "Instant Health",
};

export default effects;
export { effects };
