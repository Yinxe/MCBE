// ─── 工具选择引擎接入单测（rules/items/ToolStrategyTrees） ──
// mock-player 侧策略树 + decideTool/decideWeapon 封装的决策行为测试：
//   挖掘树（方块关键字 → 角色档位）/ 砍树树（原木/树叶档位手排）/
//   武器（剑>斧）/ 耐久紧急排除 / BUG2 回归（杂物不入池 + 主手不倒腾）。
// 引擎本体 64 例在 packages/tool-strategy/tests，此处只测 mock 侧编排。

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  decideTool,
  decideWeapon,
  isDurabilityUrgent,
  MINE_TREE,
  WOODCUT_TREE,
} from "../scripts/rules/items/ToolStrategyTrees";
import type { ToolCandidate } from "@yinxe/tool-strategy/src/index";

/** 候选工厂（缺省满耐久钻石品阶） */
function cand(over: Partial<ToolCandidate> & { slot: number; typeId: string }): ToolCandidate {
  return {
    role: "pickaxe",
    tier: 5,
    durability: 1000,
    maxDurability: 1000,
    durabilityRatio: 1,
    enchants: {},
    ...over,
  };
}

/** 决策槽位（keep → undefined） */
function swapSlotOf(d: { action: string; tool?: ToolCandidate }): number | undefined {
  return d.action === "swap" ? d.tool?.slot : undefined;
}

describe("MINE_TREE 挖掘决策", () => {
  it("石质 → 镐档位；档内品阶优先", () => {
    const iron = cand({ slot: 2, typeId: "minecraft:iron_pickaxe", tier: 3 });
    const diamond = cand({ slot: 5, typeId: "minecraft:diamond_pickaxe", tier: 5 });
    assert.equal(swapSlotOf(decideTool("minecraft:stone", undefined, [iron, diamond], MINE_TREE)), 5);
  });
  it("木质 → 斧；土质 → 锹（关键字分发）", () => {
    const axe = cand({ slot: 1, typeId: "minecraft:diamond_axe", role: "axe", tier: 5 });
    assert.equal(swapSlotOf(decideTool("minecraft:oak_planks", undefined, [axe], MINE_TREE)), 1);
    const shovel = cand({ slot: 2, typeId: "minecraft:iron_shovel", role: "shovel", tier: 3 });
    assert.equal(swapSlotOf(decideTool("minecraft:dirt", undefined, [shovel], MINE_TREE)), 2);
  });
  it("未映射方块（火把）→ keep 主手不动（无意识挂机不折腾）", () => {
    const pick = cand({ slot: 1, typeId: "minecraft:diamond_pickaxe" });
    const d = decideTool("minecraft:torch", undefined, [pick], MINE_TREE);
    assert.equal(d.action, "keep");
  });
  it("非工具物品不产生候选（BUG2 回归：杂物 0 分当选不再可能）", () => {
    // 快照层 toolRoleOf 非工具不入池；决策层无镐候选 → keep
    const axe = cand({ slot: 1, typeId: "minecraft:diamond_axe", role: "axe" });
    assert.equal(decideTool("minecraft:stone", undefined, [axe], MINE_TREE).action, "keep");
  });
  it("主手已是最优 → keep 不倒腾（BUG2 回归）", () => {
    const current = cand({ slot: 4, typeId: "minecraft:diamond_pickaxe", isCurrent: true });
    const stone = cand({ slot: 2, typeId: "minecraft:stone_pickaxe", tier: 2 });
    assert.equal(decideTool("minecraft:stone", current, [stone], MINE_TREE).action, "keep");
  });
});

