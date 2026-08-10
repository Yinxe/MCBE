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

/** 附魔键（1 级偏好维度）：对应 RankableCandidate 上的附魔字段 */
export type EnchantKey = "silk" | "fortune" | "efficiency" | "smite" | "sharpness";

/** 工具角色键（2 级偏好维度）：“*”= 任意角色 */
export type ToolKey = ToolCategory | WeaponClass | "*";

/**
 * 两级偏好策略（附魔 1 级优先 + 工具 2 级优先）——表达"面对某个 方块/实体，
 * 我希望用带什么附魔、什么类别的工具"的唯一入口。正好对应需求模型
 * `f(typeId) -> { 候选工具列表(=toolChain), 附魔推荐(=enchantChain) }`：越靠前越推荐。
 *
 * 语义：先按“附魔元组（enchantChain 逐键等级，首位优先）”字典序降序，再按
 * “工具角色在 toolChain 中的位置（越靠前越优先，'*' 兜底任意，未列按链尾）”，
 * 最后品质/耐久占比。横向 fallback 仍走 ToolSelector 双层：strict 且无候选命中
 * 任一附魔 → 本策略表达不了 → 交给预置默认策略（挖掘 frugal / 武器 weapon）。
 */
export interface PreferenceSpec {
  /** 规则名（日志/调试用） */
  readonly name: string;
  /** 附魔键链（1 级优先）：越靠前越优先；同键内等级越高越优先；空 = 无附魔偏好 */
  readonly enchantChain: readonly EnchantKey[];
  /** 工具角色链（2 级优先）：越靠前越优先；“*”兜底任意角色；未列角色按链尾 */
  readonly toolChain: readonly ToolKey[];
  /** strict：附魔链非空且无候选命中任一附魔 → 本策略表达不了 → 交给 fallback（如树叶无带精准刀具） */
  readonly strict?: boolean;
  /** 排除的工具角色（如农作物时运优先时排除时运锹），命中的候选不入池 */
  readonly exclude?: readonly ToolKey[];
  /** crossEnchant：候选池跨类别——命中任一附魔的任意工具即可入池（如树叶/玻璃的任意精准采集工具） */
  readonly crossEnchant?: boolean;
  /** 工具/附魔都打平后的最终 tie-break：tier（品质优先）/ durability（耐久占比优先）；默认 tier */
  readonly tieBreak?: "tier" | "durability";
  /** 本策略表达不了时的兜底策略名；缺省由决策域决定（挖掘 frugal / 武器 weapon） */
  fallback?: string;
}

/** 决策偏好：命名策略（注册表查，如 "frugal"）或两级偏好规格 */
export type RankPreference = string | PreferenceSpec;
