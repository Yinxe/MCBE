// ─── core/tree — 坐标集纯算术评估（logs/leaves 两坐标集） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateTreeFromSets, extractTrunkCandidates, classifyTreeBlock, type TreeLog } from "../scripts/rules/tree/TreeRules";
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

/** 从 MockWorld 提取树叶坐标集（"x,y,z" key） */
function leavesFrom(world: MockWorld, ground: { x: number; y: number; z: number }, span: number): Set<string> {
  const leaves = new Set<string>();
  for (let y = ground.y - 2; y <= ground.y + span; y++) {
    for (let x = ground.x - span; x <= ground.x + span; x++) {
      for (let z = ground.z - span; z <= ground.z + span; z++) {
        if (classifyTreeBlock(world.typeAt(x, y, z)) === "leaf") {
          leaves.add(`${x},${y},${z}`);
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
  const candidates = extractTrunkCandidates(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.accepted, true, JSON.stringify(verdict.factors));
  assert.ok(verdict.probability >= 0.8);
});

test("坐标集评估：深色橡树（2×2 大树）接受", () => {
  const { world } = buildDarkOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidates(logs);
  assert.ok(candidates.length >= 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.kind, "big");
  assert.equal(verdict.accepted, true, JSON.stringify(verdict.factors));
});

test("坐标集评估：无树叶 → no-canopy 拒绝", () => {
  // 光树干（无树冠）
  const world = new MockWorld();
  for (let y = 0; y < 5; y++) world.set(0, y, 0, "minecraft:oak_log");
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 10);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 10);
  const candidates = extractTrunkCandidates(logs);
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
  const candidates = extractTrunkCandidates(logs);
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
  const candidates = extractTrunkCandidates(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.factors.C, 0.4);
  assert.equal(verdict.accepted, false); // 叶量不足 + 薄板 → low-prob
});

test("坐标集评估：厚树冠与树干连通 → C=1 且 A 因子满", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidates(logs);
  const verdict = evaluateTreeFromSets(candidates[0]!, leaves);
  assert.equal(verdict.factors.C, 1);
  assert.ok(verdict.factors.A >= 0.5);
});

test("坐标集评估：木墙（无树冠形态）拒绝", () => {
  const { world } = buildLogWall();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidates(logs);
  // 木墙厚段应被丢弃或拒绝（无树叶）
  const allRejected = candidates.every((c) => !evaluateTreeFromSets(c, leaves).accepted);
  assert.ok(allRejected || candidates.length === 0);
});
