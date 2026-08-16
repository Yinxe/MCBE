// ─── core/tree — 坐标集纯算术评估（logs/leaves 两坐标集） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { coordKey, evaluateTreeFromSets, extractTrunkCandidatesSimple, classifyTreeBlock, treeResourceId, treeCenter, type TreeLog } from "../scripts/rules/tree/TreeRules";
import { buildOak, buildDarkOak, buildLogWall, MockWorld } from "./helpers/treeFixtures";

/** 从 MockWorld 提取原木坐标集（TreeLog 列表，woodId 按 typeId 简化） */
function logsFrom(world: MockWorld, ground: { x: number; y: number; z: number }, span: number): TreeLog[] {
  const logs: TreeLog[] = [];
  for (let y = ground.y - 2; y <= ground.y + span; y++) {
    for (let x = ground.x - span; x <= ground.x + span; x++) {
      for (let z = ground.z - span; z <= ground.z + span; z++) {
        const typeId = world.typeAt(x, y, z);
        if (classifyTreeBlock(typeId) === "log") {
          const base = typeId.replace("minecraft:", "");
          logs.push({ x, y, z, woodId: base.replace("_log", "").replace("log", "oak") });
        }
      }
    }
  }
  return logs;
}

/** 从 MockWorld 提取树叶坐标集（数字编码 key） */
function leavesFrom(world: MockWorld, ground: { x: number; y: number; z: number }, span: number): Set<number> {
  const leaves = new Set<number>();
  for (let y = ground.y - 2; y <= ground.y + span; y++) {
    for (let x = ground.x - span; x <= ground.x + span; x++) {
      for (let z = ground.z - span; z <= ground.z + span; z++) {
        if (classifyTreeBlock(world.typeAt(x, y, z)) === "leaf") {
          leaves.add(coordKey(x, y, z));
        }
      }
    }
  }
  return leaves;
}

// ─── 基本场景 ──────────────────────────────────────────

test("坐标集评估：标准橡树接受（logs+leaves 关系）", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.accepted, true, JSON.stringify(verdict.factors));
  assert.ok(verdict.probability >= 0.8);
});

test("坐标集评估：深色橡树（2×2 大树）直接接受——无需树叶判定", () => {
  const { world } = buildDarkOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.ok(candidates.length >= 1);
  // 不传树叶集（空 Set）——2×2 特征明显，直接接受
  const verdict = evaluateTreeFromSets(candidates[0]!, new Set<number>());
  assert.equal(verdict.kind, "big");
  assert.equal(verdict.accepted, true, JSON.stringify(verdict.factors));
});

test("坐标集评估：无树叶 → no-canopy 拒绝", () => {
  // 光树干（无树冠）
  const world = new MockWorld();
  for (let y = 0; y < 5; y++) world.set(0, y, 0, "minecraft:oak_log");
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 10);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 10);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, "no-canopy");
});

// ─── 关系语义 ──────────────────────────────────────────

test("坐标集评估：浮空树叶（不贴原木）→ A=0 拒绝", () => {
  const world = new MockWorld();
  for (let y = 0; y < 5; y++) world.set(0, y, 0, "minecraft:oak_log");
  // 树叶在远处（不贴树干）——应 A=0
  for (let y = 8; y < 12; y++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0) continue;
        world.set(10 + dx, y, 10 + dz, "minecraft:oak_leaves");
      }
    }
  }
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  // 区域内无树叶或树叶不连通 → 拒绝
  assert.equal(verdict.accepted, false);
});

test("坐标集评估：单层树叶薄板 → C=0.4 低概率", () => {
  const world = new MockWorld();
  for (let y = 0; y < 5; y++) world.set(0, y, 0, "minecraft:oak_log");
  // 单层树叶（y=5 一层，贴原木顶部）
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.set(dx, 5, dz, "minecraft:oak_leaves");
    }
  }
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 12);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 12);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.factors.C, 0.4);
  assert.equal(verdict.accepted, false); // 叶量不足 + 薄板 → low-prob
});

