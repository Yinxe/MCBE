// ─── 砍树模式枚举（core 层） ───────────────────────────
// 纯逻辑：砍树模式枚举（原木模式/收集模式）+ 材质品阶表。
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
//
// 用户规格（2026-08-18）：
//   - 模式枚举：logs=原木模式（主要砍圆木并收集；树叶/障碍阻碍挖圆木则破除）；
//               collect=收集模式（完整破除整棵树：全部圆木 + 全部树叶）
//
// ⚠️ 工具策略已迁移 @yinxe/tool-strategy 引擎（rules/items/ToolStrategyTrees：
//   原木→效率斧 / 树叶→精准锄>剪刀>任意精准>任意工具，档位手排 + 耐久保护）。
//   旧加权评分实现（scoreAxe/scoreLeavesTool/pickBestTool）已退役删除。

/** 砍树模式（原木模式 | 收集模式） */
export type ChopMode = "logs" | "collect";

/** 砍树模式中文名（UI/通知用） */
export const CHOP_MODE_LABEL: Record<ChopMode, string> = {
  logs: "原木模式",
  collect: "收集模式",
};

/** 目标方块类别（工具策略选择依据） */
export type ChopTargetKind = "log" | "leaf";

/** 砍树模式规范化（用户规格枚举：原木模式 logs / 收集模式 collect）：
 *  非法/缺省值回退 fallback（缺省 logs）。命令解析/能力记忆统一走此入口，
 *  枚举只此一处定义，避免各处手抄漏同步。 */
export function normalizeChopMode(value: unknown, fallback: ChopMode = "logs"): ChopMode {
  if (value === "logs") return "logs";
  if (value === "collect") return "collect";
  return fallback;
}

/** 工具材质 → 品阶分（品阶优先：梯度远大于附魔分）；
 *  key = typeId 中 `minecraft:<key>_` 的前缀（wooden/golden 全名） */
export const MATERIAL_TIER: Record<string, number> = {
  wooden: 1,
  stone: 2,
  iron: 3,
  golden: 4,
  diamond: 5,
  netherite: 6,
};

/** 未识别材质的分值（低于木制——兜底） */
export const UNKNOWN_TIER = 0;

/**
 * 工具材质档次（按 typeId 前缀解析："minecraft:<material>_<tool>"）。
 * shears 无材质 → 0（shears 由类别策略单独打分）。
 * 品阶排序（可调）：wood=1 < stone=2 < iron=3 < gold=4 < diamond=5 < netherite=6。
 */
export function materialTier(typeId: string): number {
  for (const [mat, tier] of Object.entries(MATERIAL_TIER)) {
    if (typeId.startsWith(`minecraft:${mat}_`)) return tier;
  }
  return UNKNOWN_TIER;
}

// ─── 工具条目（背包快照：容器无关，纯数据） ─────────────

/** 背包里的工具条目（mc 层从容器快照构造；core 只做数据决策） */
