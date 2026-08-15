// ─── 引擎测试（档位 + sortBy + 决策树 + 用户四例） ─────

import { test } from "node:test";
import assert from "node:assert/strict";

import { select } from "../src/index";
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

function swapSlot(decision: ReturnType<typeof select>): number {
  assert.equal(decision.action, "swap");
  return decision.action === "swap" ? decision.tool.slot : -1;
}

// ─── 档位下标优先级 ────────────────────────────────────

test("档位：下标即优先级——效率5铁斧 > 精准钻石镐 > 效率3铁斧（用户例4）", () => {
  const s: ToolStrategy = {
    name: "s4",
    want: [
      { role: "axe", minTier: 3, maxTier: 3, require: [{ type: "efficiency", minLevel: 5 }] },
      { role: "pickaxe", minTier: 5, require: [{ type: "silk" }] },
      { role: "axe", minTier: 3, maxTier: 3, require: [{ type: "efficiency", minLevel: 3 }] },
    ],
  };
  const e5axe = tool({ slot: 1, enchants: { efficiency: 5 } });
  const silkPick = tool({ slot: 2, role: "pickaxe", tier: 5, enchants: { silk: 1 } });
  const e3axe = tool({ slot: 3, enchants: { efficiency: 3 } });
  // 全在 → 档1（效率5铁斧）
  assert.equal(swapSlot(select("x", undefined, [e5axe, silkPick, e3axe], cfg(s))), 1);
  // 无效率5斧 → 档2（精准钻石镐）
  assert.equal(swapSlot(select("x", undefined, [silkPick, e3axe], cfg(s))), 2);
  // 无精准镐 → 档3（效率3铁斧）
  assert.equal(swapSlot(select("x", undefined, [e3axe], cfg(s))), 3);
});

test("档位：时运3 > 精准 > 时运2（用户例1；档1吸走≥3，档3自然只剩2级）", () => {
  const s: ToolStrategy = {
    name: "s1",
    want: [
      { require: [{ type: "fortune", minLevel: 3 }] },
      { require: [{ type: "silk" }] },
      { require: [{ type: "fortune", minLevel: 2 }] },
    ],
  };
  const f3 = tool({ slot: 1, role: "axe", enchants: { fortune: 3 } });
  const silk = tool({ slot: 2, role: "pickaxe", enchants: { silk: 1 } });
  const f2 = tool({ slot: 3, role: "hoe", enchants: { fortune: 2 } });
  assert.equal(swapSlot(select("x", undefined, [f3, silk, f2], cfg(s))), 1);
  assert.equal(swapSlot(select("x", undefined, [silk, f2], cfg(s))), 2); // 无时运3 → 精准
  assert.equal(swapSlot(select("x", undefined, [f2], cfg(s))), 3); // 无精准 → 时运2
});

test("档位：maxLevel 恰好——恰好时运3 不收时运4", () => {
  const s: ToolStrategy = {
    name: "exact",
    want: [{ require: [{ type: "fortune", minLevel: 3, maxLevel: 3 }] }],
  };
  const f4 = tool({ slot: 1, enchants: { fortune: 4 } });
  const f3 = tool({ slot: 2, enchants: { fortune: 3 } });
  assert.equal(swapSlot(select("x", undefined, [f4, f3], cfg(s))), 2);
  // 只有时运4 → 档位无命中 → 保持
  assert.equal(select("x", undefined, [f4], cfg(s)).action, "keep");
});

// ─── require AND 门槛 ──────────────────────────────────

