// ─── 假人工具策略（core 层） ─────────────────────────
// **@yinxe/tool-strategy 可插拔引擎**（用户拍板：决策树编排 + 档位策略叶子，
// 纯逻辑零 @minecraft，auto-refill 将来可替换复用）：
//   - WOODCUT_TREE：砍树决策树——原木→效率斧 / 树叶→精准锄>剪刀>任意精准>
//     任意工具；其他方块无节点 → 不切换（保持主手）
//   - decideTool：封装引擎 select（保持/换入最优；reselectIfCurrent 决定
//     主手命中策略时保持 or 重选，砍树工作马传 true）
//   - 耐久保护：isUrgent + urgentReplacement（同 role、更耐久、绝不降级，
//     对齐 auto-refill checkDurability 语义）
// 联动方式：workspace 依赖 "@yinxe/tool-strategy"（构建期 esbuild 打包进假人
// bundle，运行时无需安装；纯 TS 无 @minecraft 无顶层副作用）。测试构建经
// ts-node 解析 workspace TS 源码（test:core --require ts-node/register）。

import {
  select,
  type ToolCandidate,
  type ToolDecision,
  type ToolStrategy,
  type ToolTree,
  type ToolTreeNode,
} from "@yinxe/tool-strategy/src/index";

// ─── 常量（对齐 auto-refill Settings 默认值） ───────────

/** 耐久保护占比阈值（0.05=5%，auto-refill durabilityThreshold 默认） */
export const URGENT_THRESHOLD = 0.05;
/** 耐久保护绝对下限（剩余耐久低于该值不论占比都视为紧急，auto-refill durabilityFloor 默认） */
export const ABS_DURABILITY_FLOOR = 16;

// ─── 原子策略（可单独使用，也可组合进模式树） ──────────

/** 木头策略：效率斧优先（档内效率附魔等级 → 品阶） */
export const WOODCUT_LOG_STRATEGY: ToolStrategy = {
  name: "woodcut-log",
  want: [{ role: "axe" }],
  sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
};

/** 树叶策略：精准锄 > 剪刀 > 任意精准工具 > 任意工具（档位手排） */
export const WOODCUT_LEAF_STRATEGY: ToolStrategy = {
  name: "woodcut-leaf",
  want: [
    { role: "hoe", require: [{ type: "silk" }] },
    { role: "shears" },
    { require: [{ type: "silk" }] },
    {},
  ],
  sortBy: [{ dim: "enchant", type: "silk" }, { dim: "tier" }],
};

// ─── 模式树（原子策略组合，可插拔） ─────────────────────

/** 砍树模式：只砍树 / 只要树叶 / 混合 */
export type WoodcutMode = "logs" | "leaves" | "mixed";

const isLogId = (typeId: string): boolean => typeId.endsWith("_log");
const isLeafId = (typeId: string): boolean => typeId.endsWith("_leaves");

/** 木头策略节点（原木分发） */
const LOG_NODE: ToolTreeNode = {
  type: "by-block",
  match: isLogId,
  node: { type: "by-strategy", strategy: WOODCUT_LOG_STRATEGY },
};

/** 树叶策略节点（树叶分发） */
const LEAF_NODE: ToolTreeNode = {
  type: "by-block",
  match: isLeafId,
  node: { type: "by-strategy", strategy: WOODCUT_LEAF_STRATEGY },
};

/**
 * 砍树模式决策树（原子策略组合）：
 *   logs   → 只挂木头策略：清障破叶也用主手效率斧，**不切精准工具**
 *   leaves → 只挂树叶策略：不动树干，只采树叶
 *   mixed  → 两策略组合：挖到原木切斧头、挖到树叶切精准（用户规格）
 * 其他方块无节点命中 → 引擎返回 keep（不切换）。
 */
