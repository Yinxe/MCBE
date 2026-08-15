// ─── core/structure — 通用结构搜索（聚类/区域/模板匹配） ──

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  candidateFromCluster,
  clusterSeeds,
  horizontalDistance,
  matchPattern,
  matchPatternAtSeed,
  regionBoundsOf,
  type PatternBlock,
  type ScanSeed,
  type StructurePattern,
} from "../scripts/rules/structure/StructureScan";

/** 构造种子 */
function seed(x: number, y: number, z: number, kind = "a"): ScanSeed {
  return { x, y, z, kind };
}

// ─── clusterSeeds（3D 连通聚类） ───────────────────────

test("clusterSeeds：相邻种子聚为一簇（26 邻连通）", () => {
  const clusters = clusterSeeds([
    seed(0, 0, 0), seed(1, 0, 0), seed(0, 1, 0),  // 簇 A
    seed(10, 0, 10), seed(10, 1, 10),            // 簇 B
  ]);
  assert.equal(clusters.length, 2);
  const sizes = clusters.map((c) => c.seeds.length).sort((a, b) => a - b);
  assert.deepEqual(sizes, [2, 3]);
});

test("clusterSeeds：垂直连续种子合并（跨层 26 邻）", () => {
  const clusters = clusterSeeds([seed(0, 0, 0), seed(0, 1, 0), seed(0, 2, 0)]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.minY, 0);
  assert.equal(clusters[0]!.maxY, 2);
});

test("clusterSeeds：断层不合并（y 跳跃）", () => {
  const clusters = clusterSeeds([seed(0, 0, 0), seed(0, 2, 0)]); // 中间缺 y=1
  assert.equal(clusters.length, 2);
});

test("clusterSeeds：sameKind 分组——异类种子不合并", () => {
  const clusters = clusterSeeds([seed(0, 0, 0, "oak"), seed(1, 0, 0, "spruce")], 1, true);
  assert.equal(clusters.length, 2);
});

test("clusterSeeds：sameKind=false 时异类合并", () => {
  const clusters = clusterSeeds([seed(0, 0, 0, "oak"), seed(1, 0, 0, "spruce")], 1, false);
  assert.equal(clusters.length, 1);
});

test("clusterSeeds：radius=2 时两格间隔种子合并", () => {
  const clusters = clusterSeeds([seed(0, 0, 0), seed(2, 0, 0)], 2);
  assert.equal(clusters.length, 1);
});

test("clusterSeeds：footprint = 最底层种子水平位置", () => {
  const clusters = clusterSeeds([seed(0, 1, 0), seed(1, 0, 0), seed(0, 0, 0)]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]!.footprint.length, 2); // y=0 层两个种子
});

// ─── candidateFromCluster / regionBoundsOf ─────────────

test("regionBoundsOf：bbox ± pad + 垂直默认高度", () => {
  const cluster = clusterSeeds([seed(0, 3, 0), seed(1, 3, 0)])[0]!;
  const candidate = candidateFromCluster(cluster);
  const bounds = regionBoundsOf(candidate, 2, 10, 8);
  assert.deepEqual(
    { minX: bounds.minX, maxX: bounds.maxX, minZ: bounds.minZ, maxZ: bounds.maxZ },
    { minX: -2, maxX: 3, minZ: -2, maxZ: 2 },
  );
  assert.equal(bounds.groundY, 2); // baseY-1
  assert.equal(bounds.regionTop, 12); // max(baseY+10-1=12, topY+8=11)
  assert.equal(bounds.bottomCells, 6 * 5); // 6×5（minX=-2..maxX=3）
});

test("regionBoundsOf：高结构自动加高（topY + 余量）", () => {
  // y 连续种子（11/12/13 层，垂直邻接）
  const cluster = clusterSeeds([seed(0, 11, 0), seed(0, 12, 0), seed(0, 13, 0)])[0]!;
  const candidate = candidateFromCluster(cluster);
  const bounds = regionBoundsOf(candidate, 2, 10, 8);
  assert.equal(bounds.regionTop, 21); // max(baseY+10-1=20, topY 13+8=21) → 加高生效
});

// ─── matchPattern（模板匹配） ──────────────────────────

