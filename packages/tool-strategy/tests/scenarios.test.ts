// ─── 复杂场景测试（真实任务编排 × 档位策略 × 决策树组合） ──
// 覆盖引擎在真实使用中的复杂交叉：多档位深度回落、角色/品阶/附魔
// 三维交叉、决策树嵌套与短路、主手复杂状态、耐久保护边界、特殊角色、
// 附魔区间精确匹配、预定义/自定义策略组合。

import { test } from "node:test";
import assert from "node:assert/strict";

import { registerStrategy, select, STRATEGY_PRESETS } from "../src/index";
import type { ToolCandidate, ToolSelectorConfig, ToolStrategy, ToolTree } from "../src/index";

/** 构造工具候选（默认满耐久铁斧；enchants 类型为附魔等级表） */
function tool(overrides: Partial<ToolCandidate> & { slot: number }): ToolCandidate {
  return {
    typeId: "minecraft:iron_axe",
    role: "axe",
    tier: 3,
    durability: 250,
    maxDurability: 250,
    durabilityRatio: 1,
    enchants: {},
    ...overrides,
  };
}

/** 单策略树（测试档位逻辑用） */
function cfg(strategy: ToolStrategy, reselectIfCurrent = false): ToolSelectorConfig {
  return {
    tree: { name: "test", nodes: [{ type: "by-strategy", strategy }] },
    reselectIfCurrent,
  };
}

/** 树配置 */
function treeCfg(tree: ToolTree, reselectIfCurrent = false): ToolSelectorConfig {
  return { tree, reselectIfCurrent };
}

function swapSlot(decision: ReturnType<typeof select>): number {
  assert.equal(decision.action, "swap");
  return decision.action === "swap" ? decision.tool.slot : -1;
}

// ─── 多档位深度回落（真实挖掘场景） ────────────────────

test("深回落：五档逐级跌落——时运3镐 > 精准镐 > 钻石镐 > 任意镐 > 任意工具", () => {
  const s: ToolStrategy = {
    name: "mining-deep",
    want: [
      { role: "pickaxe", require: [{ type: "fortune", minLevel: 3 }] }, // 档1
      { role: "pickaxe", require: [{ type: "silk" }] }, // 档2
      { role: "pickaxe", minTier: 5 }, // 档3
      { role: "pickaxe" }, // 档4
      {}, // 档5 任意
    ],
    sortBy: [{ dim: "enchant", type: "fortune" }, { dim: "tier" }],
  };
  const f3Pick = tool({ slot: 1, role: "pickaxe", tier: 4, enchants: { fortune: 3 } }); // 黄金时运3镐
  const silkPick = tool({ slot: 2, role: "pickaxe", tier: 3, enchants: { silk: 1 } }); // 铁精准镐
  const diamondPick = tool({ slot: 3, role: "pickaxe", tier: 5 }); // 钻石无附魔镐
  const ironPick = tool({ slot: 4, role: "pickaxe", tier: 3 }); // 铁镐
  const axe = tool({ slot: 5 }); // 斧
  // 全在 → 档1（时运3黄金镐——附魔优先于品阶）
  assert.equal(swapSlot(select("x", undefined, [diamondPick, f3Pick, silkPick, ironPick, axe], cfg(s))), 1);
  // 无时运3 → 档2（精准铁镐 > 钻石镐——档位优先级压过品阶）
  assert.equal(swapSlot(select("x", undefined, [diamondPick, silkPick, ironPick, axe], cfg(s))), 2);
  // 无精准 → 档3（钻石镐 > 铁镐）
  assert.equal(swapSlot(select("x", undefined, [diamondPick, ironPick, axe], cfg(s))), 3);
  // 无钻石 → 档4（铁镐）
  assert.equal(swapSlot(select("x", undefined, [ironPick, axe], cfg(s))), 4);
  // 只有斧 → 档5（任意工具兜底）
  assert.equal(swapSlot(select("x", undefined, [axe], cfg(s))), 5);
  // 空池 → 保持
  assert.equal(select("x", undefined, [], cfg(s)).action, "keep");
});

