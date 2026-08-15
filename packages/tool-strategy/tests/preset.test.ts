// ─── 预定义策略测试 ───────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { select } from "../src/index";
import { registerStrategy, STRATEGY_PRESETS } from "../src/index";
import type { ToolCandidate, ToolSelectorConfig, ToolStrategy, ToolTree } from "../src/index";

/** 构造工具候选（默认满耐久铁斧） */
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

/** 单策略树（引用预定义名） */
function cfgOf(presetName: string, reselectIfCurrent = false): ToolSelectorConfig {
  return {
    tree: { name: "preset", nodes: [{ type: "by-strategy", strategy: presetName }] },
    reselectIfCurrent,
  };
}

function swapSlot(decision: ReturnType<typeof select>): number {
  assert.equal(decision.action, "swap");
  return decision.action === "swap" ? decision.tool.slot : -1;
}

test("注册表：内置预定义齐全（tier/durability/efficiency/silk/fortune/axe/pickaxe/hoe/shears）", () => {
  for (const name of ["tier", "durability", "efficiency", "silk", "fortune", "axe", "pickaxe", "hoe", "shears"]) {
    assert.ok(STRATEGY_PRESETS[name], `缺少预定义策略 ${name}`);
    assert.equal(STRATEGY_PRESETS[name]!.name, name);
  }
});

test("tier（品阶优先，缺省语义）：任意工具，档内品阶越高越优先", () => {
  const iron = tool({ slot: 1, tier: 3 });
  const diamond = tool({ slot: 2, tier: 5 });
  assert.equal(swapSlot(select("x", undefined, [iron, diamond], cfgOf("tier"))), 2);
});

test("durability（耐久优先）：档内剩余耐久占比越高越优先", () => {
  const worn = tool({ slot: 1, durability: 50, maxDurability: 250, durabilityRatio: 0.2 });
  const fresh = tool({ slot: 2, durability: 240, maxDurability: 250, durabilityRatio: 0.96 });
  assert.equal(swapSlot(select("x", undefined, [worn, fresh], cfgOf("durability"))), 2);
});

test("efficiency（效率优先）：效率5 斧 > 效率0 钻石斧（效率维度压过品阶）", () => {
  const e0diamond = tool({ slot: 1, tier: 5 });
  const e5iron = tool({ slot: 2, tier: 3, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(select("x", undefined, [e0diamond, e5iron], cfgOf("efficiency"))), 2);
});

test("silk（精准优先）：带精准优先，无精准回落任意工具", () => {
  const silkPick = tool({ slot: 1, role: "pickaxe", enchants: { silk: 1 } });
  const shears = tool({ slot: 2, role: "shears", tier: 0 });
  assert.equal(swapSlot(select("x", undefined, [shears, silkPick], cfgOf("silk"))), 1);
  assert.equal(swapSlot(select("x", undefined, [shears], cfgOf("silk"))), 2); // 回落
});

test("fortune（时运优先）：带时运优先，无时运回落任意工具", () => {
  const f3 = tool({ slot: 1, enchants: { fortune: 3 } });
  const plain = tool({ slot: 2 });
  assert.equal(swapSlot(select("x", undefined, [plain, f3], cfgOf("fortune"))), 1);
  assert.equal(swapSlot(select("x", undefined, [plain], cfgOf("fortune"))), 2);
});

test("axe / pickaxe（角色限定）：只收指定角色", () => {
  const axe = tool({ slot: 1 });
  const pick = tool({ slot: 2, role: "pickaxe" });
  assert.equal(swapSlot(select("x", undefined, [pick, axe], cfgOf("axe"))), 1);
  assert.equal(select("x", undefined, [pick], cfgOf("axe")).action, "keep"); // 无斧 → 保持
  assert.equal(swapSlot(select("x", undefined, [axe, pick], cfgOf("pickaxe"))), 2);
});

test("registerStrategy：注册自定义策略后可按名引用", () => {
  const custom: ToolStrategy = {
    name: "my-silk-axe",
    want: [{ role: "axe", require: [{ type: "silk" }] }, { role: "axe" }],
    sortBy: [{ dim: "enchant", type: "silk" }, { dim: "tier" }],
  };
  registerStrategy(custom);
  assert.equal(STRATEGY_PRESETS["my-silk-axe"], custom);
  const silkAxe = tool({ slot: 1, enchants: { silk: 1 } });
  const plainAxe = tool({ slot: 2 });
  const cfg: ToolSelectorConfig = {
    tree: { name: "t", nodes: [{ type: "by-strategy", strategy: "my-silk-axe" }] },
  };
  assert.equal(swapSlot(select("x", undefined, [plainAxe, silkAxe], cfg)), 1);
});

test("自定义策略对象直接进树节点（无需注册）", () => {
  const tree: ToolTree = {
    name: "inline",
    nodes: [
      {
        type: "by-strategy",
        strategy: { name: "inline-axe", want: [{ role: "axe", minTier: 4 }] }, // 黄金+斧
      },
    ],
  };
  const gold = tool({ slot: 1, tier: 4 });
  const iron = tool({ slot: 2, tier: 3 });
  assert.equal(swapSlot(select("x", undefined, [gold, iron], { tree })), 1);
  assert.equal(select("x", undefined, [iron], { tree }).action, "keep"); // 铁斧低于门槛 → 保持
});
