// ─── 劫掠规则（core/tasks，劫掠任务内聚） ────────────────
// 从 core/service/RaidRules 内聚到劫掠任务模块（用户规格：相关规则都内聚过来）。
// 零 @minecraft 依赖，可单测。
// ⚠️ 数值基于 zh.minecraft.wiki 基岩版机制核对（1.1.67）：
//   - 不祥之兆 100 分钟（不在村庄/试炼之地挂着不转化）；村庄内喝 → 转化袭击之兆
//   - 袭击之兆 30 秒；结束时袭击于获得效果的位置完全开始
//   - 停战：袭击持续 48000 tick（40 分钟）未结束 → 平局中止
// ⚠️ 波次/冷却/生成机制已移除（用户实测无用，2.0.0）——阶段通知只保留
//   预触发/开始/胜利/停战（核心流程事件驱动）

/** 不祥之瓶物品 ID */
export const OMINOUS_BOTTLE_ID = "minecraft:ominous_bottle";

/** 不祥之兆（喝瓶后获得；100 分钟；村庄/试炼之地内转化为袭击之兆或试炼之兆） */
export const BAD_OMEN = "minecraft:bad_omen";
/** 袭击之兆（村庄内转化，30 秒后袭击完全开始） */
export const RAID_OMEN = "minecraft:raid_omen";
/** 村庄英雄（袭击胜利获得，40 分钟）——劫掠结束判定 */
export const VILLAGE_HERO = "minecraft:village_hero";

/**
 * 饮用完整时长（tick）：不祥之瓶需按住 ~1.6s（32 tick）才消耗完。
 *  留 ~8 tick 余量（= 2 秒）：防网络/调度抖动导致 stopUsingItem 在消耗完成前打断、药水没喝完
 */
export const DRINK_DURATION = 40;

/** 停战超时（tick）：袭击持续 40 分钟未结束 → 平局中止 */
export const RAID_TRUCE_TICKS = 48000;

/** 物品类型匹配：Script API typeId 恒带命名空间前缀，直接精确比对 */
export function isOminousBottle(typeId: string): boolean {
  return typeId === OMINOUS_BOTTLE_ID;
}

/** 效果类型分类（用于 effectAdd 事件分流） */
export type RaidEffectType = "bad-omen" | "raid-omen" | "village-hero";

/** 识别劫掠相关效果类型，无关效果返回 undefined */
export function classifyRaidEffect(typeId: string): RaidEffectType | undefined {
  if (typeId === BAD_OMEN) return "bad-omen";
  if (typeId === RAID_OMEN) return "raid-omen";
  if (typeId === VILLAGE_HERO) return "village-hero";
  return undefined;
}