test("深回落：档内 sortBy 跨档生效——同档内附魔等级再分高下", () => {
  const s: ToolStrategy = {
    name: "tiered-enchant",
    want: [
      { require: [{ type: "fortune" }] }, // 档1 带时运
      { require: [{ type: "efficiency", minLevel: 4 }] }, // 档2 效率4+
    ],
    sortBy: [{ dim: "enchant", type: "fortune" }, { dim: "enchant", type: "efficiency" }, { dim: "tier" }],
  };
  const f3 = tool({ slot: 1, enchants: { fortune: 3 } });
  const f1e5 = tool({ slot: 2, enchants: { fortune: 1, efficiency: 5 } });
  const e5 = tool({ slot: 3, enchants: { efficiency: 5 } });
  // 同档（都带时运）内按时运等级：时运3 > 时运1
  assert.equal(swapSlot(select("x", undefined, [f1e5, f3], cfg(s))), 1);
  // 无时运 → 档2 效率4+：效率5 铁斧进、效率3 不进
  assert.equal(swapSlot(select("x", undefined, [e5], cfg(s))), 3);
  const e3 = tool({ slot: 4, enchants: { efficiency: 3 } });
  assert.equal(select("x", undefined, [e3], cfg(s)).action, "keep");
});

// ─── 角色/品阶/附魔三维交叉 ────────────────────────────

test("三维交叉：同角色档位按品阶区间细分——铁质效率5斧 > 钻石任意斧 > 下界合金斧", () => {
  const s: ToolStrategy = {
    name: "axe-tiers",
    want: [
      { role: "axe", minTier: 3, maxTier: 3, require: [{ type: "efficiency", minLevel: 5 }] }, // 铁效率5
      { role: "axe", minTier: 5, maxTier: 5 }, // 恰好钻石
      { role: "axe", minTier: 6 }, // 下界合金+
    ],
    sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
  };
  const e5Iron = tool({ slot: 1, tier: 3, enchants: { efficiency: 5 } });
  const diamond = tool({ slot: 2, tier: 5, enchants: { efficiency: 5 } }); // 钻石效率5——但档1限铁质
  const netherite = tool({ slot: 3, tier: 6 });
  const golden = tool({ slot: 4, tier: 4 }); // 黄金——不在任何档
  // 档1 只收铁质效率5（钻石效率5 虽效率同但品阶不在档1区间 → 档2）
  assert.equal(swapSlot(select("x", undefined, [diamond, e5Iron, netherite], cfg(s))), 1);
  // 无铁效率5 → 档2（钻石；黄金不进档）
  assert.equal(swapSlot(select("x", undefined, [diamond, golden, netherite], cfg(s))), 2);
  // 无钻石 → 档3（下界合金）
  assert.equal(swapSlot(select("x", undefined, [golden, netherite], cfg(s))), 3);
  // 只有黄金 → 无档命中 → 保持
  assert.equal(select("x", undefined, [golden], cfg(s)).action, "keep");
});

test("三维交叉：角色不同一票否决——镐档绝不收斧", () => {
  const s: ToolStrategy = {
    name: "role-strict",
    want: [
      { role: "pickaxe", require: [{ type: "fortune", minLevel: 3 }] },
      { role: "pickaxe" },
    ],
  };
  const f3Axe = tool({ slot: 1, enchants: { fortune: 3 } }); // 时运3 斧——不是镐
  const plainPick = tool({ slot: 2, role: "pickaxe" });
  // 档1 不收斧（角色不符）→ 档2 铁镐
  assert.equal(swapSlot(select("x", undefined, [f3Axe, plainPick], cfg(s))), 2);
  // 只有时运3斧 → 全档无命中 → 保持
  assert.equal(select("x", undefined, [f3Axe], cfg(s)).action, "keep");
});

// ─── 附魔区间精确匹配 ──────────────────────────────────

test("附魔区间：minLevel+maxLevel 双边界——时运 2~3 恰好收 2/3 不收 1/4", () => {
  const s: ToolStrategy = {
    name: "range",
    want: [{ require: [{ type: "fortune", minLevel: 2, maxLevel: 3 }] }],
  };
  const f1 = tool({ slot: 1, enchants: { fortune: 1 } });
  const f2 = tool({ slot: 2, enchants: { fortune: 2 } });
  const f3 = tool({ slot: 3, enchants: { fortune: 3 } });
  const f4 = tool({ slot: 4, enchants: { fortune: 4 } });
  assert.equal(swapSlot(select("x", undefined, [f1, f2, f3, f4], cfg(s))), 2); // 档内按 fortune 等级 → f3
  // 单独验证每个等级的入档性
  assert.equal(select("x", undefined, [f1], cfg(s)).action, "keep"); // 1 级太低
  assert.equal(swapSlot(select("x", undefined, [f2], cfg(s))), 2);
  assert.equal(swapSlot(select("x", undefined, [f3], cfg(s))), 3);
  assert.equal(select("x", undefined, [f4], cfg(s)).action, "keep"); // 4 级太高
});