export const WOODCUT_TREES: Record<WoodcutMode, ToolTree> = {
  logs: { name: "woodcut-logs", nodes: [LOG_NODE] },
  leaves: { name: "woodcut-leaves", nodes: [LEAF_NODE] },
  mixed: { name: "woodcut-mixed", nodes: [LOG_NODE, LEAF_NODE] },
};

/** 兼容导出：默认混合模式树 */
export const WOODCUT_TREE: ToolTree = WOODCUT_TREES.mixed;

// ─── 决策（引擎 select 封装） ──────────────────────────

/**
 * 用 @yinxe/tool-strategy 引擎出"保持/换入"决策（模式树组合原子策略）。
 * **默认 reselect=true（工作马语义，用户拍板）：主手命中策略但非池内最优
 * → 换入最优**——如主手精准斧挖树叶时背包有精准锄 → 换精准锄（斧挖树叶
 * 效率低）；主手已是最优 → 保持。显式传 false 则"主手命中即保持"（省耐久）。
 *
 * @param pool 背包候选池（mc 层 profile；不含主手槽）
 * @param blockTypeId 方块 typeId（决定走树中哪个策略叶子）
 * @param current 当前主手候选（undefined = 空手/非工具）
 * @param reselectIfCurrent 主手命中策略时：true=重选最优（默认）/ false=保持
 * @param mode 砍树模式：logs（只砍树）/ leaves（只采树叶）/ mixed（组合）
 */
export function decideTool(
  pool: readonly ToolCandidate[],
  blockTypeId: string,
  current?: ToolCandidate,
  reselectIfCurrent = true,
  mode: WoodcutMode = "mixed"
): ToolDecision {
  return select(blockTypeId, current, pool, { tree: WOODCUT_TREES[mode], reselectIfCurrent });
}

// ─── 耐久保护（同 role 更耐久替换，绝不降级） ──────────

/** 工具是否"紧急"（剩余耐久占比低于阈值或低于绝对下限） */
export function isUrgent(
  c: ToolCandidate,
  threshold: number,
  absFloor: number = ABS_DURABILITY_FLOOR
): boolean {
  return c.durabilityRatio < threshold || c.durability < absFloor;
}

/**
 * 从同 role 候选里挑替换对象（耐久保护，纯逻辑）。
 * 规则：品质不降级（tier ≥ 旧）、严格更耐久（剩余 > 旧）、占比达标 → 才入选；
 * 排序：同 typeId → 同精准属性 → 品阶 → 耐久（旧带精准则优先带精准的同款）。
 * @param old       当前旧工具（入池但会被筛掉）
 * @param candidates 同 role 的候选池
 * @param threshold 替换对象的最低占比
 * @returns 最优替换对象；无合格候选返回 null（保持不动，绝不降级）
 */
export function urgentReplacement(
  old: ToolCandidate,
  candidates: readonly ToolCandidate[],
  threshold: number
): ToolCandidate | null {
  const valid = candidates
    .filter(
      (c) =>
        c.slot !== old.slot &&
        c.role === old.role &&
        c.tier >= old.tier && // 绝不降级：同/更高品质的同类才可替换
        c.durability > old.durability &&
        c.durabilityRatio >= threshold
    )
    .sort((a, b) => {
      const typeDiff = (a.typeId === old.typeId ? 0 : 1) - (b.typeId === old.typeId ? 0 : 1);
      if (typeDiff !== 0) return typeDiff;
      // 旧工具带精准 → 优先带精准的同款（避免降级精准属性）
      const oldSilk = (old.enchants.silk ?? 0) > 0;
      const silkSameA = ((a.enchants.silk ?? 0) > 0) === oldSilk ? 0 : 1;
      const silkSameB = ((b.enchants.silk ?? 0) > 0) === oldSilk ? 0 : 1;
      if (silkSameA !== silkSameB) return silkSameA - silkSameB;
      return b.tier - a.tier || b.durability - a.durability;
    });
  return valid[0] ?? null;
}
