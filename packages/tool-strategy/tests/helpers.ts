// ─── 测试共享辅助（引擎测试通用构造/断言） ─────────────
// 三个测试文件（engine/preset/scenarios）重复的 tool()/swapSlot()
// 收敛于此，避免多份拷贝。

import assert from "node:assert/strict";

import { select } from "../src/index";
import type { ToolCandidate } from "../src/index";

/** 构造工具候选（默认满耐久铁斧；enchants 类型为附魔等级表） */
export function tool(overrides: Partial<ToolCandidate> & { slot: number }): ToolCandidate {
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

/** 断言决策为 swap 并返回换入槽位（非 swap 直接断言失败） */
export function swapSlot(decision: ReturnType<typeof select>): number {
  assert.equal(decision.action, "swap");
  return decision.action === "swap" ? decision.tool.slot : -1;
}