test("附魔多条件 AND：精准+时运 双修镐 > 单精准镐（缺一不入高级档）", () => {
  const s: ToolStrategy = {
    name: "dual-enchant",
    want: [
      { role: "pickaxe", require: [{ type: "silk" }, { type: "fortune", minLevel: 3 }] }, // 档1 双修
      { role: "pickaxe", require: [{ type: "silk" }] }, // 档2 单精准
      { role: "pickaxe" }, // 档3 任意镐
    ],
    sortBy: [{ dim: "enchant", type: "fortune" }, { dim: "tier" }],
  };
  const both = tool({ slot: 1, role: "pickaxe", tier: 4, enchants: { silk: 1, fortune: 3 } });
  const silkOnly = tool({ slot: 2, role: "pickaxe", tier: 5, enchants: { silk: 1 } }); // 钻石精准——更高级但不满足双修
  const plain = tool({ slot: 3, role: "pickaxe" });
  // 双修进档1（哪怕黄金品阶 < 钻石）
  assert.equal(swapSlot(select("x", undefined, [silkOnly, both, plain], cfg(s))), 1);
  // 无双修 → 档2 单精准（钻石）
  assert.equal(swapSlot(select("x", undefined, [silkOnly, plain], cfg(s))), 2);
  // 无精准 → 档3 任意镐
  assert.equal(swapSlot(select("x", undefined, [plain], cfg(s))), 3);
});

test("附魔缺一不入池：效率5但无精准的斧 在'精准斧'策略下整体不入", () => {
  const s: ToolStrategy = {
    name: "silk-axe-only",
    want: [{ role: "axe", require: [{ type: "silk" }] }],
  };
  const e5 = tool({ slot: 1, enchants: { efficiency: 5 } }); // 效率5 无精准
  const silk = tool({ slot: 2, enchants: { silk: 1 } });
  // 效率5斧因无精准不入池 → 精准斧被选
  assert.equal(swapSlot(select("x", undefined, [e5, silk], cfg(s))), 2);
  // 只有效率5 → 保持
  assert.equal(select("x", undefined, [e5], cfg(s)).action, "keep");
});

// ─── 真实任务场景（决策树编排） ────────────────────────

/** 真实挖掘树：矿石→时运镐、石头→效率镐、其他→不切 */
const MINING_TREE: ToolTree = {
  name: "mining",
  nodes: [
    {
      type: "by-block",
      match: (id) => id.includes("_ore"),
      node: {
        type: "by-strategy",
        strategy: {
          name: "ore",
          want: [
            { role: "pickaxe", require: [{ type: "fortune", minLevel: 3 }] },
            { role: "pickaxe" },
          ],
          sortBy: [{ dim: "enchant", type: "fortune" }, { dim: "tier" }],
        },
      },
    },
    {
      type: "by-block",
      match: (id) => id === "minecraft:stone",
      node: {
        type: "by-strategy",
        strategy: {
          name: "stone",
          want: [{ role: "pickaxe" }],
          sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
        },
      },
    },
  ],
};

test("真实挖掘树：钻石矿石→时运3镐、石头→效率5镐、泥土→不切换", () => {
  const f3 = tool({ slot: 1, role: "pickaxe", enchants: { fortune: 3 } });
  const e5 = tool({ slot: 2, role: "pickaxe", enchants: { efficiency: 5 } });
  const plain = tool({ slot: 3, role: "pickaxe" });
  const cfgT = treeCfg(MINING_TREE);
  // 矿石：时运3 > 效率5 > 普通
  assert.equal(swapSlot(select("minecraft:diamond_ore", undefined, [e5, f3, plain], cfgT)), 1);
  assert.equal(swapSlot(select("minecraft:diamond_ore", undefined, [e5, plain], cfgT)), 2);
  // 石头：效率5 > 普通（时运镐也进石头档，但效率维度排序）
  assert.equal(swapSlot(select("minecraft:stone", undefined, [f3, e5], cfgT)), 2);
  // 泥土：无节点命中 → 保持
  assert.equal(select("minecraft:dirt", undefined, [f3, e5], cfgT).action, "keep");
});

