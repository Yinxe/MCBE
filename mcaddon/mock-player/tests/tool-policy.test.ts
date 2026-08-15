// ─── core/rules — 假人工具策略（@yinxe/tool-strategy 可插拔引擎） ─────

import { test } from "node:test";
import assert from "node:assert/strict";

import type { ToolCandidate } from "@yinxe/tool-strategy/src/index";

import {
  ABS_DURABILITY_FLOOR,
  decideTool,
  isUrgent,
  urgentReplacement,
  URGENT_THRESHOLD,
  WOODCUT_TREE,
} from "../scripts/core/rules/ToolPolicy";

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

function swapSlot(decision: ReturnType<typeof decideTool>): number {
  assert.equal(decision.action, "swap");
  return decision.action === "swap" ? decision.tool.slot : -1;
}

// ─── 砍树决策树（WOODCUT_TREE） ────────────────────────

test("决策树：原木 → 效率斧（档内效率等级 → 品阶）；树叶 → 精准锄>剪刀>任意精准>任意", () => {
  assert.equal(WOODCUT_TREE.name, "woodcut-mixed"); // 默认 = mixed 模式树
  assert.equal(WOODCUT_TREE.nodes.length, 2);
  const logNode = WOODCUT_TREE.nodes[0];
  const leafNode = WOODCUT_TREE.nodes[1];
  assert.ok(logNode && logNode.type === "by-block" && logNode.match("minecraft:oak_log"));
  assert.ok(!logNode.match("minecraft:oak_leaves"));
  assert.ok(leafNode && leafNode.type === "by-block" && leafNode.match("minecraft:jungle_leaves"));
  assert.ok(!leafNode.match("minecraft:oak_log"));
});

// ─── 模式树（原子策略组合，可插拔） ────────────────────

test("模式树：logs 只挂木头策略——挖树叶不切精准（清障破叶用主手斧）", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  // 挖原木 → 换效率斧
  assert.equal(swapSlot(decideTool([hoe, axe], "minecraft:oak_log", undefined, false, "logs")), 2);
  // 挖树叶 → 树无节点 → 保持（不切精准锄）
  assert.equal(decideTool([hoe, axe], "minecraft:oak_leaves", undefined, false, "logs").action, "keep");
});

test("模式树：leaves 只挂树叶策略——不动树干", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  // 挖树叶 → 精准锄
  assert.equal(swapSlot(decideTool([axe, hoe], "minecraft:oak_leaves", undefined, false, "leaves")), 1);
  // 挖原木 → 树无节点 → 保持
  assert.equal(decideTool([axe, hoe], "minecraft:oak_log", undefined, false, "leaves").action, "keep");
});

test("模式树：mixed 组合——挖到什么切什么（用户规格）", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(decideTool([hoe, axe], "minecraft:oak_log", undefined, false, "mixed")), 2);
  assert.equal(swapSlot(decideTool([axe, hoe], "minecraft:oak_leaves", undefined, false, "mixed")), 1);
});

// ─── 决策（引擎 select 封装） ──────────────────────────

test("决策：原木 → 效率斧（效率5 铁斧 > 效率0 钻石斧）", () => {
  const e5 = tool({ slot: 1, tier: 3, enchants: { efficiency: 5 } });
  const e0 = tool({ slot: 2, tier: 5 });
  assert.equal(swapSlot(decideTool([e5, e0], "minecraft:oak_log")), 1);
});

test("决策：树叶 → 精准锄 > 剪刀 > 任意精准 > 任意工具", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const shears = tool({ slot: 2, role: "shears", tier: 0 });
  const silkPick = tool({ slot: 3, role: "pickaxe", tier: 5, enchants: { silk: 1 } });
  const plainAxe = tool({ slot: 4, enchants: { efficiency: 5 } });
  // 精准锄优先
  assert.equal(swapSlot(decideTool([shears, hoe], "minecraft:oak_leaves")), 1);
  // 无精准锄 → 剪刀（剪刀档先于任意精准档）
  assert.equal(swapSlot(decideTool([silkPick, shears], "minecraft:oak_leaves")), 2);
  // 无剪刀 → 任意精准工具
  assert.equal(swapSlot(decideTool([plainAxe, silkPick], "minecraft:oak_leaves")), 3);
  // 只有普通斧 → 任意工具兜底档
  assert.equal(swapSlot(decideTool([plainAxe], "minecraft:oak_leaves")), 4);
});

