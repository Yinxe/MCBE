// ─── 方块偏好表（自定义策略的扩展入口，纯数据，零 @minecraft 依赖） ──
// 为指定方块覆盖默认的"省耐久不择优"选择：这里是表达
//   "面对农作物，我偏爱带时运的锄（不要锹）/ 面对树叶，我偏爱精准锄>剪>任意"
// 这类偏好的唯一入口。
// 每行产出 PreferenceSpec（两级偏好：附魔 1 级优先 + 工具 2 级优先），由
// ToolScorer.preferenceScorer 排序；strict 表达不了（如无带精准工具）→ 横向
// fallback 到默认策略（frugal）。crossEnchant 表达"跨类别附魔池"（任意精准/时运工具）。
// 新增偏好 = 追加一行；无需改分类/执行代码。

import { type PreferenceSpec } from "./types";

/** 方块偏好规则：match 命中 typeId → 按该两级偏好决策 */
export interface PreferenceRule {
  readonly name: string;
  readonly match: (typeId: string) => boolean;
  readonly pref: PreferenceSpec;
}

/**
 * 偏好规则注册表（按数组顺序，首个命中者胜出），内侧已启用：
 *   - 农作物（小麦/胡萝卜/马铃薯/甜菜根）→ 时运优先（锄>任意），排除时运锹；无时运 → 默认
 *   - 草方块/灰化土/菌丝 → 精准优先（锹>任意），完整产出方块本体
 *   - 树叶 → 精准优先（锄>剪>任意精准工具，跨类别）
 *   - 玻璃/冰/萤石/海晶灯 → 精准优先（镐>任意），完整产出方块本体
 * 需求模型即 f(typeId) -> {候选工具列表=toolChain, 附魔推荐=enchantChain}，越靠前越推荐。
 * 示例（默认注释，展示"如何新增偏好"）：
 *   - 矿石 → 品质优先（挖矿自动升级背包最高品质的镐）
 *   - 大量挖掘石头 → 耐久优先（避免频繁更换）
 * 需要新增方块偏好时在此追加一行即可；策略由 preferenceScorer 组合，无需注册新策略。
 */
export const PREFERENCE_TABLE: readonly PreferenceRule[] = [
  {
    name: "crop-fortune",
    match: (id) =>
      id === "minecraft:wheat" ||
      id === "minecraft:carrots" ||
      id === "minecraft:potatoes" ||
      id === "minecraft:beetroots",
    pref: {
      name: "crop-fortune",
      enchantChain: ["fortune"], // 附魔 1 级：时运越高越优先
      toolChain: ["hoe", "*"], //     工具 2 级：锦上添花，锄>任意
      exclude: ["shovel"], //          时运锹对收成无效 → 排除
      strict: true, //                 无时运工具 → 回落默认（用锄即可）
      crossEnchant: true, //           跨类别：任意非锹的时运工具都能收成加分
    },
  },
  {
    name: "grass-silk",
    match: (id) => id === "minecraft:grass_block" || id === "minecraft:podzol" || id === "minecraft:mycelium",
    pref: {
      name: "grass-silk",
      enchantChain: ["silk"],
      toolChain: ["shovel", "*"],
      strict: true,
    },
  },
  {
    name: "leaves-silk",
    match: (id) => id.endsWith("_leaves"),
    pref: {
      name: "leaves-silk",
      enchantChain: ["silk"], //      精准优先
      toolChain: ["hoe", "shears", "*"], // 工具 2 级：锄>剪>任意精准工具
      strict: true, //             无带精准工具 → 默认（剪刀）
      crossEnchant: true, //        任意精准工具都能完整产出树叶
    },
  },
  {
    name: "glass-silk",
    match: (id) => id.includes("glass") || id.includes("ice") || id.includes("glowstone") || id.includes("sea_lantern"),
    pref: {
      name: "glass-silk",
      enchantChain: ["silk"], //     精准优先
      toolChain: ["pickaxe", "*"], // 工具 2 级：镐>任意精准工具
      strict: true,
    },
  },
  // {
  //   name: "ore-quality",
  //   match: (id) => id.includes("_ore") || id === "minecraft:netherite_block",
  //   pref: {
  //     name: "ore-quality",
  //     enchantChain: [],        // 无附魔偏好
  //     toolChain: ["pickaxe"],  // 只收镐；同镐内默认按品质优先
  //   },
  // },
  // {
  //   name: "durability-first",
  //   match: (id) => id === "minecraft:stone" || id === "minecraft:deepslate",
  //   pref: {
  //     name: "durability-first",
  //     enchantChain: [],
  //     toolChain: ["pickaxe", "shovel"],
  //     tieBreak: "durability",   // 打平后按耐久占比（大量挖掘少换工具）
  //   },
  // },
];

/**
 * 查方块偏好：首个命中的规则返回其两级偏好；无命中返回 undefined（走默认策略）。
 * @param typeId 方块 typeId
 */
export function lookupMineStrategy(typeId: string): PreferenceSpec | undefined {
  const rule = PREFERENCE_TABLE.find((r) => r.match(typeId));
  return rule?.pref;
}
