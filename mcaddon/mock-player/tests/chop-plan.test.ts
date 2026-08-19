// ─── core/rules/woodcut — 单棵树的砍伐计划（ChopPlan） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { planChop, refreshTreeResource, RESCAN_RADIUS, treeRescanYRange, type ChopPlan, type ChopTarget } from "../scripts/rules/woodcut/ChopPlan";
import type { TreeResource, TreeFactors } from "../scripts/rules/tree/TreeRules";
import type { Vec3 } from "../scripts/rules/Types";

const FACTORS: TreeFactors = { G: 1, L: 1, C: 1, F: 1, H: 1, A: 1 };

/** 构造一棵小树：3 根竖直圆木（树桩 2 根 + 主干 1 根）+ 顶部 8 邻树叶 */
function makeTree(overrides: Partial<TreeResource> = {}): TreeResource {
  const base: Vec3 = { x: 5.5, y: 64.5, z: 5.5 };
  const logs: Vec3[] = [
    { x: 5.5, y: 64.5, z: 5.5 },
    { x: 5.5, y: 65.5, z: 5.5 },
    { x: 5.5, y: 66.5, z: 5.5 },
    { x: 5.5, y: 67.5, z: 5.5 }, // 主干第 3 根（高出树桩）
  ];
  const leafs: Vec3[] = [
    { x: 5.5, y: 68.5, z: 5.5 },
    ...[-1, 0, 1].flatMap((dx) =>
      [-1, 0, 1].map((dz) => ({ x: 5.5 + dx, y: 68.5, z: 5.5 + dz })),
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

test("planChop（原木模式）：阶段 = 树桩→主干→散落→卡叶清理；圆木底→顶", () => {
  // 散落分支圆木（旁边 1 格，非主干列）+ 树桩下方卡叶树叶
  const extraLog = { x: 6.5, y: 67.5, z: 5.5 };
  const tree = makeTree({
    logs: [...makeTree().logs, { ...extraLog, woodId: "oak" } as never],
    leafs: [makeTree().leafs[0]!, { x: 5.5, y: 63.5, z: 5.5 }],
  });
  const plan = planChop(tree, "logs");
  assert.equal(plan.mode, "logs");
  assert.equal(plan.trunkColumns, 1); // 小树单列
  assert.equal(plan.logsCount, 5); // 4 垂直 + 1 分支

  const stageKinds = plan.stages.map((s) => s.kind);
  assert.deepEqual(stageKinds, ["stump", "trunk", "scattered", "cleanup"]);
  // 树桩：底部 2 根（y=64,65）——1×2×1
  assert.deepEqual(plan.stages[0]!.targets.map((t) => t.loc.y), [64, 65]);
  assert.ok(plan.stages[0]!.targets.every((t) => t.reason === "stump"));
  // 主干：主干列高出树桩（底→顶；含 (5,67)）
  assert.deepEqual(plan.stages[1]!.targets.map((t) => t.loc.y), [66, 67]);
  assert.ok(plan.stages[1]!.targets.every((t) => t.reason === "trunk"));
  // 散落：非主干列分支圆木（(6,67)）
  assert.deepEqual(plan.stages[2]!.targets.map((t) => t.loc.y), [67]);
  assert.ok(plan.stages[2]!.targets.every((t) => t.reason === "scattered"));
  // cleanup：树桩下方卡叶树叶（(5,63)）
  const cleanup = plan.stages.find((s) => s.kind === "cleanup")!;
  assert.deepEqual(cleanup.targets.map((t) => t.loc), [{ x: 5, y: 63, z: 5 }]);
  assert.ok(cleanup.targets.every((t) => t.reason === "stuck-cleanup"));
});

test("planChop（原木模式）拾取范围 = 树中心 7×7（水平 ±3）+ 整树高度", () => {
  const plan = planChop(makeTree(), "logs");
  // 树中心 base=(5,64,5) → x/z [2,8]
  assert.equal(plan.pickupMin.x, 2);
  assert.equal(plan.pickupMax.x, 8);
  assert.equal(plan.pickupMin.z, 2);
  assert.equal(plan.pickupMax.z, 8);
  assert.ok(plan.pickupMin.y <= 63);
  assert.ok(plan.pickupMax.y >= 69);
});

test("planChop（收集模式）：阶段 = 树桩→主干→[散落]→树叶；含全部树叶", () => {
  const tree = makeTree();
  const plan = planChop(tree, "collect");
  const stageKinds = plan.stages.map((s) => s.kind);
  assert.deepEqual(stageKinds, ["stump", "trunk", "leaf"]);
  const leafStage = plan.stages.find((s) => s.kind === "leaf")!;
  assert.equal(leafStage.targets.length, 9); // 7×7 邻域去重后
  assert.ok(leafStage.targets.every((t) => t.reason === "collect-leaf"));
});

test("planChop（大树）：主干列 = 4（2×2 底部脚点）", () => {
  const logs: Vec3[] = [];
  for (const dx of [0, 1]) {
    for (const dz of [0, 1]) {
      // 每列 4 根高（树桩 2 + 主干 2）
      for (let h = 0; h < 4; h++) logs.push({ x: 10.5 + dx, y: 64.5 + h, z: 10.5 + dz });
    }
  }
  const tree = makeTree({ base: { x: 10.5, y: 64.5, z: 10.5 }, logs: logs.map((l) => ({ ...l, woodId: "dark_oak" })) });
  const plan = planChop(tree, "logs");
  assert.equal(plan.trunkColumns, 4);
  assert.equal(plan.stages[0]!.targets.length, 8); // 4 列 × 底部 2 格树桩
  assert.equal(plan.stages[1]!.targets.length, 8); // 4 列 × 主干 2 格
});

test("refreshTreeResource：7×7 重扫结果刷新 logs/leafs/top", () => {
  const old = makeTree();
  const newLogs: Vec3[] = [{ x: 5.5, y: 64.5, z: 5.5 }, { x: 5.5, y: 65.5, z: 5.5 }];
  const newLeafs: Vec3[] = [{ x: 6.5, y: 68.5, z: 5.5 }];
  const refreshed = refreshTreeResource(old, newLogs, newLeafs);
  assert.equal(refreshed.id, old.id); // 保留身份
  assert.equal(refreshed.base.x, old.base.x); // 保留中心
  assert.equal(refreshed.logs.length, 2);
  assert.equal(refreshed.leafs.length, 1);
  assert.equal(Math.floor(refreshed.top.y), 65); // top 取最高新圆木
});

test("treeRescanYRange：自树桩向上扫整树高度（木头全在上面）", () => {
  // base 是树桩/树根：竖向从 base 起（不向下扫——木头都在上面）
  assert.deepEqual(treeRescanYRange(64), { fromY: 64, toY: 76 }); // 无 topY → 默认向上 12 格（覆盖普通 7~10 格树）
  // 已知整树高度 → 精确覆盖 topY+2，零漏扫树顶
  assert.deepEqual(treeRescanYRange(64, 76), { fromY: 64, toY: 78 });
  // 已知 topY → 精确覆盖 topY+2（比默认更准，也不低于 base）
  assert.deepEqual(treeRescanYRange(64, 66), { fromY: 64, toY: 68 });
  // 边界夹取
  assert.ok(treeRescanYRange(-70).fromY >= -64);
  assert.ok(treeRescanYRange(-70, 400).toY <= 320);
  assert.equal(RESCAN_RADIUS, 3); // 7×7 水平
});
