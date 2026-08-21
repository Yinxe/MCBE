// ─── @yinxe/tool-strategy 工具选择引擎（纯逻辑，零依赖） ──
// 可插拔工具选择：决策树（ToolTree 编排）+ 档位策略（ToolStrategy 叶子）。
// 用法：mc 层 profile 背包 → select(typeId, current, candidates, config) → 决策。
//
// 结构说明：引擎与预定义策略合并在本文件（types 独立）——包内**只有
// type-only import**（剥离后无运行时 import），因此任何加载方式都兼容：
// node v24 原生类型剥离（要求运行时 import 显式扩展名，type-only 无此问题）、
// ts-node、tsc、esbuild。消费方 import 子路径 "@yinxe/tool-strategy/src/index"。
//
// 两层优先级（全维度统一表达，无隐藏语义）：
//   跨档：want 档位列表（用户手排：每个档位 = 角色 × 品阶区间 × 附魔硬门槛），
//     下标即优先级——"效率5铁斧 > 精准钻石镐 > 效率3铁斧"这类任何单一维度
//     排序都表达不了的场景，档位是唯一解。
//   档内：sortBy 排序维度链（品阶/剩余耐久/附魔等级/附魔命中数/附魔等级和，
//     自由组合逐维降序），缺省品阶优先——品阶是品阶、耐久是耐久、附魔是附魔，
//     不设二选一 tieBreak。
// 附魔偏好四问的落点：有没有 = require（硬门槛）或 sortBy enchant（软排序）；
// 多少个 = enchant-count；等级怎么样 = enchant / enchant-sum；拒绝 = banEnchants。

import type {
  EnchantSpec,
  SortDim,
  ToolCandidate,
  ToolDecision,
  ToolRole,
  ToolSelectorConfig,
  ToolStrategy,
  ToolTree,
  ToolTreeNode,
  ToolWant,
} from "./types";

export type {
  EnchantKey,
  EnchantSpec,
  SortDim,
  ToolCandidate,
  ToolDecision,
  ToolRole,
  ToolSelectorConfig,
  ToolStrategy,
  ToolTree,
  ToolTreeNode,
  ToolWant,
} from "./types";

// ─── 档位匹配 ──────────────────────────────────────────

/** 候选附魔等级（无该附魔 = 0） */
function enchantLevel(c: ToolCandidate, key: string): number {
  return c.enchants[key as keyof typeof c.enchants] ?? 0;
}

/** 附魔要求是否满足（等级区间，minLevel 缺省 1） */
function matchEnchant(c: ToolCandidate, spec: EnchantSpec): boolean {
  const level = enchantLevel(c, spec.type);
  const min = spec.minLevel ?? 1;
  const max = spec.maxLevel ?? Number.POSITIVE_INFINITY;
  return level >= min && level <= max;
}

/** 候选是否命中单个档位（角色 × 品阶区间 × 附魔 AND） */
export function matchWant(c: ToolCandidate, want: ToolWant): boolean {
  if (want.role && want.role !== "*" && c.role !== want.role) return false;
  if (want.minTier !== undefined && c.tier < want.minTier) return false;
  if (want.maxTier !== undefined && c.tier > want.maxTier) return false;
  if (want.require) {
    for (const spec of want.require) {
      if (!matchEnchant(c, spec)) return false;
    }
  }
  return true;
}

/** 候选是否被策略接纳（命中任一档 + 非拒绝角色/附魔） */
export function acceptByStrategy(c: ToolCandidate, s: ToolStrategy): boolean {
  if (s.banRoles && s.banRoles.includes(c.role)) return false;
  if (s.banEnchants) {
    for (const k of s.banEnchants) {
      if (enchantLevel(c, k) > 0) return false;
    }
  }
  return s.want.some((w) => matchWant(c, w));
}

/** 候选命中的档位下标（首个命中；无命中 Infinity） */
function wantIndexOf(c: ToolCandidate, s: ToolStrategy): number {
  for (let i = 0; i < s.want.length; i++) {
    if (matchWant(c, s.want[i]!)) return i;
  }
  return Number.POSITIVE_INFINITY;
}

// ─── 档内排序（sortBy 维度链） ─────────────────────────

/** 单一排序维度的取值（全部越大越优，比较时降序） */
function dimValue(c: ToolCandidate, dim: SortDim): number {
  switch (dim.dim) {
    case "tier":
      return c.tier;
    case "durability":
      return c.durabilityRatio;
    case "enchant":
      return enchantLevel(c, dim.type);
    case "enchant-count":
      return dim.types.reduce((n, k) => n + (enchantLevel(c, k) > 0 ? 1 : 0), 0);
    case "enchant-sum":
      return dim.types.reduce((n, k) => n + enchantLevel(c, k), 0);
  }
}

/**
 * 按策略排序候选池（档位下标升序 → sortBy 维度链逐维降序）。
 * @param pool 已通过 acceptByStrategy 的候选池
 * @param s    档位策略
 */
export function rankByStrategy(pool: readonly ToolCandidate[], s: ToolStrategy): ToolCandidate[] {
  const sortBy = s.sortBy ?? [{ dim: "tier" }];
  return [...pool].sort((a, b) => {
    const gi = wantIndexOf(a, s) - wantIndexOf(b, s);
    if (gi !== 0) return gi;
    for (const dim of sortBy) {
      const d = dimValue(b, dim) - dimValue(a, dim);
      if (d !== 0) return d;
    }
    return 0;
  });
}

// ─── 决策树求值 ────────────────────────────────────────

/** 节点求值结果：出决策 / 无决策（继续下一个节点） */
type EvalResult = ToolDecision | undefined;