/** 简单方块世界（typeId 直接作类别） */
function makeWorld(blocks: Record<string, string>): (x: number, y: number, z: number) => string {
  return (x, y, z) => blocks[`${x},${y},${z}`] ?? "air";
}

/** 底座+支柱+顶部 模板 */
function pillarPattern(): StructurePattern {
  return {
    name: "pillar",
    blocks: [
      { dx: 0, dy: 0, dz: 0, kind: "stone" },       // 底座（锚点）
      { dx: 0, dy: 1, dz: 0, kind: "oak_log" },     // 支柱
      { dx: 0, dy: 2, dz: 0, kind: "oak_log" },
      { dx: 0, dy: 3, dz: 0, kind: "torch", optional: true }, // 顶灯（可选）
    ],
  };
}

test("matchPattern：完整匹配", () => {
  const world = makeWorld({
    "0,0,0": "stone", "0,1,0": "oak_log", "0,2,0": "oak_log", "0,3,0": "torch",
  });
  const m = matchPattern(pillarPattern(), 0, 0, 0, world);
  assert.equal(m.matched, true);
  assert.equal(m.missing.length, 0);
  assert.equal(m.score, 1);
});

test("matchPattern：缺失非可选块 → 不匹配 + 缺失诊断", () => {
  const world = makeWorld({
    "0,0,0": "stone", "0,1,0": "oak_log", "0,2,0": "air",
  });
  const m = matchPattern(pillarPattern(), 0, 0, 0, world);
  assert.equal(m.matched, false);
  assert.deepEqual(m.missing.map((b) => `${b.dx},${b.dy},${b.dz}`), ["0,2,0"]);
  assert.equal(m.score, 2 / 3); // 3 个非可选命中 2
});

test("matchPattern：可选块缺失不判失败（匹配度降级）", () => {
  const world = makeWorld({
    "0,0,0": "stone", "0,1,0": "oak_log", "0,2,0": "oak_log",
  });
  const m = matchPattern(pillarPattern(), 0, 0, 0, world);
  assert.equal(m.matched, true); // torch 可选，缺失仍匹配
  assert.equal(m.score, 1);
});

test("matchPattern：锚点类别不符 → 不匹配", () => {
  const world = makeWorld({
    "0,0,0": "dirt", "0,1,0": "oak_log", "0,2,0": "oak_log",
  });
  const m = matchPattern(pillarPattern(), 0, 0, 0, world);
  assert.equal(m.matched, false);
});

// ─── matchPatternAtSeed（种子推导锚点） ────────────────

test("matchPatternAtSeed：种子为支柱块 → 推导锚点命中", () => {
  const world = makeWorld({
    "0,0,0": "stone", "0,1,0": "oak_log", "0,2,0": "oak_log",
  });
  // 种子 = 支柱下层 (0,1,0)，应推导锚点 (0,0,0)
  const hits = matchPatternAtSeed(pillarPattern(), { x: 0, y: 1, z: 0 }, world);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0]!.anchor, { x: 0, y: 0, z: 0 });
  assert.equal(hits[0]!.match.matched, true);
});

test("matchPatternAtSeed：种子不构成任何模板块 → 无命中", () => {
  const world = makeWorld({ "5,5,5": "air" });
  const hits = matchPatternAtSeed(pillarPattern(), { x: 5, y: 5, z: 5 }, world);
  assert.equal(hits.length, 0);
});

test("matchPatternAtSeed：多个种子命中同一锚点 → 去重", () => {
  const world = makeWorld({
    "0,0,0": "stone", "0,1,0": "oak_log", "0,2,0": "oak_log",
  });
  const hitsA = matchPatternAtSeed(pillarPattern(), { x: 0, y: 1, z: 0 }, world);
  const hitsB = matchPatternAtSeed(pillarPattern(), { x: 0, y: 2, z: 0 }, world);
  // 各自去重后合并（引擎层按锚点 Set 再聚合）
  const anchors = new Set([...hitsA, ...hitsB].map((h) => `${h.anchor.x},${h.anchor.y},${h.anchor.z}`));
  assert.deepEqual([...anchors], ["0,0,0"]);
});

// ─── horizontalDistance ────────────────────────────────

test("horizontalDistance：水平距离（忽略 Y）", () => {
  assert.equal(horizontalDistance({ x: 0, y: 99, z: 0 }, { x: 3, y: 0, z: 4 }), 5);
});