test("决策：其他方块 → 树无节点命中 → 保持", () => {
  const axe = tool({ slot: 1 });
  assert.equal(decideTool([axe], "minecraft:stone").action, "keep");
  assert.equal(decideTool([axe], "minecraft:dirt").action, "keep");
});

test("决策：空池（无候选）→ 保持", () => {
  assert.equal(decideTool([], "minecraft:oak_log").action, "keep");
});

test("决策回归：主手精准斧挖树叶 + 背包有精准锄 → 换精准锄（默认工作马选最优）", () => {
  // 用户场景：假人拿精准斧挖树叶效率低——reselect 默认 true，
  // 树叶偏好（精准锄 > 剪刀 > 任意精准）选最优 → 必换精准锄
  const hand = tool({ slot: 0, isCurrent: true, tier: 5, enchants: { silk: 1 } });
  const hoe = tool({ slot: 2, role: "hoe", tier: 3, enchants: { silk: 1 } });
  assert.equal(swapSlot(decideTool([hoe], "minecraft:oak_leaves", hand)), 2);
});

test("决策：主手已是最优 → 保持（不换自己）", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const worse = tool({ slot: 2, enchants: { efficiency: 3 } });
  assert.equal(decideTool([worse], "minecraft:oak_log", hand).action, "keep");
});

test("决策：reselect=false 显式省耐久——主手命中策略即保持", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { silk: 1 } });
  const hoe = tool({ slot: 2, role: "hoe", enchants: { silk: 1 } });
  assert.equal(decideTool([hoe], "minecraft:oak_leaves", hand, false).action, "keep");
});

// ─── 耐久保护（同 role 更耐久替换，绝不降级） ──────────

test("紧急判定：低于占比阈值（5%）或绝对下限（16）→ 紧急", () => {
  assert.equal(isUrgent(tool({ slot: 0, durability: 10, maxDurability: 250, durabilityRatio: 0.04 }), URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), true);
  // 占比 20% 但只剩 12 耐久（<16 兜底）→ 紧急
  assert.equal(isUrgent(tool({ slot: 0, tier: 1, durability: 12, maxDurability: 59, durabilityRatio: 0.2 }), URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), true);
  assert.equal(isUrgent(tool({ slot: 0, durability: 200, durabilityRatio: 0.8 }), URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), false);
});

test("耐久保护：紧急 → 换严格更健康、同/高品质同类", () => {
  const current = tool({ slot: 0, isCurrent: true, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, durability: 200, durabilityRatio: 0.8 }),
    tool({ slot: 2, durability: 100, durabilityRatio: 0.4 }),
  ];
  const repl = urgentReplacement(current, bag, URGENT_THRESHOLD);
  assert.equal(repl?.slot, 1); // 更耐久者
});

test("耐久保护：绝不降级——低品质替换（钻石 4% vs 满耐久铁斧）→ null（保持不动）", () => {
  const current = tool({ slot: 0, isCurrent: true, tier: 5, durability: 62, maxDurability: 1561, durabilityRatio: 0.04 });
  const bag = [tool({ slot: 1, tier: 3, durability: 250, durabilityRatio: 1 })]; // 铁斧品质更低
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD), null);
});

test("耐久保护：无合格候选（都更差/占比不达标）→ null（保持不动）", () => {
  const current = tool({ slot: 0, isCurrent: true, durability: 10, durabilityRatio: 0.04 });
  const bag = [tool({ slot: 1, durability: 5, durabilityRatio: 0.02 })]; // 比当前还差
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD), null);
});

test("耐久保护：旧带精准 → 替换优先带精准的同款", () => {
  const current = tool({ slot: 0, isCurrent: true, durability: 10, durabilityRatio: 0.04, enchants: { silk: 1 } });
  const bag = [
    tool({ slot: 1, durability: 200, durabilityRatio: 0.8, enchants: { silk: 1 } }),
    tool({ slot: 2, durability: 210, durabilityRatio: 0.84 }), // 更耐久但不带精准
  ];
  const repl = urgentReplacement(current, bag, URGENT_THRESHOLD);
  assert.equal(repl?.slot, 1); // 精准同款优先（即便 slot 2 更耐久）
});

// ─── 耐久保护：复杂场景（阈值边界/多候选排序/类型与品阶交叉） ──

test("紧急判定：占比阈值精确边界——恰好 5% 不紧急、4.99% 紧急（耐久 ≥ 绝对下限）", () => {
  const at5 = tool({ slot: 0, durability: 20, maxDurability: 400, durabilityRatio: 0.05 }); // 恰好 5%，且 20 ≥ 16
  const below5 = tool({ slot: 0, durability: 19.6, maxDurability: 400, durabilityRatio: 0.049 }); // 4.9% < 5%
  assert.equal(isUrgent(at5, URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), false); // 0.05 不 < 0.05
  assert.equal(isUrgent(below5, URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), true);
});

