// ─── core/tree — 坐标集纯算术评估（logs/leaves 两坐标集） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import { assignLeafOwnership, coordKey, EMPTY_OWNED_LEAFS, evaluateTreeFromSets, extractTrunkCandidatesSimple, classifyTreeBlock, keyToCoord, treeResourceId, treeCenter, type OwnedLeafSet, type TreeLog } from "../scripts/rules/tree/TreeRules";
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

/** 候选归属集（全局单遍多源 BFS；无归属叶的候选返回空集） */
function ownedOf(candidates: ReturnType<typeof extractTrunkCandidatesSimple>, leaves: Set<number>): Map<number, OwnedLeafSet> {
  return assignLeafOwnership(candidates, leaves);
}

test("坐标集评估：标准橡树接受（logs+leaves 关系）", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  assert.equal(verdict.accepted, true, JSON.stringify(verdict.factors));
  assert.ok(verdict.probability >= 0.8);
});

test("坐标集评估：深色橡树（2×2 大树）直接接受——无需树叶判定", () => {
  const { world } = buildDarkOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.ok(candidates.length >= 1);
  // 空树叶集——2×2 特征明显，直接接受
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, new Set<number>()).get(0) ?? EMPTY_OWNED_LEAFS);
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
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.reason, "no-canopy");
});

// ─── 关系语义 ──────────────────────────────────────────

test("坐标集评估：远处浮空树叶（超归属距离）→ L=0 拒绝", () => {
  const world = new MockWorld();
  for (let y = 0; y < 5; y++) world.set(0, y, 0, "minecraft:oak_log");
  // 树叶在远处（10 格外，超过归属距离 16 的 BFS 也够不到树干附近）——不属任何树
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
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  // 无归属树叶 → 拒绝
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
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  assert.equal(verdict.factors.C, 0.4);
  assert.equal(verdict.accepted, false); // 叶量不足 + 薄板 → low-prob
});

test("坐标集评估：厚树冠 → C=1 且接受（简化因子 L×C×H，无 A）", () => {
  const { world } = buildOak();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 16);
  const candidates = extractTrunkCandidatesSimple(logs);
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  assert.equal(verdict.factors.C, 1);
  assert.equal(verdict.accepted, true);
  assert.equal(verdict.probability, 1); // L=C=H=1 → 1
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
  const verdict = evaluateTreeFromSets(candidates[0]!, EMPTY_OWNED_LEAFS);
  assert.equal(verdict.accepted, true); // 2×2 特征直接判定
  assert.equal(verdict.probability, 1); // 高 4 层 → H=1
});

test("坐标集评估：木墙（无树冠形态）拒绝", () => {
  const { world } = buildLogWall();
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  // 木墙厚段应被丢弃或拒绝（无归属树叶）
  const own = ownedOf(candidates, leaves);
  const allRejected = candidates.every((c, i) => !evaluateTreeFromSets(c, own.get(i) ?? EMPTY_OWNED_LEAFS).accepted);
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
  const verdict = evaluateTreeFromSets(candidates[0]!, EMPTY_OWNED_LEAFS);
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
  // 接受判定携带树叶坐标（verdict 层整数格坐标）：每个坐标都在树叶集内
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
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
  // 直接接受（不传树叶也能过），但传入树叶集时资源点携带真实树叶坐标（verdict 层整数格）
  const verdict = evaluateTreeFromSets(candidates[0]!, ownedOf(candidates, leaves).get(0) ?? EMPTY_OWNED_LEAFS);
  assert.equal(verdict.kind, "big");
  assert.equal(verdict.accepted, true);
  assert.ok(verdict.leafs.length > 0, "大树直接接受也应携带真实树叶坐标");
  for (const c of verdict.leafs) {
    assert.ok(leaves.has(coordKey(c.x, c.y, c.z)), `树叶坐标 ${JSON.stringify(c)} 应在树叶集内`);
  }
});

// ─── 树叶归属（全局单遍多源 BFS） ───────────────────────

test("树叶归属：两棵相邻橡树（树冠交融）→ 每片叶恰属一棵树，波前切割", () => {
  const world = new MockWorld();
  const a = buildOak();
  a.world.cloneInto(world, 0, 0, 0);
  const b = buildOak();
  b.world.cloneInto(world, 3, 0, 0); // 树冠（r2）交融：a 冠 x∈[-2,2]，b 冠 x∈[1,5]
  const logs: TreeLog[] = [
    ...a.logs,
    ...b.logs.map((l) => ({ x: l.x + 3, y: l.y, z: l.z, woodId: l.woodId })),
  ];
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 20);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 2);
  const own = ownedOf(candidates, leaves);
  // 按归属叶 x 均值区分左右两树（不假设候选顺序）
  const both = [own.get(0)!, own.get(1)!];
  const meanX = (o: OwnedLeafSet): number => o.keys.reduce((s, k) => s + keyToCoord(k).x, 0) / o.count;
  const [oa, ob] = meanX(both[0]!) < meanX(both[1]!) ? [both[0]!, both[1]!] : [both[1]!, both[0]!];
  // ① 互斥：同一片叶不可能同时属于两棵树
  const ka = new Set(oa.keys);
  for (const k of ob.keys) assert.ok(!ka.has(k), `树叶 ${keyToCoord(k).x},${keyToCoord(k).y},${keyToCoord(k).z} 不应同时属两棵树`);
  // ② 各自收到树冠主体（单棵橡树树冠 80 叶；交融时波前让出边缘叶）
  assert.ok(oa.count >= 50, `树 A 归属叶 ${oa.count}`);
  assert.ok(ob.count >= 50, `树 B 归属叶 ${ob.count}`);
  // ③ 波前切割确定性：左树叶在 x≤2 侧、右树叶在 x≥1 侧
  for (const k of oa.keys) {
    const c = keyToCoord(k);
    assert.ok(c.x <= 2, `左树叶 (${c.x},${c.y},${c.z}) 应在其树冠侧`);
  }
  for (const k of ob.keys) {
    const c = keyToCoord(k);
    assert.ok(c.x >= 1, `右树叶 (${c.x},${c.y},${c.z}) 应在其树冠侧`);
  }
});

test("树叶归属：孤立叶板（无原木可达）→ 不属任何树", () => {
  const world = new MockWorld();
  const a = buildOak();
  a.world.cloneInto(world, 0, 0, 0);
  // 孤立叶板（远离所有树干，超归属距离）
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      world.set(12 + dx, 30, 12 + dz, "minecraft:oak_leaves");
    }
  }
  const logs = logsFrom(world, { x: 0, y: 0, z: 0 }, 40);
  const leaves = leavesFrom(world, { x: 0, y: 0, z: 0 }, 40);
  const candidates = extractTrunkCandidatesSimple(logs);
  assert.equal(candidates.length, 1);
  const own = ownedOf(candidates, leaves);
  // 树只收到自己的树冠（约 80 叶），孤立叶板不混入
  const oa = own.get(0)!;
  assert.ok(oa.count >= 70 && oa.count <= 90, `树 A 归属叶 ${oa.count} 应约等于单棵橡树树冠`);
  for (const k of oa.keys) {
    const c = keyToCoord(k);
    assert.ok(c.x < 8, `不应包含孤立叶板坐标 (${c.x},${c.y},${c.z})`);
  }
});