/** 真实战斗树：非亡灵→锋利剑、亡灵→亡灵杀手剑 */
const COMBAT_TREE: ToolTree = {
  name: "combat",
  nodes: [
    {
      type: "by-block",
      match: (id) => id.includes("zombie") || id.includes("skeleton") || id.includes("wither"),
      node: {
        type: "by-strategy",
        strategy: {
          name: "undead",
          want: [{ role: "sword", require: [{ type: "smite", minLevel: 4 }] }, { role: "sword" }],
          sortBy: [{ dim: "enchant", type: "smite" }, { dim: "tier" }],
        },
      },
    },
    {
      type: "by-strategy",
      strategy: {
        name: "general",
        want: [{ role: "sword" }],
        sortBy: [{ dim: "enchant", type: "sharpness" }, { dim: "tier" }],
      },
    },
  ],
};

test("真实战斗树：打僵尸用亡灵杀手4剑 > 锋利5剑 > 普通剑；打猪用锋利剑", () => {
  const smite4 = tool({ slot: 1, role: "sword", enchants: { smite: 4 } });
  const sharp5 = tool({ slot: 2, role: "sword", enchants: { sharpness: 5 } });
  const plain = tool({ slot: 3, role: "sword" });
  const cfgT = treeCfg(COMBAT_TREE);
  // 僵尸：亡灵杀手4 > 锋利5（档位优先）
  assert.equal(swapSlot(select("minecraft:zombie", undefined, [sharp5, smite4, plain], cfgT)), 1);
  // 僵尸无亡灵杀手4 → 档2 任意剑（锋利5）
  assert.equal(swapSlot(select("minecraft:skeleton", undefined, [sharp5, plain], cfgT)), 2);
  // 猪：亡灵分支不命中 → 通用分支锋利5
  assert.equal(swapSlot(select("minecraft:pig", undefined, [sharp5, plain], cfgT)), 2);
  // 无剑 → 两分支都无候选 → 保持
  assert.equal(select("minecraft:pig", undefined, [tool({ slot: 9, role: "axe" })], cfgT).action, "keep");
});

test("战斗树：smite 等级档内细分——亡灵杀手5 > 亡灵杀手4 > 锋利6", () => {
  const s: ToolStrategy = {
    name: "smite-rank",
    want: [{ role: "sword", require: [{ type: "smite" }] }, { role: "sword" }],
    sortBy: [{ dim: "enchant", type: "smite" }, { dim: "enchant", type: "sharpness" }, { dim: "tier" }],
  };
  const smite5 = tool({ slot: 1, role: "sword", enchants: { smite: 5 } });
  const smite4sharp6 = tool({ slot: 2, role: "sword", enchants: { smite: 4, sharpness: 6 } });
  const sharp6 = tool({ slot: 3, role: "sword", enchants: { sharpness: 6 } });
  assert.equal(swapSlot(select("x", undefined, [sharp6, smite4sharp6, smite5], cfg(s))), 1);
  assert.equal(swapSlot(select("x", undefined, [sharp6, smite4sharp6], cfg(s))), 2);
  assert.equal(swapSlot(select("x", undefined, [sharp6], cfg(s))), 3);
});

// ─── 决策树嵌套与短路 ──────────────────────────────────

test("决策树短路：首个出决策节点生效，后续节点不再评估", () => {
  // 节点1 任意策略（总会出决策）；节点2 应有更优候选但不应被评估
  const tree: ToolTree = {
    name: "short-circuit",
    nodes: [
      { type: "by-strategy", strategy: { name: "first", want: [{ role: "axe" }] } },
      { type: "by-strategy", strategy: { name: "second", want: [{ role: "pickaxe", require: [{ type: "silk" }] }] } },
    ],
  };
  const axe = tool({ slot: 1 });
  const silkPick = tool({ slot: 2, role: "pickaxe", enchants: { silk: 1 } });
  // 节点1 有斧 → 立即换斧（即使节点2 有精准镐——引擎不比较跨节点"哪个更好"）
  assert.equal(swapSlot(select("x", undefined, [silkPick, axe], treeCfg(tree))), 1);
});

