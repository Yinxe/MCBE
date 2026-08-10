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

// ─── 评分选择引擎类型（RankableCandidate / RankContext / RankDecision）──────────
// 见 ToolScorer.ts：决策域把"候选特征向量 → 策略打分排序 → 保持/交换"建模为可
// 插拔线段。这些类型全部为零 @minecraft 依赖的纯数据，可被 node 单测构建引用。

/** 武器类别（与 ToolCategory 共同构成 candidate.role） */
export type WeaponClass = "sword" | "mace" | "trident" | "bow" | "crossbow";

/** 一个候选工具/武器的评分特征（纯数据） */
export interface RankableCandidate {
  /** 背包槽位 */
  slot: number;
  typeId: string;
  /** 所属角色：挖掘工具类别或武器类别（替换时按同 role 匹配） */
  role: ToolCategory | WeaponClass;
  /** 品质等级（0=shears，1木~6下界合金） */
  tier: number;
  /** 剩余耐久（绝对） */
  durability: number;
  /** 最大耐久（用于归一化占比） */
  maxDurability: number;
  /** 剩余耐久占比 0..1，跨工具可比 */
  durabilityRatio: number;
  /** 是否带精准采集 */
  silk: boolean;
  /** 效率附魔等级 */
  efficiency: number;
  /** 时运附魔等级 */
  fortune: number;
  /** 亡灵杀手附魔等级（武器域偏好用） */
  smite: number;
  /** 锋利附魔等级（武器域偏好用） */
  sharpness: number;
  /** 当前主手伪候选（用于"保持"决策，可与普通候选同池参与排序） */
  isCurrent?: boolean;
}

/** 策略决策上下文（纯数据） */
export interface RankContext {
  playerName: string;
  /** 挖掘域方块的 typeId；武器域为 undefined */
  blockTypeId?: string;
  /** 挖掘域识别结果（frugal/priority 策略据此按 targets 优先级分组） */
  blockRequirement?: ToolRequirement;
  /** 挖掘域 wantsSilk 标记（无类别但需精准采集才能产出本体的方块） */
  wantsSilk?: boolean;
  /** 武器域被攻击实体的 typeId（如 minecraft:zombie，供实体种类偏好查表） */
  entityTypeId?: string;
  /** 决策域：挖掘（mine）/ 武器（weapon） */
  domain: "mine" | "weapon";
}

/** 决策结果：保持 / 换成指定槽位（log 为给玩家看的中文文案） */
export type RankDecision = { action: "keep"; log: string } | { action: "swap"; slot: number; log: string };

/** 方块偏好：为指定方块选用的策略名 + 纵向 fallback 链（缺省落到默认策略） */
export interface StrategyPref {
  strategy: string;
  fallbackChain?: readonly string[];
}
