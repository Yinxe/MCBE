// ─── 砍树模式与工具策略（core 层） ─────────────────────
// 纯逻辑：砍树模式枚举（原木模式/收集模式）+ 工具评分与选工具。
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
//
// 用户规格（2026-08-18）：
//   - 模式枚举：logs=原木模式（主要砍圆木并收集；树叶/障碍阻碍挖圆木则破除）；
//               collect=收集模式（完整破除整棵树：全部圆木 + 全部树叶）
//   - 圆木模式工具策略：**只用斧头策略**——品阶优先，效率>耐久>精准>时运
//   - 收集模式树叶策略：**精准锄头 > 剪刀 > 任意精准工具**；即使正在使用精准
//     斧头，若背包有剪刀或精准锄头，仍**强制应用**树叶策略（全背包扫描取优）
//   - 圆木/收集共用的圆木工具策略仍是斧头策略（品阶优先/效率>耐久>精准>时运）
//
// 附魔 id 对齐全仓编码（EnchantZh）：efficiency=效率 / unbreaking=耐久 /
// silk_touch=精准采集 / fortune=时运。

/** 砍树模式（原木模式 | 收集模式） */
export type ChopMode = "logs" | "collect";

/** 砍树模式中文名（UI/通知用） */
export const CHOP_MODE_LABEL: Record<ChopMode, string> = {
  logs: "原木模式",
  collect: "收集模式",
};

/** 目标方块类别（工具策略选择依据） */
export type ChopTargetKind = "log" | "leaf";

/** 工具类别（策略决策输出；shears/hoe 只服务树叶，axe 服务圆木与障碍） */
export type ToolCategory = "axe" | "hoe" | "shears";

// ─── 品阶（材质等级） ─────────────────────────────────

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
export interface ToolItem {
  /** 槽位 */
  slot: number;
  /** 物品 typeId（如 minecraft:diamond_axe / minecraft:shears） */
  typeId: string;
  /** 附魔 {id, level} 列表（id 对齐 EnchantZh：efficiency/unbreaking/silk_touch/fortune） */
  enchantments: { id: string; level: number }[];
  /** 是否为所选工具类别（axe/hoe/shears） */
  category: ToolCategory;
}

/** 附魔等级读取（未附魔返回 0） */
export function enchantLevel(item: ToolItem, id: string): number {
  const found = item.enchantments.find((e) => e.id === id);
  return found?.level ?? 0;
}

// ─── 附魔权重（用户规格：效率>耐久>精准>时运） ─────────

export const ENCHANT_WEIGHTS = {
  efficiency: 100,
  unbreaking: 30,
  silk_touch: 10,
  fortune: 3,
} as const;

/** 品阶权重（品阶优先：远大于附魔总分） */
export const TIER_WEIGHT = 1000;

/**
 * 斧头策略评分（用户规格：品阶优先 / 效率>耐久>精准>时运）。
 * score = tier×1000 + efficiency×100 + unbreaking×30 + silk_touch×10 + fortune×3
 */
export function scoreAxe(item: ToolItem): number {
  if (item.category !== "axe") return -1; // 非斧头不参与斧头策略
  return (
    materialTier(item.typeId) * TIER_WEIGHT +
    enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency +
    enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking +
    enchantLevel(item, "silk_touch") * ENCHANT_WEIGHTS.silk_touch +
    enchantLevel(item, "fortune") * ENCHANT_WEIGHTS.fortune
  );
}

/**
 * 树叶策略评分（用户规格：精准锄头 > 剪刀 > 任意精准工具）。
 *   - 精准锄头（silk_touch 的 hoe）：最高档（3000）
 *   - shears（剪刀）：次高（2000）
 *   - 任意带精准的工具：第三档（1000，品阶小权重——即使 netherite 精准斧
 *     也低于剪刀，保证"强制应用树叶策略"的优先级成立）
 *   - 其余工具兜底（无精准/剪刀时仍可破树叶）
 */
export function scoreLeavesTool(item: ToolItem): number {
  const silkTouch = enchantLevel(item, "silk_touch") > 0;
  if (item.category === "hoe" && silkTouch) return 3000 + materialTier(item.typeId) * 100;
  if (item.category === "shears") return 2000 + enchantLevel(item, "unbreaking") * ENCHANT_WEIGHTS.unbreaking;
  if (silkTouch) return 1000 + materialTier(item.typeId) * 100 + enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency;
  return materialTier(item.typeId) * 100 + enchantLevel(item, "efficiency") * ENCHANT_WEIGHTS.efficiency;
}

// ─── 选工具（纯函数） ─────────────────────────────────

/**
 * 选择破坏某类方块应使用的最优工具（返回槽位号；无可选返回 undefined）。
 *
 * 策略映射（用户规格）：
 *   - 圆木（任何模式）→ 斧头策略
 *   - 树叶 + 原木模式 → 斧头策略（用户规格：原木模式只使用斧头策略）
 *   - 树叶 + 收集模式 → 树叶策略（精准锄 > 剪刀 > 任意精准工具，强制应用）
 *
 * @param kind      目标方块类别
 * @param mode      当前砍树模式
 * @param items     背包快照（含全部工具条目，mc 层从全背包构造——强制策略
 *                  即靠"全背包扫描取最优"实现：即使主手是精准斧头，只要背包
 *                  有剪刀/精准锄头，树叶目标仍会选到它）
 * @returns 最优工具槽位（无 → undefined）
 */
export function pickBestTool(kind: ChopTargetKind, mode: ChopMode, items: readonly ToolItem[]): number | undefined {
  let best: ToolItem | undefined;
  let bestScore = -Infinity;
  const scorer = kind === "log" || mode === "logs" ? scoreAxe : scoreLeavesTool;
  for (const item of items) {
    const s = scorer(item);
    if (s < 0) continue; // scorer 对不匹配类别返回 -1（如斧头评分只看斧头）
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best?.slot;
}