test("决策树短路：by-block 不命中继续、命中后内部无决策则继续下一个节点", () => {
  const tree: ToolTree = {
    name: "block-fallthrough",
    nodes: [
      {
        type: "by-block",
        match: (id) => id === "minecraft:oak_log",
        node: { type: "by-strategy", strategy: { name: "log", want: [{ role: "axe" }] } },
      },
      { type: "by-strategy", strategy: { name: "any", want: [{}] } },
    ],
  };
  const axe = tool({ slot: 1 });
  const pick = tool({ slot: 2, role: "pickaxe" });
  // oak_log：节点1 命中有斧 → 换斧
  assert.equal(swapSlot(select("minecraft:oak_log", undefined, [pick, axe], treeCfg(tree))), 1);
  // 石头：节点1 不命中 → 节点2 任意 → 品阶最高（默认 sortBy tier，斧铁3=镐铁3 → 稳定取第一个）
  const d = select("minecraft:stone", undefined, [axe, pick], treeCfg(tree));
  assert.equal(d.action, "swap");
  // oak_log 但无斧：节点1 无候选 → 落到节点2 任意 → 换镐
  assert.equal(swapSlot(select("minecraft:oak_log", undefined, [pick], treeCfg(tree))), 2);
});

test("决策树：branch 深层嵌套——外层 branch 内再嵌套 by-block+branch", () => {
  const tree: ToolTree = {
    name: "deep-branch",
    nodes: [
      {
        type: "branch",
        nodes: [
          {
            type: "by-block",
            match: (id) => id === "minecraft:stone",
            node: {
              type: "branch",
              nodes: [
                { type: "keep" }, // 石头 → 显式保持
                { type: "by-strategy", strategy: { name: "never", want: [{ role: "pickaxe" }] } },
              ],
            },
          },
          {
            type: "by-block",
            match: (id) => id === "minecraft:diamond_ore",
            node: {
              type: "branch",
              nodes: [
                { type: "by-strategy", strategy: { name: "ore", want: [{ role: "pickaxe", require: [{ type: "fortune" }] }] } },
                { type: "by-strategy", strategy: { name: "fallback", want: [{ role: "pickaxe" }] } },
              ],
            },
          },
        ],
      },
    ],
  };
  const f3 = tool({ slot: 1, role: "pickaxe", enchants: { fortune: 3 } });
  const plainPick = tool({ slot: 2, role: "pickaxe" });
  // 石头：内层 branch 第一个子节点 keep 短路
  assert.equal(select("minecraft:stone", undefined, [f3, plainPick], treeCfg(tree)).action, "keep");
  // 钻石矿石：时运3 → 换入
  assert.equal(swapSlot(select("minecraft:diamond_ore", undefined, [plainPick, f3], treeCfg(tree))), 1);
  // 钻石矿石无时运：第一个策略无候选 → 内层 branch 回落第二个 → 普通镐
  assert.equal(swapSlot(select("minecraft:diamond_ore", undefined, [plainPick], treeCfg(tree))), 2);
  // 泥土：外层 branch 两个 by-block 都不命中 → 树无决策 → 保持
  assert.equal(select("minecraft:dirt", undefined, [f3], treeCfg(tree)).action, "keep");
});

// ─── 主手复杂状态 ──────────────────────────────────────

test("主手：主手命中策略但非最优 + reselect=false → 保持（省耐久语义）", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 3 } });
  const better = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(select("x", hand, [better], cfg(s, false)).action, "keep");
});

test("主手：主手命中策略非最优 + reselect=true → 换入池内最优", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 3 } });
  const better = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("x", hand, [better], cfg(s, true))), 2);
});

test("主手：主手最优 + 池内有更差 → 保持（不换自己）", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const worse = tool({ slot: 2, enchants: { efficiency: 3 } });
  assert.equal(select("x", hand, [worse], cfg(s, true)).action, "keep");
});

test("主手：主手不命中策略（空手/非工具）→ 池有候选就换入", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "pickaxe" }] };
  const hand = tool({ slot: 0, isCurrent: true, role: "axe" }); // 主手是斧，策略要镐
  const pick = tool({ slot: 3, role: "pickaxe" });
  assert.equal(swapSlot(select("x", hand, [pick], cfg(s, true))), 3);
  assert.equal(swapSlot(select("x", hand, [pick], cfg(s, false))), 3); // 主手不命中 → reselect 开关不影响
});

