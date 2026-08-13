// ─── 劫掠规则（core 层） ────────────────────────────────
// 纯逻辑：不祥之瓶识别、效果类型分类、饮用/卡死阈值常量。
// 事件监听、效果施加与容器操作在 mc 层（features/raidMode.ts）。

/** 不祥之瓶物品 ID */
export const OMINOUS_BOTTLE_ID = "minecraft:ominous_bottle";

/** 不祥之兆（喝瓶后获得；进入村庄后转为袭击之兆） */
export const BAD_OMEN = "minecraft:bad_omen";
/** 袭击之兆（村庄转化，30 秒后触发袭击） */
export const RAID_OMEN = "minecraft:raid_omen";
/** 村庄英雄（袭击胜利获得）——劫掠结束判定 */
export const VILLAGE_HERO = "minecraft:village_hero";

/** 饮用完整时长（tick）：不祥之瓶需按住 ~1.6s（32 tick）才消耗完。
 *  留 ~8 tick 余量（= 2 秒）：防网络/调度抖动导致 stopUsingItem 在消耗完成前打断、药水没喝完 */
export const DRINK_DURATION = 40;

/** 袭击未触发卡死提醒：1 分钟 = 1200 tick（带袭击之兆却久未触发 → 提醒玩家） */
export const RAID_STUCK_TICKS = 1200;

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