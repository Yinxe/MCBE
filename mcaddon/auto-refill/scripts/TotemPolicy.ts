// ─── 图腾补充策略（纯逻辑） ────────────────────────────
// 不死图腾没有原生"已触发"事件，但触发时引擎会产生治愈事件
// （world.afterEvents.entityHeal），其 healSource.cause 标识治愈来源。
// 高版本枚举含 EntityHealCause.TotemOfUndying（字符串 "TotemOfUndying"）；
// 低版本枚举可能缺该成员——用排除法：治愈来源不是 Heal / Regeneration /
// SelfHeal 三者之一，即推测为图腾触发。字符串字面量比对等价于比对字符串
// 枚举值，且不依赖枚举成员在运行时是否存在。
//
// 副手守卫：needsTotemRefill 仅在副手不再持有图腾时为 true——图腾已消耗
// （副手空）才补；副手仍持图腾（多枚堆叠）或持其它物品 = 已保护/低版本误报
// → 跳过。该守卫让补货幂等，并杜绝误覆盖玩家副手。

/** 不死图腾物品类型 ID */
export const TOTEM_TYPE_ID = "minecraft:totem_of_undying";

/** 已知非图腾的治愈来源（字符串枚举值；枚举的其余成员在低版本可能缺失） */
const KNOWN_HEAL_CAUSES: ReadonlySet<string> = new Set(["Heal", "Regeneration", "SelfHeal"]);

/**
 * 判定治愈来源是否为"不死图腾触发"。
 *   高版本：cause === "TotemOfUndying" → 精确命中；
 *   低版本（枚举无该成员）：cause 不是 Heal/Regeneration/SelfHeal 三者之一 → 排除法命中。
 * @param cause 治愈来源 cause（EntityHealCause 字符串值；非字符串一律 false）
 */
export function isTotemHealCause(cause: unknown): boolean {
  if (typeof cause !== "string") return false;
  if (cause === "TotemOfUndying") return true;
  return !KNOWN_HEAL_CAUSES.has(cause);
}

/**
 * 当前副手是否已不持有图腾（需要补充）。
 * @param offhandTypeId 副手物品类型（undefined = 副手空）
 */
export function needsTotemRefill(offhandTypeId: string | undefined): boolean {
  return offhandTypeId !== TOTEM_TYPE_ID;
}