test("主手：主手槽位在池中重复 isCurrent——池内最优非主手时正确换入", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 4 } });
  const top = tool({ slot: 5, enchants: { efficiency: 5 } });
  const dup = tool({ slot: 6, enchants: { efficiency: 5 } }); // 与 top 并列——排序稳定取先者
  assert.equal(swapSlot(select("x", hand, [top, dup], cfg(s, true))), 5);
});

// ─── 拒绝（ban）组合 ───────────────────────────────────

test("ban 组合：banRoles + banEnchants 同时生效且一票否决", () => {
  const s: ToolStrategy = {
    name: "ban-both",
    want: [{ role: "pickaxe" }, { role: "axe" }],
    banRoles: ["shovel"],
    banEnchants: ["silk"],
  };
  const silkPick = tool({ slot: 1, role: "pickaxe", enchants: { silk: 1 } }); // ban 附魔
  const shovel = tool({ slot: 2, role: "shovel" }); // ban 角色
  const pick = tool({ slot: 3, role: "pickaxe" });
  const axe = tool({ slot: 4 });
  // 精准镐被 banEnchants 否决、锹被 banRoles 否决 → 普通镐
  assert.equal(swapSlot(select("x", undefined, [silkPick, shovel, pick, axe], cfg(s))), 3);
  // 只剩被 ban 的 → 保持
  assert.equal(select("x", undefined, [silkPick, shovel], cfg(s)).action, "keep");
});

// ─── 特殊角色 ──────────────────────────────────────────

test("特殊角色：shears(tier0)/trident/bow 角色精确匹配", () => {
  const s: ToolStrategy = {
    name: "special",
    want: [
      { role: "shears" },
      { role: "trident" },
      { role: "bow" },
    ],
  };
  const shears = tool({ slot: 1, role: "shears", tier: 0 });
  const trident = tool({ slot: 2, role: "trident", tier: 6 });
  const bow = tool({ slot: 3, role: "bow", tier: 0 });
  const axe = tool({ slot: 4 }); // 不匹配任何角色档
  assert.equal(swapSlot(select("x", undefined, [axe, bow, trident, shears], cfg(s))), 1); // shears 档优先
  assert.equal(swapSlot(select("x", undefined, [axe, bow, trident], cfg(s))), 2);
  assert.equal(swapSlot(select("x", undefined, [axe, bow], cfg(s))), 3);
  assert.equal(select("x", undefined, [axe], cfg(s)).action, "keep");
});

test("特殊角色：混池中 shears 不被镐档误选（tier 0 不参与品阶比较）", () => {
  const s: ToolStrategy = { name: "pick", want: [{ role: "pickaxe" }], sortBy: [{ dim: "tier" }] };
  const shears = tool({ slot: 1, role: "shears", tier: 0 });
  const pick = tool({ slot: 2, role: "pickaxe", tier: 3 });
  assert.equal(swapSlot(select("x", undefined, [shears, pick], cfg(s))), 2);
  assert.equal(select("x", undefined, [shears], cfg(s)).action, "keep");
});

// ─── 预定义策略组合引用 ────────────────────────────────

test("预定义引用：树节点用字符串引用多个内置策略（silk/fortune/tier）", () => {
  const tree: ToolTree = {
    name: "preset-combo",
    nodes: [
      { type: "by-strategy", strategy: "silk" },
      { type: "by-strategy", strategy: "fortune" },
      { type: "by-strategy", strategy: "tier" },
    ],
  };
  const silkPick = tool({ slot: 1, role: "pickaxe", enchants: { silk: 1 } });
  const f3Axe = tool({ slot: 2, enchants: { fortune: 3 } });
  const diamondAxe = tool({ slot: 3, tier: 5 });
  // 节点1 silk：有精准候选 → 选精准（即便时运/品阶更高）
  assert.equal(swapSlot(select("x", undefined, [f3Axe, diamondAxe, silkPick], treeCfg(tree))), 1);
  // 无精准：silk 预定义带任意回落档 {} → 仍收任意工具，档内 silk 全 0 → 按品阶取钻石斧
  assert.equal(swapSlot(select("x", undefined, [f3Axe, diamondAxe], treeCfg(tree))), 3);
  // 只有铁时运斧：silk 回落档收它（品阶唯一）→ 不出决策也得换入该斧
  assert.equal(swapSlot(select("x", undefined, [f3Axe], treeCfg(tree))), 2);
});

