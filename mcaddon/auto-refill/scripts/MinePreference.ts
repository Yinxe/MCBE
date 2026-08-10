// ─── 方块偏好表（自定义策略的扩展入口，纯数据，零 @minecraft 依赖） ──
// 为指定方块覆盖默认的"省耐久不择优"选择：这里是表达
//   "面对 grass_block，我偏爱带精准采集的锹 / 面对 ore，我偏爱最高品质的镐"
// 这类偏好的唯一入口。
// 每个 `PreferenceRule`：match 命中该方块 typeId → 用 fallbackChain 依次尝试
// （查无此策略 / rank 表达不了偏好按顺序降级），最终落到默认策略（frugal）。
// 新增偏好 = 追加一条规则；新增策略 = 在 ToolScorer 注册即可，无需改其他代码。

import { type StrategyPref } from "./types";

/** 方块偏好规则 */
export interface PreferenceRule {
  /** 规则名（日志/调试用） */
  readonly name: string;
  /** 命中判定：typeId 是否属于本规则管辖 */
  readonly match: (typeId: string) => boolean;
  /** 首选策略名（在 ToolScorer 注册表中查） */
  readonly strategy: string;
  /** 纵向 fallback 链：主策略不可用时依次尝试，最后落到默认策略 */
  readonly fallbackChain?: readonly string[];
}

/**
 * 偏好规则注册表（按数组顺序，首个命中者胜出）。
 * 默认已启用两条低风险偏好（保方块本体）：
 *   - 草方块/灰化土/菌丝 → 精准采集优先（用带精准的锹完整产出方块本体）
 *   - 树叶 → 精准采集优先（完整产出树叶方块；无带精准工具时按默认策略处理）
 * 示例（默认注释，展示"如何新增偏好"）：
 *   - 矿石 → 品质优先（挖矿时自动升级到背包最高品质的镐）
 *   - 大量挖掘 → 耐久优先（priority to 高耐久工具，避免频繁更换）
 * 需要新增方块偏好时在此追加一条即可；策略本身在 ToolScorer 的
 * createDefaultScorers 注册。
 */
export const PREFERENCE_TABLE: readonly PreferenceRule[] = [
  {
    name: "grass-silk",
    match: (id) => id === "minecraft:grass_block" || id === "minecraft:podzol" || id === "minecraft:mycelium",
    strategy: "silk",
  },
  {
    name: "leaves-silk",
    match: (id) => id.endsWith("_leaves"),
    strategy: "silk",
  },
  // {
  //   name: "ore-quality",
  //   match: (id) => id.includes("_ore") || id === "minecraft:netherite_block",
  //   strategy: "quality",
  // },
  // {
  //   name: "durability-first",
  //   match: (id) => id === "minecraft:stone" || id === "minecraft:deepslate",
  //   strategy: "durability",
  // },
];

/**
 * 查方块偏好：首个命中的规则转为 StrategyPref（无命中返回 undefined → 用默认策略）。
 * @param typeId 方块 typeId
 */
export function lookupMineStrategy(typeId: string): StrategyPref | undefined {
  const rule = PREFERENCE_TABLE.find((r) => r.match(typeId));
  if (rule === undefined) return undefined;
  return rule.fallbackChain === undefined
    ? { strategy: rule.strategy }
    : { strategy: rule.strategy, fallbackChain: rule.fallbackChain };
}
