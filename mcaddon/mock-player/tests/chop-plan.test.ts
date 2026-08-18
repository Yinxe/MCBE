// ─── core/rules/woodcut — 单棵树的砍伐计划（ChopPlan） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { planChop, type ChopPlan, type ChopTarget } from "../scripts/rules/woodcut/ChopPlan";
import type { TreeResource, TreeFactors } from "../scripts/rules/tree/TreeRules";
import type { Vec3 } from "../scripts/rules/Types";

const FACTORS: TreeFactors = { G: 1, L: 1, C: 1, F: 1, H: 1, A: 1 };

/** 构造一棵小树：3 根竖直圆木 + 顶部 8 邻树叶（含卡叶场景可配） */
function makeTree(overrides: Partial<TreeResource> = {}): TreeResource {
  const base: Vec3 = { x: 5.5, y: 64.5, z: 5.5 };
  const logs: Vec3[] = [
    { x: 5.5, y: 64.5, z: 5.5 },
    { x: 5.5, y: 65.5, z: 5.5 },
    { x: 5.5, y: 66.5, z: 5.5 },
  ];
  const leafs: Vec3[] = [
    { x: 5.5, y: 67.5, z: 5.5 },
    ...[-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map((dz) => ({ x: 5.5 + dx, y: 67.5, z: 5.5 + dz })),
    ),
  ];
  return {
    id: "tree@(5,64,5)",
    kind: "small",
    probability: 1,
    factors: FACTORS,
    base,
    top: { x: 5.5, y: 66.5, z: 5.5 },
    footprint: [{ x: 5.5, y: 63.5, z: 5.5 }],
    logs: logs.map((l) => ({ x: l.x, y: l.y, z: l.z, woodId: "oak" })),
    leafs,
    ...overrides,
  };
}

function targetAt(plan: ChopPlan, x: number, y: number, z: number): ChopTarget | undefined {
  return plan.targets.find((t) => t.loc.x === x && t.loc.y === y && t.loc.z === z);
}

test("planChop（原木模式）：含全部圆木 + 侧面挡叶 blocker + 顶部树叶在收集前仍计划", () => {
  const plan = planChop(makeTree(), "logs");
  assert.equal(plan.mode, "logs");
  assert.equal(plan.treeId, "tree@(5,64,5)");
  // 全部 3 根圆木都在计划里
  assert.equal(plan.logsCount, 3);
  for (const y of [64, 65, 66]) {
    const t = targetAt(plan, 5, y, 5);
    assert.ok(t, `圆木 (5,${y},5) 应在计划中`);
    assert.equal(t!.kind, "log");
    assert.equal(t!.reason, "log");
  }
  // 圆木从底到顶排序（先破除树桩，再向上逐根砍——用户规格）
  const logYs = plan.targets.filter((t) => t.kind === "log").map((t) => t.loc.y);
  assert.deepEqual(logYs, [64, 65, 66]);
  // 顶部树叶 (5,67,5) 在原木模式不强制（非侧面挡叶）→ 不作为 blocker
  assert.equal(targetAt(plan, 5, 67, 5), undefined);
  // 拾取范围覆盖 logs+leafs（含余量）
  assert.ok(plan.pickupMin.y <= 63);
  assert.ok(plan.pickupMax.y >= 68);
});

test("planChop（收集模式）：包含全部圆木 + 全部树叶（完整破除树形）", () => {
  const plan = planChop(makeTree(), "collect");
  assert.equal(plan.logsCount, 3);
  // 收集模式：顶部 8 邻树叶去重后全数入列（3×3 邻域 9 格 + 顶端 = 9 唯一格）
  const leafCount = plan.targets.filter((t) => t.kind === "leaf").length;
  assert.equal(leafCount, 9);
  // 树叶 reason = collect-leaf
  assert.ok(plan.targets.filter((t) => t.kind === "leaf").every((t) => t.reason === "collect-leaf"));
});

test("planChop（原木模式 + 侧面挡叶）：有树叶横贴圆木 → 先破除再挖", () => {
  // 让 (6,65,5) 成为 side leaf 挡住中间那根圆木
  const leafs = makeTree().leafs.filter((l) => !(Math.floor(l.x) === 6 && Math.floor(l.y) === 65 && Math.floor(l.z) === 5));
  leafs.push({ x: 6.5, y: 65.5, z: 5.5 });
  const plan = planChop(makeTree({ leafs }), "logs");
  const blocker = targetAt(plan, 6, 65, 5);
  assert.ok(blocker, "侧面挡叶应入 plan");
  assert.equal(blocker!.kind, "leaf");
  assert.equal(blocker!.reason, "blocker-leaf");
});

test("planChop（卡叶清理）：圆木正下方是树叶 → 加 stuck-cleanup 目标", () => {
  // 让 (5,63,5) 是树叶（模拟圆木靠在树叶平台上——掉落物会卡叶）
  const leafs = [...makeTree().leafs, { x: 5.5, y: 63.5, z: 5.5 }];
  const plan = planChop(makeTree({ leafs }), "logs");
  const cleanup = targetAt(plan, 5, 63, 5);
  assert.ok(cleanup, "圆木下方树叶应作为 stuck-cleanup 入 plan");
  assert.equal(cleanup!.reason, "stuck-cleanup");
});

test("planChop：去重——同一格不会重复出现（blocker 与 collect/stuck 冲突时去重）", () => {
  const plan = planChop(makeTree(), "collect");
  const keys = plan.targets.map((t) => `${t.loc.x},${t.loc.y},${t.loc.z}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("planChop（障碍）：world.isSolidForeign 返回 true 的非树叶实心物 → blocker-obstacle", () => {
  // 模拟一块泥土横贴在中间圆木侧面
  const world = { isSolidForeign: (loc: Vec3) => Math.floor(loc.x) === 6 && Math.floor(loc.y) === 65 && Math.floor(loc.z) === 5 };
  const plan = planChop(makeTree(), "logs", world);
  const obstacle = targetAt(plan, 6, 65, 5);
  assert.ok(obstacle, "实心障碍应入 plan");
  assert.equal(obstacle!.reason, "blocker-obstacle");
});

test("planChop（收集模式 + 障碍）：不破外围障碍（收集只指整棵树 = logs+leaves）", () => {
  const world = { isSolidForeign: (loc: Vec3) => Math.floor(loc.x) === 6 && Math.floor(loc.y) === 65 && Math.floor(loc.z) === 5 };
  const plan = planChop(makeTree(), "collect", world);
  // 收集模式只有树内圆木/树叶目标，没有任何 blocker-obstacle
  assert.equal(plan.targets.filter((t) => t.reason === "blocker-obstacle").length, 0);
  // 树叶目标但仍完整覆盖 tree leafs
  assert.equal(plan.targets.filter((t) => t.kind === "leaf").length, 9);
});

test("planChop（障碍关闭）：world 不报障碍 → 无 blocker-obstacle", () => {
  const world = { isSolidForeign: () => false };
  const plan = planChop(makeTree(), "logs", world);
  assert.equal(plan.targets.filter((t) => t.reason === "blocker-obstacle").length, 0);
});