test("紧急判定：绝对下限精确边界——恰好 16 不紧急、15 紧急（高耐久工具占比兜底）", () => {
  // 下界合金镐剩余 16：占比 0.08 不触发，但绝对下限 16 恰好不触发
  const at16 = tool({ slot: 0, tier: 6, durability: 16, maxDurability: 2031, durabilityRatio: 0.008 });
  const at15 = tool({ slot: 0, tier: 6, durability: 15, maxDurability: 2031, durabilityRatio: 0.007 });
  assert.equal(isUrgent(at16, URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), true); // 占比 0.8% < 5% → 紧急
  // 用高占比但低绝对耐久验证绝对下限分支：占比 20% > 5%，但剩余 15 < 16 → 紧急
  const highRatioLowAbs = tool({ slot: 0, tier: 5, durability: 15, maxDurability: 75, durabilityRatio: 0.2 });
  assert.equal(isUrgent(highRatioLowAbs, URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), true);
  const highRatioOk = tool({ slot: 0, tier: 5, durability: 16, maxDurability: 80, durabilityRatio: 0.2 });
  assert.equal(isUrgent(highRatioOk, URGENT_THRESHOLD, ABS_DURABILITY_FLOOR), false); // 占比 20% 且 16 ≥ 16 → 不紧急
});

test("耐久保护：多候选复杂排序——同款优先 > 精准一致 > 品阶 > 耐久", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:iron_axe", tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:diamond_axe", tier: 5, durability: 100, durabilityRatio: 0.4 }), // 更高品阶
    tool({ slot: 2, typeId: "minecraft:iron_axe", tier: 3, durability: 200, durabilityRatio: 0.8 }), // 同款更耐久
    tool({ slot: 3, typeId: "minecraft:iron_axe", tier: 3, durability: 150, durabilityRatio: 0.6 }), // 同款次耐久
  ];
  const repl = urgentReplacement(current, bag, URGENT_THRESHOLD);
  // 同款优先于高品阶（防换到不顺手工具）→ slot 2
  assert.equal(repl?.slot, 2);
});

test("耐久保护：同款内按耐久排序——同 typeId 两把取更耐久者", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:iron_axe", tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:iron_axe", tier: 3, durability: 180, durabilityRatio: 0.72 }),
    tool({ slot: 2, typeId: "minecraft:iron_axe", tier: 3, durability: 220, durabilityRatio: 0.88 }),
  ];
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD)?.slot, 2);
});

test("耐久保护：品阶相同时类型不同——都不如'更耐久同款'但更高品阶仍可入选（无同款时）", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:stone_axe", tier: 2, durability: 5, durabilityRatio: 0.08 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:iron_axe", tier: 3, durability: 100, durabilityRatio: 0.4 }), // 无 stone_axe 同款
    tool({ slot: 2, typeId: "minecraft:diamond_axe", tier: 5, durability: 60, durabilityRatio: 0.04 }), // 占比不达标 → 不入
  ];
  const repl = urgentReplacement(current, bag, URGENT_THRESHOLD);
  // slot1 铁斧（占比 0.4 达标、更耐久、更高品阶）；slot2 钻石占比 0.04 < 0.05 → 剔除
  assert.equal(repl?.slot, 1);
});

test("耐久保护：候选占比恰好等于阈值可入选（>= 语义）", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:iron_axe", tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:iron_axe", tier: 3, durability: 12.5, maxDurability: 250, durabilityRatio: 0.05 }),
  ];
  // 0.05 >= 0.05 → 可入选（但必须严格更耐久：12.5 > 10 ✓）
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD)?.slot, 1);
});

test("耐久保护：同品阶同类型且都达标——取更耐久（极端贴近）", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:iron_axe", tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:iron_axe", tier: 3, durability: 13, maxDurability: 250, durabilityRatio: 0.052 }),
    tool({ slot: 2, typeId: "minecraft:iron_axe", tier: 3, durability: 14, maxDurability: 250, durabilityRatio: 0.056 }),
  ];
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD)?.slot, 2);
});