test("require 多条 = AND：时运5 且 效率5 的斧缺一不入池（用户例2）", () => {
  const s: ToolStrategy = {
    name: "s2",
    want: [
      { role: "axe", require: [{ type: "silk", minLevel: 4 }] },
      { role: "axe", require: [{ type: "fortune", minLevel: 5 }, { type: "efficiency", minLevel: 5 }] },
      { role: "hoe", require: [{ type: "silk" }] },
    ],
    sortBy: [{ dim: "enchant", type: "silk" }, { dim: "tier" }],
  };
  const silk4axe = tool({ slot: 1, enchants: { silk: 4 } });
  const silk5axe = tool({ slot: 2, enchants: { silk: 5 } });
  const f5e5axe = tool({ slot: 3, enchants: { fortune: 5, efficiency: 5 } });
  const f5e4axe = tool({ slot: 4, enchants: { fortune: 5, efficiency: 4 } }); // 效率缺1 → 档2不入池
  const silkHoe = tool({ slot: 5, role: "hoe", enchants: { silk: 1 } });
  // 档1 内：精准5斧 > 精准4斧（档内按 silk 等级 sortBy）
  assert.equal(swapSlot(select("x", undefined, [silk4axe, silk5axe], cfg(s))), 2);
  // 无精准斧 → 档2（时运5效率5斧）；f5e4axe 因 AND 不入池
  assert.equal(swapSlot(select("x", undefined, [f5e4axe, f5e5axe], cfg(s))), 3);
  // 只有 f5e4axe → 档2 无候选 → 档3 也无（非锄）→ 保持
  assert.equal(select("x", undefined, [f5e4axe], cfg(s)).action, "keep");
  // 只有精准锄 → 档3
  assert.equal(swapSlot(select("x", undefined, [silkHoe], cfg(s))), 5);
});

// ─── 角色档位（无视附魔/品阶） ─────────────────────────

test("档位：效率4铁斧 > 效率5钻石镐（用户例3——角色优先，auto-refill 表达不了）", () => {
  const s: ToolStrategy = {
    name: "s3",
    want: [{ role: "axe" }, { role: "pickaxe", minTier: 5 }],
    sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
  };
  const e4axe = tool({ slot: 1, enchants: { efficiency: 4 } });
  const e5pick = tool({ slot: 2, role: "pickaxe", tier: 5, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("x", undefined, [e4axe, e5pick], cfg(s))), 1);
});

// ─── 档内 sortBy 维度链 ────────────────────────────────

test("sortBy：缺省品阶越高越优先", () => {
  const s: ToolStrategy = { name: "t", want: [{}] };
  const iron = tool({ slot: 1, tier: 3 });
  const diamond = tool({ slot: 2, tier: 5 });
  assert.equal(swapSlot(select("x", undefined, [iron, diamond], cfg(s))), 2);
});

test("sortBy：durability 剩余耐久占比优先（工作马）", () => {
  const s: ToolStrategy = { name: "d", want: [{}], sortBy: [{ dim: "durability" }] };
  const fresh = tool({ slot: 1, durability: 200, maxDurability: 250, durabilityRatio: 0.8 });
  const worn = tool({ slot: 2, durability: 100, maxDurability: 250, durabilityRatio: 0.4 });
  const better = tool({ slot: 3, durability: 240, maxDurability: 250, durabilityRatio: 0.96 });
  assert.equal(swapSlot(select("x", undefined, [fresh, worn, better], cfg(s))), 3);
});

