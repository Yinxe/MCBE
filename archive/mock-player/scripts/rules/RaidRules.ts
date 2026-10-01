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

// ─── 流程决策纯函数（事件驱动循环：开启/胜利后喝瓶 → 等袭击 → 胜利） ──

/** 效果状态（决策输入，mc 层实时查询实体） */
export interface RaidEffectState {
  badOmen: boolean;
  raidOmen: boolean;
}

/**
 * 可喝瓶判定（用户规格：**只在启动时与胜利后喝**）：
 * 无兆头（一场袭击已在酝酿/进行则不重复喝）+ 背包有药水 +
 * 未在周期等待（本周期已喝过 → 等袭击/胜利，兆头消失也不重复喝）。
 * @param effects 效果状态
 * @param bottles 背包不祥之瓶数量
 * @param waiting 周期等待标记（已喝过、等袭击/胜利）
 */
export function canDrinkRaid(effects: RaidEffectState, bottles: number, waiting: boolean): boolean {
  return !effects.badOmen && !effects.raidOmen && bottles > 0 && !waiting;
}

/** 等待原因（无药水通知用；"waiting"= 袭击中/周期等待，静默等待） */
export type RaidIdleReason = "no-bottle" | "waiting";

/**
 * 等待原因诊断：开不了瓶时区分"背包没有不祥之瓶"（通知）与
 * "袭击进行中/胜利待处理/周期等待"（静默等待）。
 * @param effects 效果状态
 * @param bottles 背包不祥之瓶数量
 * @param waiting 周期等待标记
 */
export function diagnoseRaidIdle(effects: RaidEffectState, bottles: number, waiting: boolean): RaidIdleReason {
  if (waiting) return "waiting";
  if (!effects.badOmen && !effects.raidOmen && bottles === 0) return "no-bottle";
  return "waiting";
}
