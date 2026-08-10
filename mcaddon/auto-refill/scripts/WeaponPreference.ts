// ─── 实体种类武器偏好表（武器域扩展入口，纯数据，零 @minecraft 依赖） ──
// 为"被攻击的实体种类"覆盖默认武器选择：这是表达
//   "打亡灵生物 → 优先亡灵杀手等级最高的武器，其次锋利，最后默认规则"
// 这类偏好的唯一入口。
// 每个 `EntityWeaponRule`：match 命中被攻击实体的 typeId → 用该偏好（策略 +
// 纵向 fallback 链，缺省落到 weapon 默认策略）在该武器域决策。
// 策略本身在 ToolScorer 注册（smite / sharpness / weapon 等）。
// 与 MinePreference（方块偏好）并列，同走 ToolSelector 决策引擎。

import { type StrategyPref } from "./types";

/** 实体种类武器偏好规则 */
interface EntityWeaponRule {
  readonly name: string;
  /** 命中判定：被攻击实体 typeId 是否属于本规则管辖 */
  readonly match: (entityTypeId: string) => boolean;
  readonly pref: StrategyPref;
}

/** 亡灵（undead）种类：亡灵杀手附魔对这些怪生效（含僵尸马/骷髅马等含关键词的马） */
function isUndead(entityTypeId: string): boolean {
  const id = entityTypeId.toLowerCase();
  return (
    id.includes("zombie") ||
    id.includes("skeleton") ||
    id.includes("wither") ||
    id.includes("phantom") ||
    id.includes("zoglin") ||
    id.includes("bogged") ||
    id.includes("husk") ||
    id.includes("stray") ||
    id.includes("drowned")
  );
}

/**
 * 实体种类偏好注册表（按数组顺序，首个命中者胜出）。
 * 亡灵 → 亡灵杀手优先（smite 最高者），无亡灵杀手 → 锋利最高者，最后默认规则。
 * 需要新增偏好（如"猪人 → 时运?"）时在此追加一条即可；策略本身写在 ToolScorer。
 */
const ENTITY_WEAPON_TABLE: readonly EntityWeaponRule[] = [
  { name: "undead-smite", match: isUndead, pref: { strategy: "smite", fallbackChain: ["sharpness"] } },
];

/**
 * 查被攻击实体的武器偏好；未命中返回 undefined（用默认武器策略）。
 * @param entityTypeId 被攻击实体的 typeId（如 minecraft:zombie）
 */
export function lookupWeaponStrategy(entityTypeId: string): StrategyPref | undefined {
  const rule = ENTITY_WEAPON_TABLE.find((r) => r.match(entityTypeId));
  return rule?.pref;
}