test("sortBy：enchant 指定附魔等级（效率5 > 效率3，无视品阶）", () => {
  const s: ToolStrategy = { name: "e", want: [{}], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const e3 = tool({ slot: 1, tier: 5, enchants: { efficiency: 3 } });
  const e5 = tool({ slot: 2, tier: 1, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("x", undefined, [e3, e5], cfg(s))), 2);
});

test("sortBy：enchant-count 期待附魔命中数优先（期待多少个）", () => {
  const s: ToolStrategy = {
    name: "c",
    want: [{}],
    sortBy: [{ dim: "enchant-count", types: ["efficiency", "fortune"] }],
  };
  const one = tool({ slot: 1, enchants: { efficiency: 5 } }); // 命中 1 个
  const two = tool({ slot: 2, enchants: { efficiency: 1, fortune: 3 } }); // 命中 2 个
  assert.equal(swapSlot(select("x", undefined, [one, two], cfg(s))), 2);
});

test("sortBy：enchant-sum 期待附魔等级和优先（等级怎么样）", () => {
  const s: ToolStrategy = {
    name: "sum",
    want: [{}],
    sortBy: [{ dim: "enchant-sum", types: ["efficiency", "fortune"] }],
  };
  const sum4 = tool({ slot: 1, enchants: { efficiency: 2, fortune: 2 } }); // 和 4
  const sum6 = tool({ slot: 2, enchants: { efficiency: 3, fortune: 3 } }); // 和 6
  assert.equal(swapSlot(select("x", undefined, [sum4, sum6], cfg(s))), 2);
});

test("sortBy：维度链组合——先效率等级，再品阶", () => {
  const s: ToolStrategy = {
    name: "chain",
    want: [{}],
    sortBy: [{ dim: "enchant", type: "efficiency" }, { dim: "tier" }],
  };
  const e1iron = tool({ slot: 1, tier: 3, enchants: { efficiency: 1 } });
  const e1wood = tool({ slot: 2, tier: 1, enchants: { efficiency: 1 } });
  const e2wood = tool({ slot: 3, tier: 1, enchants: { efficiency: 2 } });
  // 效率2 最高
  assert.equal(swapSlot(select("x", undefined, [e1iron, e2wood], cfg(s))), 3);
  // 同效率 → 品阶
  assert.equal(swapSlot(select("x", undefined, [e1wood, e1iron], cfg(s))), 1);
});

// ─── 拒绝（banRoles / banEnchants） ────────────────────

test("banRoles：挖矿拒绝斧——斧不入池", () => {
  const s: ToolStrategy = {
    name: "mining",
    want: [{ role: "pickaxe" }, {}],
    banRoles: ["axe"],
  };
  const axe = tool({ slot: 1 });
  const pick = tool({ slot: 2, role: "pickaxe" });
  // 无镐 → 档2 任意角色，但斧被 ban → 无候选 → 保持
  assert.equal(select("minecraft:stone", undefined, [axe], cfg(s)).action, "keep");
  assert.equal(swapSlot(select("minecraft:stone", undefined, [axe, pick], cfg(s))), 2);
});

test("banEnchants：拒绝附魔一票否决——带精准不入池", () => {
  const s: ToolStrategy = { name: "b", want: [{}], banEnchants: ["silk"] };
  const silk = tool({ slot: 1, enchants: { silk: 1 } });
  const plain = tool({ slot: 2 });
  assert.equal(swapSlot(select("x", undefined, [silk, plain], cfg(s))), 2);
  assert.equal(select("x", undefined, [silk], cfg(s)).action, "keep");
});

// ─── 主手保持 / 重选（reselectIfCurrent） ──────────────

test("reselectIfCurrent=false（默认）：主手命中策略 → 保持", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 3 } });
  const better = tool({ slot: 2, enchants: { efficiency: 5 } });
  const d = select("x", hand, [better], cfg(s, false));
  assert.equal(d.action, "keep");
});

test("reselectIfCurrent=true：主手命中也重选最优——背包更好就换", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 3 } });
  const better = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("x", hand, [better], cfg(s, true))), 2);
});

test("reselectIfCurrent=true：主手已是最优 → 保持（不换自己）", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }], sortBy: [{ dim: "enchant", type: "efficiency" }] };
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const worse = tool({ slot: 2, enchants: { efficiency: 3 } });
  const d = select("x", hand, [worse], cfg(s, true));
  assert.equal(d.action, "keep");
});

test("空池（无候选）→ 保持", () => {
  const s: ToolStrategy = { name: "t", want: [{ role: "axe" }] };
  const pick = tool({ slot: 1, role: "pickaxe" });
  assert.equal(select("x", undefined, [pick], cfg(s)).action, "keep");
  assert.equal(select("x", undefined, [], cfg(s)).action, "keep");
});

// ─── 决策树编排 ────────────────────────────────────────

/** 砍树树：原木→效率斧；树叶→精准锄>剪刀>任意精准>任意；其他→不切换 */
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

