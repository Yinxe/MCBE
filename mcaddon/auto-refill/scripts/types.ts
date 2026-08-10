// ─── 领域类型 ──────────────────────────────────────────
// 共享的类型定义：工具类别 / 工具核对需求（含优选目标优先级）/ 候选工具评级。
// 仅含纯类型（无运行时依赖），供各模块 import。

/** 挖掘工具类别 */
export type ToolCategory = "pickaxe" | "axe" | "shovel" | "hoe" | "shears";

/** 单个工具目标：某类别（可含最低品质 / 精准采集要求） */
export interface ToolTarget {
  category: ToolCategory;
  /** 最低工具品质；undefined 不限 */
  minTier?: number;
  /** 必须带精准采集附魔 */
  silk?: boolean;
}

/** 工具核对需求：按优先级排列的工具目标列表 + 识别来源 */
export interface ToolRequirement {
  /** 优选目标：主手命中任一即视为正确；需换入时按顺序取第一个有货且达标者 */
  targets: readonly ToolTarget[];
  /** 识别来源，日志用：`tag:xxx` / `keyword` / `custom:xxx` */
  path: string;
}

/** 一个候选工具的评级结果 */
export interface ToolCandidate {
  slot: number;
  tier: number;
  durability: number;
}