/** 解析策略叶子（字符串查预定义注册表；未注册 → undefined） */
function strategyOf(node: ToolTreeNode): ToolStrategy | undefined {
  if (node.type !== "by-strategy") return undefined;
  return typeof node.strategy === "string" ? STRATEGY_PRESETS[node.strategy] : node.strategy;
}

/**
 * 求值单个节点：
 *   keep          → 立即保持
 *   branch        → 顺序求值子节点，首个出决策者生效
 *   by-block      → match 命中才递归子节点，否则无决策
 *   by-strategy   → 背包无该策略候选 → 无决策（继续下一个节点）；
 *                   有 → 排序后决策：主手最优 → 保持；否则换入池首
 */
function evalNode(
  node: ToolTreeNode,
  typeId: string,
  pool: readonly ToolCandidate[],
  reselect: boolean
): EvalResult {
  switch (node.type) {
    case "keep":
      return { action: "keep", reason: "决策树显式保持" };
    case "branch": {
      for (const child of node.nodes) {
        const r = evalNode(child, typeId, pool, reselect);
        if (r) return r;
      }
      return undefined;
    }
    case "by-block": {
      if (!node.match(typeId)) return undefined;
      return evalNode(node.node, typeId, pool, reselect);
    }
    case "by-strategy": {
      const s = strategyOf(node);
      if (!s) return undefined; // 未注册的预定义名 → 跳过
      const pool2 = pool.filter((c) => acceptByStrategy(c, s));
      if (pool2.length === 0) return undefined; // 背包无候选 → 继续下一个节点
      const ranked = rankByStrategy(pool2, s);
      const top = ranked[0] as ToolCandidate;
      const current = pool.find((c) => c.isCurrent);
      // 主手保持开关（默认保持）：主手命中策略 → 不换
      if (!reselect && current && acceptByStrategy(current, s)) {
        return { action: "keep", reason: `主手已满足策略 ${s.name} → 保持` };
      }
      if (top.isCurrent) {
        return { action: "keep", reason: `主手已是 ${s.name} 最优 → 保持` };
      }
      return {
        action: "swap",
        tool: top,
        reason: `换入 ${s.name} 最优: ${top.typeId} slot ${top.slot}`,
      };
    }
  }
}

/**
 * 顶层入口：决策树 + 档位策略两段式决策。
 * @param typeId    被挖掘/处理的方块 typeId（只需字符串）
 * @param current   当前主手候选（undefined = 空手/非工具）
 * @param candidates 背包候选池（mc 层 profile 扫描；不含主手槽）
 * @param config    注入的决策树 + 主手保持开关
 * @returns 决策：keep（不换）或 swap（换入最优工具）；树全部无决策 → keep
 */
export function select(
  typeId: string,
  current: ToolCandidate | undefined,
  candidates: readonly ToolCandidate[],
  config: ToolSelectorConfig
): ToolDecision {
  const pool = current ? [...candidates, current] : [...candidates]; // 主手并入池参与排序/保持判定
  for (const node of config.tree.nodes) {
    const r = evalNode(node, typeId, pool, !!config.reselectIfCurrent);
    if (r) return r;
  }
  return { action: "keep", reason: `树 ${config.tree.name} 无节点命中 ${typeId} → 不切换` };
}

// ─── 预定义策略注册表（可 registerStrategy 追加自定义） ──
// 预定义 = 常用"档位 + 排序"组合的命名封装，树节点 by-strategy 里按名引用
// （如 { type: "by-strategy", strategy: "silk" }）；自定义 = registerStrategy
// 注册或直接在节点里传 ToolStrategy 对象（字段任意混合，插件式）。

const presets: Record<string, ToolStrategy> = {
  /** 品阶优先（缺省语义）：任意达标工具，档内品阶越高越优先 */
  tier: { name: "tier", want: [{}] },
  /** 耐久优先（工作马）：档内剩余耐久占比越高越优先 */
  durability: { name: "durability", want: [{}], sortBy: [{ dim: "durability" }] },
  /** 效率优先：档内效率附魔等级 → 品阶 */
  efficiency: {
    name: "efficiency",
    want: [{}],
    sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
  },
  /** 精准优先：带精准的工具优先（无精准回落任意工具），档内精准等级 → 品阶 */
  silk: {
    name: "silk",
    want: [{ require: [{ type: "silk" }] }, {}],
    sortBy: [{ dim: "enchant", type: "silk" }, { dim: "tier" }],
  },
  /** 时运优先：带时运的工具优先（无时运回落任意工具），档内时运等级 → 品阶 */
  fortune: {
    name: "fortune",
    want: [{ require: [{ type: "fortune" }] }, {}],
    sortBy: [{ dim: "enchant", type: "fortune" }, { dim: "tier" }],
  },
  /** 只用斧 */
  axe: { name: "axe", want: [{ role: "axe" }] },
  /** 只用镐 */
  pickaxe: { name: "pickaxe", want: [{ role: "pickaxe" }] },
  /** 只用锄 */
  hoe: { name: "hoe", want: [{ role: "hoe" }] },
  /** 只用剪刀 */
  shears: { name: "shears", want: [{ role: "shears" }] },
};

/** 预定义策略注册表（只读视图；按名引用） */
export const STRATEGY_PRESETS: Readonly<Record<string, ToolStrategy>> = presets;

/**
 * 注册/覆盖自定义策略（可插拔：追加预定义，树节点即可按名引用）。
 * @param def 自定义策略（name 与内置不冲突时直接生效）
 */
export function registerStrategy(def: ToolStrategy): void {
  presets[def.name] = def;
}
