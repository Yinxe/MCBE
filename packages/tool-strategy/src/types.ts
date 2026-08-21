// ─── 领域类型（纯数据，零依赖） ────────────────────────
// 工具选择引擎的两层模型：
//   决策树（ToolTree）——编排：方块分发 + 策略叶子组合（可插拔）
//   档位策略（ToolStrategy）——叶子：跨档手排优先级 + 档内 sortBy 维度链
// 全部类型零 @minecraft、零运行时依赖，可被 node 测试直接引用。

/** 工具/武器角色 */
export type ToolRole =
  | "pickaxe"
  | "axe"
  | "shovel"
  | "hoe"
  | "shears"
  | "sword"
  | "trident"
  | "bow"
  | "crossbow"
  | "mace";

/** 附魔键（候选特征与偏好共用；含耐久附魔 unbreaking / 经验修补 mending） */
export type EnchantKey = "silk" | "fortune" | "efficiency" | "smite" | "sharpness" | "unbreaking" | "mending";

/** 工具候选对象（定义 ID/品阶/附魔；决策输出与池内同构） */
export interface ToolCandidate {
  /** 所在槽位（换入目标） */
  slot: number;
  /** 物品 ID（minecraft:xxx） */
  typeId: string;
  /** 工具/武器角色 */
  role: ToolRole;
  /** 品阶（1 木 ~ 6 下界合金；剪刀 0） */
  tier: number;
  /** 剩余耐久（绝对） */
  durability: number;
  /** 最大耐久 */
  maxDurability: number;
  /** 剩余耐久占比 0..1 */
  durabilityRatio: number;
  /** 附魔类型+等级组合（含耐久附魔 unbreaking 等） */
  enchants: Readonly<Partial<Record<EnchantKey, number>>>;
  /** 当前主手伪候选（select 决策"保持/换入"用） */
  isCurrent?: boolean;
}

/** 附魔要求：类型 + 等级区间（minLevel 缺省 1；恰好 = min==max） */
export interface EnchantSpec {
  type: EnchantKey;
  minLevel?: number;
  maxLevel?: number;
}

/** 单个档位：角色 × 品阶区间 × 附魔硬门槛（多条 require = AND） */
export interface ToolWant {
  /** 期望角色；缺省或 "*" = 任意 */
  role?: ToolRole | "*";
  /** 品阶下限 */
  minTier?: number;
  /** 品阶上限（恰好铁质 = minTier 3 + maxTier 3） */
  maxTier?: number;
  /** 硬门槛附魔（全部满足才入池） */
  require?: readonly EnchantSpec[];
}

/** 档内排序维度（逐维降序比较；链长不限，缺省品阶优先） */
export type SortDim =
  | { dim: "tier" } // 品阶
  | { dim: "durability" } // 剩余耐久占比
  | { dim: "enchant"; type: EnchantKey } // 指定附魔等级
  | { dim: "enchant-count"; types: readonly EnchantKey[] } // 期待附魔命中多少个
  | { dim: "enchant-sum"; types: readonly EnchantKey[] }; // 期待附魔等级和

/** 工具策略（叶子：档位手排 + 档内排序 + 拒绝；预定义/自定义同构） */
export interface ToolStrategy {
  name: string;
  /** 档位列表（下标 = 用户手排优先级：档1 > 档2 > 档3） */
  want: readonly ToolWant[];
  /** 档内排序维度链（缺省 [{dim:"tier"}] 品阶越高越优先） */
  sortBy?: readonly SortDim[];
  /** 拒绝角色（如挖矿拒斧）；带任一的候选不入池 */
  banRoles?: readonly ToolRole[];
  /** 拒绝附魔（带任一的候选不入池，一票否决） */
  banEnchants?: readonly EnchantKey[];
}

/** 决策结果：保持 / 换入最优工具 */
export type ToolDecision =
  | { action: "keep"; reason: string }
  | { action: "swap"; tool: ToolCandidate; reason: string };

/**
 * 决策树节点（Selector 语义：顺序求值，首个出决策者生效；全部无决策 → 保持）。
 *   by-block    方块分支：match 命中才进入子节点（规则分发）
 *   by-strategy 策略叶子：背包无该策略候选 → 继续下一个节点；有 → 出保持/换入决策
 *   branch      顺序子分支（可嵌套组合）
 *   keep        显式保持（如"主手是钻石 → 保持"分支的落点）
 */
export type ToolTreeNode =
  | { type: "by-block"; match: (typeId: string) => boolean; node: ToolTreeNode }
  | { type: "by-strategy"; strategy: ToolStrategy | string } // string = 预定义策略名
  | { type: "branch"; nodes: readonly ToolTreeNode[] }
  | { type: "keep" };

/** 工具选择决策树（可插拔单元：一个任务/场景一棵，如 woodcut / mining） */
export interface ToolTree {
  name: string;
  nodes: readonly ToolTreeNode[];
}

/** select 顶层入口配置 */
export interface ToolSelectorConfig {
  /** 注入的决策树（可插拔：任务切换 = 换树） */
  tree: ToolTree;
  /** 主手命中当前策略时：false=保持（默认，省耐久）/ true=重新选最优（工作马） */
  reselectIfCurrent?: boolean;
}