describe("WOODCUT_TREE 砍树决策", () => {
  it("原木 → 效率斧档内优先（efficiency 排在 tier 前）", () => {
    const plainDiamond = cand({ slot: 1, typeId: "minecraft:diamond_axe", role: "axe", tier: 5 });
    const effIron = cand({ slot: 2, typeId: "minecraft:iron_axe", role: "axe", tier: 3, enchants: { efficiency: 5 } });
    assert.equal(swapSlotOf(decideTool("minecraft:oak_log", undefined, [plainDiamond, effIron], WOODCUT_TREE)), 2);
  });
  it("树叶 → 档位手排：精准锄 > 剪刀 > 任意精准 > 任意工具", () => {
    const hoe = cand({ slot: 1, typeId: "minecraft:diamond_hoe", role: "hoe", enchants: { silk: 1 } });
    const shears = cand({ slot: 2, typeId: "minecraft:shears", role: "shears", tier: 0 });
    const silkAxe = cand({ slot: 3, typeId: "minecraft:iron_axe", role: "axe", enchants: { silk: 1 } });
    const anyAxe = cand({ slot: 4, typeId: "minecraft:diamond_axe", role: "axe" });
    // 池内全有 → 精准锄
    assert.equal(swapSlotOf(decideTool("minecraft:oak_leaves", undefined, [shears, silkAxe, anyAxe, hoe], WOODCUT_TREE)), 1);
    // 无锄 → 剪刀
    assert.equal(swapSlotOf(decideTool("minecraft:oak_leaves", undefined, [silkAxe, anyAxe, shears], WOODCUT_TREE)), 2);
    // 无锄无剪 → 任意精准
    assert.equal(swapSlotOf(decideTool("minecraft:oak_leaves", undefined, [anyAxe, silkAxe], WOODCUT_TREE)), 3);
    // 只有普通斧 → 任意工具兜底档4
    assert.equal(swapSlotOf(decideTool("minecraft:oak_leaves", undefined, [anyAxe], WOODCUT_TREE)), 4);
  });
});

describe("decideWeapon 攻击决策", () => {
  it("剑 > 同品阶斧（档位手排）", () => {
    const axe = cand({ slot: 1, typeId: "minecraft:diamond_axe", role: "axe" });
    const sword = cand({ slot: 2, typeId: "minecraft:diamond_sword", role: "sword" });
    assert.equal(swapSlotOf(decideWeapon(undefined, [axe, sword])), 2);
  });
  it("锋利附魔档内优先", () => {
    const plain = cand({ slot: 1, typeId: "minecraft:iron_sword", role: "sword", tier: 3 });
    const sharp = cand({ slot: 2, typeId: "minecraft:iron_sword", role: "sword", tier: 3, enchants: { sharpness: 3 } });
    assert.equal(swapSlotOf(decideWeapon(undefined, [plain, sharp])), 2);
  });
  it("无武器候选 → keep（空手也继续打）", () => {
    const pick = cand({ slot: 1, typeId: "minecraft:diamond_pickaxe", role: "pickaxe" });
    assert.equal(decideWeapon(undefined, [pick]).action, "keep");
  });
});

describe("耐久保护（isDurabilityUrgent + 决策排除）", () => {
  it("占比 < 5% 或剩余 < 16 点 → 紧急", () => {
    const low = cand({ slot: 1, typeId: "minecraft:iron_pickaxe", durability: 3, maxDurability: 250, durabilityRatio: 3 / 250 });
    const ok = cand({ slot: 2, typeId: "minecraft:iron_pickaxe", durability: 125, maxDurability: 250, durabilityRatio: 0.5 });
    assert.ok(isDurabilityUrgent(low));
    assert.ok(!isDurabilityUrgent(ok));
  });
  it("无耐久组件（maxDurability=0）恒不紧急（剪刀类）", () => {
    const shears = cand({ slot: 1, typeId: "minecraft:shears", role: "shears", tier: 0, durability: 0, maxDurability: 0, durabilityRatio: 1 });
    assert.ok(!isDurabilityUrgent(shears));
  });
  it("紧急候选被排除：满耐久铁斧当选而非快断钻石斧", () => {
    const urgentDiamond = cand({ slot: 1, typeId: "minecraft:diamond_axe", role: "axe", tier: 5, durability: 2, maxDurability: 1500, durabilityRatio: 2 / 1500 });
    const healthyIron = cand({ slot: 2, typeId: "minecraft:iron_axe", role: "axe", tier: 3, durability: 200, maxDurability: 250, durabilityRatio: 200 / 250 });
    assert.equal(swapSlotOf(decideTool("minecraft:oak_log", undefined, [urgentDiamond, healthyIron], WOODCUT_TREE)), 2);
  });
  it("主手耐久紧急 → 强制参与换装（current 置空走树）", () => {
    const urgentCurrent = cand({ slot: 4, typeId: "minecraft:iron_axe", role: "axe", tier: 3, isCurrent: true, durability: 1, maxDurability: 250, durabilityRatio: 1 / 250 });
    const diamond = cand({ slot: 5, typeId: "minecraft:diamond_axe", role: "axe", tier: 5 });
    assert.equal(swapSlotOf(decideTool("minecraft:oak_log", urgentCurrent, [diamond], WOODCUT_TREE)), 5);
  });
});