test("预定义语义：silk/fortune 的'回落任意档'使其永不无候选——带精准/时运者先进档1", () => {
  const tree: ToolTree = { name: "fortune-only", nodes: [{ type: "by-strategy", strategy: "fortune" }] };
  const f3 = tool({ slot: 1, enchants: { fortune: 3 } });
  const plainDiamond = tool({ slot: 2, tier: 5 }); // 无时运 → 回落档
  const plainIron = tool({ slot: 3, tier: 3 });
  // 时运3 进档1 → 优先（即使品阶低于钻石）
  assert.equal(swapSlot(select("x", undefined, [plainDiamond, f3, plainIron], treeCfg(tree))), 1);
  // 无时运：全回落档 → 档内按品阶（钻石 > 铁）
  assert.equal(swapSlot(select("x", undefined, [plainDiamond, plainIron], treeCfg(tree))), 2);
  // 无时运仅铁 → 回落档收铁
  assert.equal(swapSlot(select("x", undefined, [plainIron], treeCfg(tree))), 3);
});

test("自定义注册：registerStrategy 后树按名引用；覆盖同名立即生效", () => {
  registerStrategy({
    name: "my-custom",
    want: [{ role: "hoe", require: [{ type: "silk" }] }, { role: "hoe" }],
  });
  const silkHoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const plainHoe = tool({ slot: 2, role: "hoe" });
  const tree: ToolTree = { name: "custom", nodes: [{ type: "by-strategy", strategy: "my-custom" }] };
  // 自定义策略：精准锄进档1 → 优先于普通锄（档2）
  assert.equal(swapSlot(select("x", undefined, [plainHoe, silkHoe], treeCfg(tree))), 1);
  assert.equal(swapSlot(select("x", undefined, [plainHoe], treeCfg(tree))), 2);
  // 覆盖同名 → 新语义立即生效：任意档 + 缺省品阶 → 同 tier 稳定取先入池者
  registerStrategy({ name: "my-custom", want: [{}] });
  const axe = tool({ slot: 3 });
  assert.equal(swapSlot(select("x", undefined, [axe, silkHoe], treeCfg(tree))), 3);
});

test("未注册策略名：树引用不存在的预定义 → 跳过该节点", () => {
  const tree: ToolTree = {
    name: "unknown-preset",
    nodes: [
      { type: "by-strategy", strategy: "no-such-strategy" },
      { type: "by-strategy", strategy: { name: "inline", want: [{ role: "axe" }] } },
    ],
  };
  const axe = tool({ slot: 1 });
  assert.equal(swapSlot(select("x", undefined, [axe], treeCfg(tree))), 1);
});

// ─── 兜底与边界 ────────────────────────────────────────

test("兜底：want=[{}] 空档收任意工具，档内按品阶", () => {
  const s: ToolStrategy = { name: "any", want: [{}] };
  const wood = tool({ slot: 1, tier: 1 });
  const diamond = tool({ slot: 2, tier: 5, role: "pickaxe" });
  const shears = tool({ slot: 3, tier: 0, role: "shears" });
  assert.equal(swapSlot(select("x", undefined, [wood, shears, diamond], cfg(s))), 2);
});

test("边界：耐久占比极端值（0 / 1 / 负保护）不影响入池与排序", () => {
  const s: ToolStrategy = { name: "durability", want: [{}], sortBy: [{ dim: "durability" }] };
  const zero = tool({ slot: 1, durability: 0, maxDurability: 250, durabilityRatio: 0 });
  const full = tool({ slot: 2, durabilityRatio: 1 });
  assert.equal(swapSlot(select("x", undefined, [zero, full], cfg(s))), 2);
  assert.equal(swapSlot(select("x", undefined, [zero], cfg(s))), 1); // 单候选也换入（占比0仍入池）
});

