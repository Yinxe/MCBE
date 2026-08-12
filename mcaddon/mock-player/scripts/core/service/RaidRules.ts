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

/**
 * 基岩版袭击参与生物 typeId 列表（与 vanilla-data 1.26.20 逐一核对）：
 * 掠夺者/卫道士/唤魔者/劫掠兽/女巫；唤魔者 typeId 用基岩版内部名 evocation_illager。
 *
 * ⚠️ 为什么不按 type_family 一次匹配全部袭击者（双源实测：Mojang/bedrock-samples 1.26
 * 原版行为包实体 JSON + 官方 wiki「族」页——该页由原版行为包模板自动生成，共 141 个族）：
 *   1. 原版没有任何生物的 type_family 含 "raider"（袭击者）族：掠夺者/卫道士/唤魔者
 *      只有 illager（灾厄村民）族，劫掠兽/女巫只有各自单例族 → families:["raider"] 恒匹配 0 个实体；
 *   2. 最接近的 illager 族只含 唤魔者/掠夺者/卫道士 3 种，漏劫掠兽与女巫（基岩版袭击
 *      第 4 波起有女巫、第 6 波起有劫掠兽）→ 单独用它做安全闸会漏；
 *   3. EntityFilter.families 虽接受数组，但语义是 AND（匹配"全部"列出的族），无法做 OR 并集：
 *      传 ["illager","ravager","witch"] 要求实体同时属于三族 → 恒为空。
 *   结论：只能逐 typeId 查询合并；且 @minecraft/server 2.8.0 的 EntityFilter 只有单数
 *   type 字段（typeIds 数组是后续版本才加的），见 mc/features/raidMode.ts hasRaiderNearby。
 */
export const RAIDER_TYPE_IDS = [
  "minecraft:pillager",
  "minecraft:vindicator",
  "minecraft:evocation_illager",
  "minecraft:ravager",
  "minecraft:witch",
] as const;

/** 饮用完整时长（tick）：不祥之瓶需按住 ~1.6s（32 tick）才消耗完。
 *  留 ~8 tick 余量（= 2 秒）：防网络/调度抖动导致 stopUsingItem 在消耗完成前打断、药水没喝完 */
export const DRINK_DURATION = 40;

/** 袭击未触发卡死提醒：1 分钟 = 1200 tick（带不祥之兆却久未触发 → 提醒玩家） */
export const RAID_STUCK_TICKS = 1200;

/** 劫掠兜底巡检间隔：30 秒 = 600 tick。
 *  周期扫一遍劫掠假人，恢复事件驱动链的断裂（胜利无英雄 / 英雄事件丢失 / 喝瓶静默失败）。 */
export const RAID_SWEEP_TICKS = 600;

/** 单场袭击预期最长时长：10 分钟 = 12000 tick。
 *  基岩版袭击最多 7 波（困难），波间隔约 40 秒，10 分钟足够打完；
 *  超过后假人仍无村庄英雄且附近无袭击者 → 判定袭击已结束但胜利信号丢失，兜底续瓶。 */
export const RAID_EXPECT_TICKS = 12000;

/** 兜底续瓶冷却：1 分钟 = 1200 tick（防止巡检反复续瓶刷屏/连开多场袭击） */
export const RAID_FORCE_COOLDOWN = 1200;

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