test("耐久保护：同耐久同品阶同类型 → 返回池内先者（稳定）", () => {
  const current = tool({ slot: 0, isCurrent: true, typeId: "minecraft:iron_axe", tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    tool({ slot: 1, typeId: "minecraft:iron_axe", tier: 3, durability: 100, durabilityRatio: 0.4 }),
    tool({ slot: 2, typeId: "minecraft:iron_axe", tier: 3, durability: 100, durabilityRatio: 0.4 }),
  ];
  assert.equal(urgentReplacement(current, bag, URGENT_THRESHOLD)?.slot, 1);
});

// ─── 模式树组合（logs/leaves/mixed 交叉场景） ──────────

test("模式树：mixed 挖原木切斧、挖树叶切精准锄——同一背包来回切换", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  // 挖原木 → 效率斧
  assert.equal(swapSlot(decideTool([hoe, axe], "minecraft:oak_log", undefined, true, "mixed")), 2);
  // 挖树叶 → 精准锄
  assert.equal(swapSlot(decideTool([hoe, axe], "minecraft:oak_leaves", undefined, true, "mixed")), 1);
});

test("模式树：mixed 主手斧挖树叶 + 背包精准锄 + 剪刀 → 精准锄优先（树叶档第一优先）", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const shears = tool({ slot: 1, role: "shears", tier: 0 });
  const hoe = tool({ slot: 2, role: "hoe", enchants: { silk: 1 } });
  assert.equal(swapSlot(decideTool([shears, hoe], "minecraft:oak_leaves", hand)), 2);
});

test("模式树：logs 模式挖树叶保持斧（清障不换精准），挖原木换效率斧", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  // 挖原木 → 主手已是效率斧 → 保持
  assert.equal(decideTool([hoe], "minecraft:oak_log", hand, true, "logs").action, "keep");
  // 挖树叶 → logs 树无树叶节点 → 保持（不切精准）
  assert.equal(decideTool([hoe], "minecraft:oak_leaves", hand, true, "logs").action, "keep");
});

test("模式树：leaves 模式挖原木保持、挖树叶换精准", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 5 } });
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  // 挖原木 → leaves 树无原木节点 → 保持
  assert.equal(decideTool([hoe], "minecraft:oak_log", hand, true, "leaves").action, "keep");
  // 挖树叶 → 换精准锄
  assert.equal(swapSlot(decideTool([hoe], "minecraft:oak_leaves", hand, true, "leaves")), 1);
});

test("模式树：mixed 挖其他方块（石头/泥土）→ 树无节点 → 保持", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(decideTool([hoe, axe], "minecraft:stone", undefined, true, "mixed").action, "keep");
  assert.equal(decideTool([hoe, axe], "minecraft:dirt", undefined, true, "mixed").action, "keep");
});

test("模式树：mixed 主手非工具（undefined current）→ 挖原木从背包换效率斧", () => {
  const hoe = tool({ slot: 1, role: "hoe", enchants: { silk: 1 } });
  const axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(decideTool([hoe, axe], "minecraft:oak_log", undefined, true, "mixed")), 2);
});

test("模式树：mixed 挖树叶无精准锄无剪刀 → 任意精准工具兜底", () => {
  const silkAxe = tool({ slot: 1, enchants: { silk: 1 } }); // 精准斧
  const e5Axe = tool({ slot: 2, enchants: { efficiency: 5 } });
  // 无精准锄/剪刀 → 档3 任意精准 → 精准斧
  assert.equal(swapSlot(decideTool([e5Axe, silkAxe], "minecraft:oak_leaves", undefined, true, "mixed")), 1);
});

test("模式树：mixed 挖树叶只有普通斧 → 档4 任意工具兜底", () => {
  const plainAxe = tool({ slot: 1, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(decideTool([plainAxe], "minecraft:oak_leaves", undefined, true, "mixed")), 1);
});

// ─── 决策树组合：预定义策略引用（对齐引擎注册表） ──────

test("决策：主手空手（undefined）挖原木 + 背包无斧只有镐 → 保持（无候选）", () => {
  const pick = tool({ slot: 1, role: "pickaxe" });
  assert.equal(decideTool([pick], "minecraft:oak_log", undefined, true, "mixed").action, "keep");
});

test("决策：主手效率3斧 + 背包效率5斧 → 工作马换效率5（reselect 默认 true）", () => {
  const hand = tool({ slot: 0, isCurrent: true, enchants: { efficiency: 3 } });
  const better = tool({ slot: 2, enchants: { efficiency: 5 } });
  assert.equal(swapSlot(decideTool([better], "minecraft:oak_log", hand)), 2);
  // reselect=false → 主手命中策略即保持
  assert.equal(decideTool([better], "minecraft:oak_log", hand, false).action, "keep");
});