function treeCfg(tree: ToolTree, reselectIfCurrent = false): ToolSelectorConfig {
  return { tree, reselectIfCurrent };
}

test("决策树：方块分发——原木走斧、树叶走精准锄、其他方块不切换", () => {
  const e5axe = tool({ slot: 1, enchants: { efficiency: 5 } });
  const silkHoe = tool({ slot: 2, role: "hoe", enchants: { silk: 1 } });
  const shears = tool({ slot: 3, role: "shears", tier: 0 });
  const cfgT = treeCfg(WOODCUT_TREE, true); // 工作马：主手命中也重选
  // 原木：只有树叶工具 → 无斧候选 → 保持
  assert.equal(select("minecraft:oak_log", undefined, [silkHoe], cfgT).action, "keep");
  // 原木：有斧 → 效率斧
  assert.equal(swapSlot(select("minecraft:oak_log", undefined, [silkHoe, e5axe], cfgT)), 1);
  // 树叶：精准锄 > 剪刀
  assert.equal(swapSlot(select("minecraft:oak_leaves", undefined, [shears, silkHoe], cfgT)), 2);
  // 树叶：无精准锄 → 剪刀
  assert.equal(swapSlot(select("minecraft:oak_leaves", undefined, [shears], cfgT)), 3);
  // 其他方块：无节点命中 → 保持
  assert.equal(select("minecraft:stone", undefined, [e5axe, silkHoe], cfgT).action, "keep");
});

test("决策树回归：主手精准斧挖树叶 + 背包有精准锄 → 换精准锄（用户 bug 场景）", () => {
  const hand = tool({ slot: 0, isCurrent: true, tier: 5, enchants: { silk: 1 } }); // 精准钻石斧
  const silkHoe = tool({ slot: 2, role: "hoe", tier: 3, enchants: { silk: 1 } });
  // 工作马（reselect=true）：树叶偏好不给主手特权 → 精准锄优先
  assert.equal(swapSlot(select("minecraft:oak_leaves", hand, [silkHoe], treeCfg(WOODCUT_TREE, true))), 2);
  // 默认（reselect=false）：主手命中策略（任意精准档）→ 保持
  assert.equal(select("minecraft:oak_leaves", hand, [silkHoe], treeCfg(WOODCUT_TREE, false)).action, "keep");
});

test("决策树：branch 嵌套 + keep 节点——主手是钻石则保持，否则换入", () => {
  const tree: ToolTree = {
    name: "branch-test",
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
                { type: "keep" }, // 石头 → 显式保持（演示 keep 节点）
              ],
            },
          },
          {
            type: "by-block",
            match: (id) => id === "minecraft:oak_log",
            node: { type: "by-strategy", strategy: { name: "log", want: [{ role: "axe" }] } },
          },
        ],
      },
    ],
  };
  const axe = tool({ slot: 1 });
  assert.equal(select("minecraft:stone", undefined, [axe], treeCfg(tree)).action, "keep");
  assert.equal(swapSlot(select("minecraft:oak_log", undefined, [axe], treeCfg(tree))), 1);
  assert.equal(select("minecraft:dirt", undefined, [axe], treeCfg(tree)).action, "keep");
});

test("决策树：by-strategy 引用预定义名（未注册 → 跳过；注册后生效）", () => {
  const tree: ToolTree = {
    name: "preset-ref",
    nodes: [{ type: "by-strategy", strategy: "silk" }],
  };
  const silkPick = tool({ slot: 1, role: "pickaxe", enchants: { silk: 1 } });
  const plainAxe = tool({ slot: 2 });
  // "silk" 内置：精准优先 → 精准镐
  assert.equal(swapSlot(select("x", undefined, [plainAxe, silkPick], treeCfg(tree))), 1);
  // 未注册名 → 跳过 → 树无决策 → 保持
  const badTree: ToolTree = { name: "bad", nodes: [{ type: "by-strategy", strategy: "no-such-preset" }] };
  assert.equal(select("x", undefined, [silkPick], treeCfg(badTree)).action, "keep");
});
