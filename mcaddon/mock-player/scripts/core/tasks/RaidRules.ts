// ─── 劫掠规则（core/tasks，劫掠任务内聚） ────────────────
// 从 core/service/RaidRules 内聚到劫掠任务模块（用户规格：相关规则都内聚过来）。
// 零 @minecraft 依赖，可单测。
// ⚠️ 数值基于 zh.minecraft.wiki 基岩版机制核对（1.1.67）：
//   - 不祥之兆 100 分钟（不在村庄/试炼之地挂着不转化）；村庄内喝 → 转化袭击之兆
//   - 袭击之兆 30 秒；结束时袭击于获得效果的位置完全开始
//   - 袭击总波数由难度决定：简单 3 / 普通 5 / 困难 7（基岩版与袭击之兆等级无关）
//   - 波间冷却 15 秒（除最后一波外，最后一名袭击者被杀后）
//   - 袭击者加入半径 96 格 / 退出半径 112 格（阶段估算扫描用）
//   - 停战：袭击持续 48000 tick（40 分钟）未结束 → 平局中止

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

/**
 * 基岩版袭击参与生物 typeId 列表（wiki 波次表核对）：
 * 掠夺者/卫道士/唤魔者/劫掠兽/女巫；唤魔者用基岩版内部名 evocation_illager。
 * 阶段估算（每波生成/冷却检测）用——扫描范围内这些生物的存在情况。
 */
export const RAIDER_TYPE_IDS = [
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:evocation_illager",
  "minecraft:ravager",
  "minecraft:witch",
] as const;

/** 袭击者加入袭击的半径（格，wiki：进入袭击中心 96 格内加入当前波次） */
export const RAID_JOIN_RADIUS = 96;
/** 袭击者退出袭击的半径（格，wiki：离开袭击中心 112 格退出）——阶段估算扫描半径 */
export const RAID_LEAVE_RADIUS = 112;
/** 波间冷却（tick）：最后一波外的波次清完后 15 秒生成下一波 */
export const RAID_WAVE_COOLDOWN_TICKS = 300;
/** 停战超时（tick）：袭击持续 40 分钟未结束 → 平局中止 */
export const RAID_TRUCE_TICKS = 48000;

/** 各难度袭击总波数（wiki：简单 3 / 普通 5 / 困难 7；基岩版与袭击之兆等级无关） */
export const WAVE_COUNTS_BY_DIFFICULTY: Record<string, number> = {
  peaceful: 0,
  easy: 3,
  normal: 5,
  hard: 7,
};

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

/** 按难度取袭击总波数（未知难度兜底普通 5 波） */
export function raidWaveCount(difficulty: string): number {
  return WAVE_COUNTS_BY_DIFFICULTY[difficulty] ?? 5;
}
