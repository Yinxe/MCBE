// ─── 实体种类武器偏好表（武器域扩展入口，纯数据，零 @minecraft 依赖） ──
// 为"被攻击的实体种类"覆盖默认武器选择：两级偏好（附魔 1 级 + 工具 2 级）
//   "打亡灵 → 亡灵杀手>锋利（附魔 1 级），同附魔下剑>斧（工具 2 级）"
//   "打其它 → 锋利优先（附魔 1 级），同附魔下剑>斧（工具 2 级）"
// 每行产出 PreferenceSpec，由 ToolScorer.preferenceScorer 排序；表达不了（无亡灵/锋利）
// → 该策略内按工具链排序（剑>斧），与 weapon 默认兜底同语义。区别于挖掘域（strict）：
// 武器域不 strict——没有附魔只是"赢不了附魔候选"，仍按工具偏好选最优。
// 与 MinePreference（方块偏好）并列，同走 ToolSelector 决策引擎。

import { type PreferenceSpec } from "./types";

/** 实体种类武器偏好规则：match 命中被攻击实体的 typeId → 按该两级偏好决策 */
interface EntityWeaponRule {
  readonly name: string;
  readonly match: (entityTypeId: string) => boolean;
  readonly pref: PreferenceSpec;
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
 * 亡灵 → 亡灵杀手优先，其次锋利（附魔 1 级）；其它 → 锋利优先（附魔 1 级）；
 * 工具 2 级统一 剑>斧>其它。需要新增偏好（如"猪人 → 下界合金?"）时在
 * 此追加一条即可；排序维度由 preferenceScorer 组合，无需注册新策略。
 */
const ENTITY_WEAPON_TABLE: readonly EntityWeaponRule[] = [
  {
    name: "undead-smite",
    match: isUndead,
    pref: {
      name: "undead-smite",
      enchantChain: ["smite", "sharpness"], // 附魔 1 级：亡灵杀手最高，其次锋利
      toolChain: ["sword", "axe", "*"], //     工具 2 级：剑>斧>其它武器
      fallback: "weapon",
    },
  },
  {
    name: "sharpness-general",
    match: () => true, // 所有非亡灵实体：锋利武器优先（附魔 1 级），剑>斧（工具 2 级）
    pref: {
      name: "sharpness-general",
      enchantChain: ["sharpness"],
      toolChain: ["sword", "axe", "*"],
      fallback: "weapon",
    },
  },
];

/**
 * 查被攻击实体的武器偏好（两级偏好规格）；本表必有任意规则命中（sharpness-general）。
 * @param entityTypeId 被攻击实体的 typeId（如 minecraft:zombie）
 */
export function lookupWeaponStrategy(entityTypeId: string): PreferenceSpec | undefined {
  const rule = ENTITY_WEAPON_TABLE.find((r) => r.match(entityTypeId));
  return rule?.pref;
}