test("坐标集评估：厚树冠与树干连通 → C=1 且 A 因子满", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidatesSimple(logs);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.factors.C, 1);
  assert.ok(verdict.factors.A >= 0.5);
});

test("坐标集评估：纯 2×2 原木柱（无树叶）按大树接受", () => {
  const world = new MockWorld();
  // 2×2 柱 4 层（恒 2×2 段）
  for (let y = 0; y < 4; y++) {
    world.set(0, y, 0, "minecraft:dark_oak_log");
    world.set(1, y, 0, "minecraft:dark_oak_log");
    world.set(0, y, 1, "minecraft:dark_oak_log");
    world.set(1, y, 1, "minecraft:dark_oak_log");
  }
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 8);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.kind, "big");
  const verdict = evaluateTreeFromSets(candidates[0]!, new Set<number>());
  assert.equal(verdict.accepted, true); // 2×2 特征直接判定
  assert.equal(verdict.probability, 1); // 高 4 层 → H=1
});

test("坐标集评估：木墙（无树冠形态）拒绝", () => {
  const { world } = buildLogWall();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  // 木墙厚段应被丢弃或拒绝（无树叶）
  const allRejected = candidates.every((c) => !evaluateTreeFromSets(c, leaves).accepted);
  assert.ok(allRejected || candidates.length === 0);
});

test("坐标集评估：矮 2×2（2 层）不直接接受——无树叶拒绝", () => {
  const world = new MockWorld();
  for (let y = 0; y < 2; y++) {
    world.set(0, y, 0, "minecraft:dark_oak_log");
    world.set(1, y, 0, "minecraft:dark_oak_log");
    world.set(0, y, 1, "minecraft:dark_oak_log");
    world.set(1, y, 1, "minecraft:dark_oak_log");
  }
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 8);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.kind, "big");
  // 高 2 层 → H=0.5 < 0.8 → 不直接接受；无树叶 → 拒绝
  const verdict = evaluateTreeFromSets(candidates[0]!, new Set<number>());
  assert.equal(verdict.accepted, false);
});

// ─── 树资源点数据（锚点坐标/唯一 ID/树叶坐标） ──────────

test("树资源点：小树中心=单根原木的方块中心（blockCenter），ID 由中心构建，树叶坐标齐全", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  // 中心：单柱橡树最低层原木 (0,1,0) 的方块中心 = (0.5,1.5,0.5)
  const center = treeCenter(candidates[0]!);
  assert.deepEqual(center, { x: 0.5, y: 1.5, z: 0.5 });
  assert.equal(treeResourceId(center), "tree@(0,1,0)");
  // 接受判定携带树叶坐标：每个坐标都在树叶集内
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.accepted, true);
  assert.ok(verdict.leafs.length > 0);
  for (const c of verdict.leafs) {
    assert.ok(leaves.has(coordKey(c.x, c.y, c.z)), `树叶坐标 ${JSON.stringify(c)} 应在树叶集内`);
  }
});

test("树资源点：大树中心=2×2 底部左下角原木的方块中心，直接接受也携带真实树叶坐标", () => {
  const { world } = buildDarkOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.ok(candidates.length >= 1);
  // 中心：2×2（x∈{0,1}, z∈{0,1}）底部左下角原木 (0,1,0) 的方块中心
  const center = treeCenter(candidates[0]!);
  assert.deepEqual(center, { x: 0.5, y: 1.5, z: 0.5 });
  assert.equal(treeResourceId(center), "tree@(0,1,0)");
  // 直接接受（不传树叶也能过），但传入树叶集时资源点携带真实树叶坐标
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.kind, "big");
  assert.equal(verdict.accepted, true);
  assert.ok(verdict.leafs.length > 0, "大树直接接受也应携带真实树叶坐标");
  for (const c of verdict.leafs) {
    assert.ok(leaves.has(coordKey(c.x, c.y, c.z)), `树叶坐标 ${JSON.stringify(c)} 应在树叶集内`);
  }
});