test("边界：多候选完全同分——排序稳定取先入池者", () => {
  const s: ToolStrategy = { name: "tie", want: [{}], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const a = tool({ slot: 1, enchants: { efficiency: 3 } });
  const b = tool({ slot: 2, enchants: { efficiency: 3 } });
  const c = tool({ slot: 3, enchants: { efficiency: 3 } });
  assert.equal(swapSlot(select("x", undefined, [a, b, c], cfg(s))), 1); // 稳定排序 → 第一把
});

test("边界：sword 角色在挖掘树中不被镐档误选；axe 在战斗树中不被剑档误选", () => {
  const s: ToolStrategy = { name: "strict-role", want: [{ role: "sword" }] };
  const sword = tool({ slot: 1, role: "sword" });
  const axe = tool({ slot: 2 });
  assert.equal(swapSlot(select("x", undefined, [axe, sword], cfg(s))), 1);
  assert.equal(select("x", undefined, [axe], cfg(s)).action, "keep");
});

// ─── 真实砍树全流程（用户规格回归） ────────────────────

/** 砍树树（对齐 mock-player ToolPolicy）：原木→效率斧；树叶→精准锄>剪刀>任意精准>任意 */
const WOODCUT_TREE: ToolTree = {
  name: "woodcut",
  nodes: [
    {
      type: "by-block",
      match: (id) => id.endsWith("_log"),
      node: {
        type: "by-strategy",
        strategy: {
          name: "woodcut-log",
          want: [{ role: "axe" }],
          sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
        },
      },
    },
    {
      type: "by-block",
      match: (id) => id.endsWith("_leaves"),
      node: {
        type: "by-strategy",
        strategy: {
          name: "woodcut-leaf",
          want: [
            { role: "hoe", require: [{ type: "silk" }] },
            { role: "shears" },
            { require: [{ type: "silk" }] },
            {},
          ],
          sortBy: [{ dim: "enchant", type: "silk" }, { dim: "tier" }],
        },
      },
    },
  ],
};

test("砍树全流程：主手效率5斧挖树叶 + 背包精准锄 → 换精准锄（reselect=true 工作马）", () => {
  const hand = tool({ slot: 0, isCurrent: true, tier: 3, enchants: { efficiency: 5 } });
  const silkHoe = tool({ slot: 2, role: "hoe", enchants: { silk: 1 } });
  const d = select("minecraft:oak_leaves", hand, [silkHoe], treeCfg(WOODCUT_TREE, true));
  assert.equal(d.action, "swap");
  assert.equal(d.action === "swap" ? d.tool.slot : -1, 2);
});

test("砍树全流程：主手精准钻石斧挖树叶 + 背包精准锄 → 仍换精准锄（工作马）", () => {
  const hand = tool({ slot: 0, isCurrent: true, tier: 5, enchants: { silk: 1 } });
  const silkHoe = tool({ slot: 2, role: "hoe", tier: 3, enchants: { silk: 1 } });
  assert.equal(swapSlot(select("minecraft:oak_leaves", hand, [silkHoe], treeCfg(WOODCUT_TREE, true))), 2);
  // 默认 reselect=false：主手命中任意精准档 → 保持
  assert.equal(select("minecraft:oak_leaves", hand, [silkHoe], treeCfg(WOODCUT_TREE, false)).action, "keep");
});

test("砍树全流程：树叶档完整回落链——精准锄>剪刀>任意精准>任意工具", () => {
  const cfgT = treeCfg(WOODCUT_TREE);
  const silkHoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const shears = tool({ slot: 2, role: "shears", tier: 0 });
  const silkAxe = tool({ slot: 3, enchants: { silk: 1 } });
  const plainAxe = tool({ slot: 4, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("minecraft:jungle_leaves", undefined, [shears, silkHoe], cfgT)), 1);
  assert.equal(swapSlot(select("minecraft:jungle_leaves", undefined, [silkAxe, shears], cfgT)), 2);
  assert.equal(swapSlot(select("minecraft:jungle_leaves", undefined, [plainAxe, silkAxe], cfgT)), 3);
  assert.equal(swapSlot(select("minecraft:jungle_leaves", undefined, [plainAxe], cfgT)), 4);
});

test("砍树全流程：效率斧档内 效率5铁斧 > 效率0钻石斧", () => {
  const e5 = tool({ slot: 1, tier: 3, enchants: { efficiency: 5 } });
  const e0 = tool({ slot: 2, tier: 5 });
  assert.equal(swapSlot(select("minecraft:oak_log", undefined, [e5, e0], treeCfg(WOODCUT_TREE))), 1);
});

test("砍树全流程：主手已是池内最优 → 保持（工作马也不换自己）", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const worse = tool({ slot: 2, enchants: { efficiency: 3 } });
  assert.equal(select("minecraft:oak_log", hand, [worse], treeCfg(WOODCUT_TREE, true)).action, "keep");
});
