// ─── core/rules — 树资源判定规则（小树/大树两套概率算法） ─────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BIG_CORE_SIZE,
  classifyTreeBlock,
  evaluateCandidates,
  evaluateCandidatesCached,
  evaluateTree,
  extractTrunkCandidates,
  horizontalDistance,
  MIN_TRUNK_HEIGHT,
  scanTreeResources,
  TREE_PROBABILITY_THRESHOLD,
  type TreeLog,
  type TreeScanResult,
} from "../scripts/rules/tree/TreeRules";
import {
  MockWorld,
  buildAcacia,
  buildBigNoCanopy,
  buildBigStoneTop,
  buildBirch,
  buildBuriedTrunk,
  buildCliffOak,
  buildDarkOak,
  buildDecorPillar3x3,
  buildDecorPillar5x5x2,
  buildDoubleOak,
  buildDenseTriple,
  buildFloatingOak,
  buildJungleBig,
  buildJungleBigBranched,
  buildLogCabin,
  buildLogPillar,
  buildLogWall,
  buildOakWithDetachedCap,
  buildMangrove,
  buildMegaPine,
  buildMegaSpruce,
  buildOak,
  buildOakCluttered,
  buildPine,
  buildSlopeOak,
  buildSpruce,
  buildVillageHut,
  column,
  layGround,
  leafDisk,
  trunk,
} from "./helpers/treeFixtures";

// ─── 常量精确值 ────────────────────────────────────────

test("常量：阈值/树干最低高度/大树核心边长精确值", () => {
  assert.equal(TREE_PROBABILITY_THRESHOLD, 0.8);
  assert.equal(MIN_TRUNK_HEIGHT, 2);
  assert.equal(BIG_CORE_SIZE, 2);
});

// ─── 方块分类 ──────────────────────────────────────────

test("方块分类：空气/自然地面（含耕地草径水）", () => {
  assert.equal(classifyTreeBlock("minecraft:air"), "air");
  for (const id of ["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:farmland", "minecraft:dirt_path", "minecraft:water", "minecraft:mud"]) {
    assert.equal(classifyTreeBlock(id), "ground", id);
  }
});

test("方块分类：自然原木（新旧 id 形态）", () => {
  for (const id of ["minecraft:log", "minecraft:log2", "minecraft:oak_log", "minecraft:spruce_log", "minecraft:acacia_log", "minecraft:dark_oak_log", "minecraft:mangrove_log", "minecraft:cherry_log", "minecraft:pale_oak_log"]) {
    assert.equal(classifyTreeBlock(id), "log", id);
  }
});

test("方块分类：树叶（含杜鹃树叶）", () => {
  for (const id of ["minecraft:leaves", "minecraft:leaves2", "minecraft:oak_leaves", "minecraft:jungle_leaves", "minecraft:azalea_leaves", "minecraft:flowering_azalea_leaves", "minecraft:pale_oak_leaves"]) {
    assert.equal(classifyTreeBlock(id), "leaf", id);
  }
});

test("方块分类：自然附属不算异物（藤蔓/红树根/蜂巢）", () => {
  assert.equal(classifyTreeBlock("minecraft:vine"), "aux");
  assert.equal(classifyTreeBlock("minecraft:mangrove_roots"), "aux");
  assert.equal(classifyTreeBlock("minecraft:bee_nest"), "aux");
});

test("方块分类：自然植被不算异物（草/花/蕨/菌/树苗/郁金香/竹子）", () => {
  for (const id of ["minecraft:short_grass", "minecraft:tallgrass", "minecraft:dandelion", "minecraft:fern", "minecraft:large_fern", "minecraft:brown_mushroom", "minecraft:red_mushroom", "minecraft:oak_sapling", "minecraft:birch_sapling", "minecraft:red_tulip", "minecraft:orange_tulip", "minecraft:dead_bush", "minecraft:sunflower", "minecraft:torchflower", "minecraft:bamboo"]) {
    assert.equal(classifyTreeBlock(id), "aux", id);
  }
  assert.equal(classifyTreeBlock("minecraft:melon_block"), "aux"); // 雨林西瓜
  assert.equal(classifyTreeBlock("minecraft:cactus"), "foreign");
  assert.equal(classifyTreeBlock("minecraft:sugarcane"), "foreign");
});

test("方块分类：地面覆盖物不算异物（枯叶堆/粉瓣花——苍白橡树林/樱花林常态）", () => {
  assert.equal(classifyTreeBlock("minecraft:leaf_litter"), "aux");
  assert.equal(classifyTreeBlock("minecraft:pink_petals"), "aux");
});

test("方块分类：加工品/建筑方块一律异物（stripped/wood/planks/圆石/石砖）", () => {
  for (const id of ["minecraft:stripped_oak_log", "minecraft:oak_wood", "minecraft:oak_planks", "minecraft:glass", "minecraft:stone_bricks", "minecraft:cobblestone", "minecraft:chest", "minecraft:fence"]) {
    assert.equal(classifyTreeBlock(id), "foreign", id);
  }
});

test("方块分类：天然岩石算地形（石头是山体的自然方块，用户拍板）", () => {
  for (const id of ["minecraft:stone", "minecraft:deepslate", "minecraft:andesite", "minecraft:diorite", "minecraft:granite", "minecraft:tuff", "minecraft:calcite", "minecraft:basalt", "minecraft:blackstone"]) {
    assert.equal(classifyTreeBlock(id), "ground", id);
  }
});

// ─── 树干提取 ──────────────────────────────────────────

function candidateOf(builder: () => { world: MockWorld; logs: TreeLog[] }) {
  return extractTrunkCandidates(builder().logs);
}

test("提取：1×1 直干 → 小树候选（5 层）", () => {
  const cs = candidateOf(buildOak);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "small");
  assert.equal(cs[0]!.logs.length, 5);
  assert.equal(cs[0]!.baseY, 1);
  assert.equal(cs[0]!.topY, 5);
  assert.equal(cs[0]!.footprint.length, 1);
});

test("提取：金合欢斜干+分叉 → 小树候选（每层 ≤2 兼容）", () => {
  const cs = candidateOf(buildAcacia);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "small");
  assert.equal(cs[0]!.logs.length, 7);
  assert.equal(cs[0]!.topY - cs[0]!.baseY + 1, 6);
});

test("提取：双生 2×1（每层 2 块）→ 单棵小树候选", () => {
  const cs = candidateOf(buildDoubleOak);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "small");
  assert.equal(cs[0]!.logs.length, 10);
  assert.equal(cs[0]!.footprint.length, 2);
});

test("提取：密集三角形三棵（每层 3 块）→ 合并单棵小树候选（密植交融兼容）", () => {
  const cs = candidateOf(buildDenseTriple);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "small");
  assert.equal(cs[0]!.logs.length, 15); // 5+6+4 合并
});

test("提取：1×4 原木矮墙 → 小树候选产生，评估层无树冠拒绝（墙体安全）", () => {
  const r = scanOf(buildLogWall);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "no-canopy");
});

test("提取：2×2 恒柱 → 大树候选", () => {
  const world = new MockWorld();
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= 6; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs: TreeLog[] = cells.map(([x = 0, y = 0, z = 0]) => ({ x, y, z, woodId: "dark_oak" }));
  const cs = extractTrunkCandidates(logs);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "big");
  assert.equal(cs[0]!.logs.length, 24);
  assert.equal(cs[0]!.footprint.length, 4);
});

test("提取：深色橡树加宽层断链——树干 2×2 段仍为大树候选", () => {
  const cs = candidateOf(buildDarkOak);
  assert.equal(cs.length, 1);
  assert.equal(cs[0]!.kind, "big");
  assert.equal(cs[0]!.logs.length, 20); // 2×2 × 5 层（加宽层 8 块被断掉）
  assert.equal(cs[0]!.topY, 5);
});

test("提取：3×3 原木小屋 → 无候选（超 2×2 横截面整体丢弃，绝不砍建筑）", () => {
  const cs = candidateOf(buildLogCabin);
  assert.equal(cs.length, 0);
});

test("提取：单根原木（丛林灌木）→ 无候选（高度 <2）", () => {
  const world = new MockWorld();
  const logs: TreeLog[] = [{ x: 0, y: 1, z: 0, woodId: "jungle" }];
  assert.equal(extractTrunkCandidates(logs).length, 0);
});

test("提取：水平原木（倒下的树）→ 无候选（无垂直成链）", () => {
  const logs: TreeLog[] = [
    { x: 0, y: 1, z: 0, woodId: "oak" },
    { x: 1, y: 1, z: 0, woodId: "oak" },
    { x: 2, y: 1, z: 0, woodId: "oak" },
    { x: 3, y: 1, z: 0, woodId: "oak" },
  ];
  assert.equal(extractTrunkCandidates(logs).length, 0);
});

test("提取：混型原木柱（oak+spruce 堆叠）→ 按型拆链，互不合并", () => {
  const logs: TreeLog[] = [
    { x: 0, y: 1, z: 0, woodId: "oak" },
    { x: 0, y: 2, z: 0, woodId: "oak" },
    { x: 0, y: 3, z: 0, woodId: "spruce" },
    { x: 0, y: 4, z: 0, woodId: "spruce" },
  ];
  const cs = extractTrunkCandidates(logs);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.kind === "small"));
  assert.deepEqual(cs.map((c) => c.woodId).sort(), ["oak", "spruce"]);
});

// ─── 小树算法（概率分带校准） ──────────────────────────

function scanOf(builder: () => { world: MockWorld; logs: TreeLog[] }): TreeScanResult {
  const { world, logs } = builder();
  return scanTreeResources(logs, world.provider);
}

function firstAccepted(result: TreeScanResult) {
  return result.trees[0];
}

test("小树：普通橡树 → 接受（P ≥ 0.8，因子全满）", () => {
  const r = scanOf(buildOak);
  const t = firstAccepted(r);
  assert.ok(t, "应有树资源");
  assert.equal(t.kind, "small");
  assert.ok(t.probability >= TREE_PROBABILITY_THRESHOLD, `P=${t.probability}`);
  assert.deepEqual(t.factors, { G: 1, L: 1, C: 1, F: 1, H: 1, A: 1 });
  assert.equal(t.base[0]!.y, 1);
  // 树资源点完整数据：中心=最低层原木（1 点）、唯一 ID、树叶坐标（与 leafCount 同口径）
  assert.deepEqual(t.base, [{ x: 0, y: 1, z: 0 }]);
  assert.equal(t.id, "tree@(0,1,0)");
  assert.equal(t.leafCoords.length, t.leafCount);
  assert.ok(t.leafCoords.length > 0);
});

test("小树：云杉锥形树冠 → 接受", () => {
  const t = firstAccepted(scanOf(buildSpruce));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
});

test("小树：松树稀疏顶冠（11 叶）→ 接受", () => {
  const t = firstAccepted(scanOf(buildPine));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
});

test("小树：白桦 → 接受", () => {
  const t = firstAccepted(scanOf(buildBirch));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
});

test("小树：金合欢斜干分叉+宽扁树冠 → 接受（树冠厚 2 层，C=1）", () => {
  const t = firstAccepted(scanOf(buildAcacia));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.factors.C, 1);
});

test("小树：红树（水地基+根部，根在树干正下方）→ 接受（根=支撑）", () => {
  const t = firstAccepted(scanOf(buildMangrove));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability} G=${t?.factors.G}`);
});

test("小树：双生 2×1 橡树 → 作为单棵资源接受", () => {
  const t = firstAccepted(scanOf(buildDoubleOak));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.logs.length, 10);
});

test("小树：密集森林三棵交叉（1 格间距三角形+树冠交融）→ 合并单棵资源接受", () => {
  const t = firstAccepted(scanOf(buildDenseTriple));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.logs.length, 15); // 5+6+4 合并砍伐
});

test("小树：悬崖边橡树（底部层半边空气）→ 接受（G 软因子容错）", () => {
  const t = firstAccepted(scanOf(buildCliffOak));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability} G=${t?.factors.G}`);
});

test("小树：真实森林地表（9 株植被环绕）→ 接受（植被不算异物，F=1）", () => {
  const t = firstAccepted(scanOf(buildOakCluttered));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability} F=${t?.factors.F}`);
  assert.equal(t.factors.F, 1);
});

test("小树：山坡橡树（坡面草方块/泥土在原木同层=地形）→ 接受（游戏实测场景）", () => {
  const t = firstAccepted(scanOf(buildSlopeOak));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability} F=${t?.factors.F}`);
  assert.equal(t.factors.F, 1); // 地形不算异物
});

test("小树：橡树+侧上方独立叶簇（窗口边缘隔 2 格）→ 接受（A 主干连通团 ≥50% = 1）", () => {
  const t = firstAccepted(scanOf(buildOakWithDetachedCap));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability} A=${t?.factors.A}`);
  assert.equal(t.factors.A, 1); // 邻树树冠混入窗口边缘不惩罚
});

test("小树：装饰柱+3×3 单层叶板 → 拒绝（C=0.4 薄板，P ≤ 0.45）", () => {
  const r = scanOf(buildDecorPillar3x3);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "low-prob");
  assert.ok(r.rejected[0]!.probability <= 0.45, `P=${r.rejected[0]?.probability}`);
});

test("小树：4 格柱+5×5×2 双层叶板 → 接受（长成树样，视为小树）", () => {
  const t = firstAccepted(scanOf(buildDecorPillar5x5x2));
  assert.ok(t && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.kind, "small");
});

test("小树：原木柱（无树冠）→ 拒绝 no-canopy", () => {
  const r = scanOf(buildLogPillar);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "no-canopy");
});

test("小树：悬空树（脚下无地面）→ 拒绝 no-ground", () => {
  const r = scanOf(buildFloatingOak);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "no-ground");
});

test("小树：圆石埋树干（圆石围住下部）→ 拒绝（圆石=建筑方块，F 击杀，P ≤ 0.65）", () => {
  const r = scanOf(buildBuriedTrunk);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "low-prob");
  assert.ok(r.rejected[0]!.probability <= 0.65, `P=${r.rejected[0]?.probability}`);
});

test("小树：村庄小屋（柱+屋顶+木板墙）→ 拒绝（F 异物击杀）", () => {
  const r = scanOf(buildVillageHut);
  assert.equal(r.trees.length, 0);
  assert.ok(r.rejected[0]!.probability <= 0.45, `P=${r.rejected[0]?.probability}`);
});

// ─── 大树算法（概率分带校准） ──────────────────────────

test("大树：深色橡树（2×2+宽冠，加宽层断链）→ 接受 kind=big", () => {
  const r = scanOf(buildDarkOak);
  const t = firstAccepted(r);
  assert.ok(t, "应有树资源");
  assert.equal(t.kind, "big");
  assert.ok(t.probability >= 0.8, `P=${t.probability}`);
  assert.equal(t.logs.length, 20);
  // 树资源点：中心=2×2 最低层全 4 点，唯一 ID 由中心构建，树叶坐标齐全
  assert.deepEqual(t.base, [
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 1, z: 1 },
    { x: 1, y: 1, z: 0 },
    { x: 1, y: 1, z: 1 },
  ]);
  assert.equal(t.id, "tree@(0,1,0)");
  assert.equal(t.leafCoords.length, t.leafCount);
  assert.ok(t.leafCoords.length > 0);
});

test("大树：大型云杉（2×2 高 20 + 锥冠）→ 接受（区域自动加高）", () => {
  const t = firstAccepted(scanOf(buildMegaSpruce));
  assert.ok(t && t.kind === "big" && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.top.y, 20);
});

test("大树：大型松树（顶部稀疏叶）→ 接受", () => {
  const t = firstAccepted(scanOf(buildMegaPine));
  assert.ok(t && t.kind === "big" && t.probability >= 0.8, `P=${t?.probability}`);
});

test("大树：大型丛林树（藤蔓不算异物）→ 接受", () => {
  const t = firstAccepted(scanOf(buildJungleBig));
  assert.ok(t && t.kind === "big" && t.probability >= 0.8, `P=${t?.probability}`);
  assert.equal(t.factors.F, 1);
});

test("大树：雨林枝干大树（2×2 + 横向枝干原木）→ 接受（A 经枝干原木连通，实测场景）", () => {
  const t = firstAccepted(scanOf(buildJungleBigBranched));
  assert.ok(t && t.kind === "big" && t.probability >= 0.8, `P=${t?.probability} A=${t?.factors.A}`);
  assert.equal(t.factors.A, 1); // 枝干原木是连通骨架，不再切断叶连通
});

test("大树：2×2 无树冠柱 → 拒绝 no-canopy", () => {
  const r = scanOf(buildBigNoCanopy);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "no-canopy");
});

test("大树：2×2 石顶柱（无树叶）→ 拒绝 no-canopy", () => {
  const r = scanOf(buildBigStoneTop);
  assert.equal(r.trees.length, 0);
  assert.equal(r.rejected[0]?.reason, "no-canopy");
});

// ─── 扫描汇总与排序 ────────────────────────────────────

test("扫描：多棵树由近到远排序（origin 生效）", () => {
  const world = new MockWorld();
  // 远处橡树（x=10）与近处橡树（x=3）拼装进同一世界
  const far = buildOak();
  far.world.cloneInto(world, 10, 0, 0);
  const near = buildOak();
  near.world.cloneInto(world, 3, 0, 0);
  const logs: TreeLog[] = [
    ...far.logs.map((l) => ({ x: l.x + 10, y: l.y, z: l.z, woodId: l.woodId })),
    ...near.logs.map((l) => ({ x: l.x + 3, y: l.y, z: l.z, woodId: l.woodId })),
  ];
  const r = scanTreeResources(logs, world.provider, { x: 0, y: 0, z: 0 });
  assert.equal(r.trees.length, 2);
  assert.equal(r.trees[0]!.base[0]!.x, 3); // 近的先
  assert.equal(r.trees[1]!.base[0]!.x, 10);
});

test("扫描：拒绝诊断——真树+柱子混合场景", () => {
  const world = new MockWorld();
  const oak = buildOak();
  oak.world.cloneInto(world, 0, 0, 0);
  const pillar = buildLogPillar();
  pillar.world.cloneInto(world, 8, 0, 0);
  const logs: TreeLog[] = [
    ...oak.logs,
    ...pillar.logs.map((l) => ({ x: l.x + 8, y: l.y, z: l.z, woodId: l.woodId })),
  ];
  const r = scanTreeResources(logs, world.provider);
  assert.equal(r.trees.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0]!.reason, "no-canopy");
});

test("扫描：空原木输入 → 空结果", () => {
  const world = new MockWorld();
  const r = scanTreeResources([], world.provider);
  assert.deepEqual(r, { trees: [], rejected: [] });
});

test("水平距离：二维判定", () => {
  assert.equal(horizontalDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 100, z: 4 }), 5);
});

// ─── 单候选评估接口 ────────────────────────────────────

test("evaluateTree：直接评估候选（提取+评估解耦）", () => {
  const { world, logs } = buildOak();
  const cs = extractTrunkCandidates(logs);
  const verdict = evaluateTree(cs[0]!, world.provider);
  assert.equal(verdict.accepted, true);
  if (verdict.accepted) {
    assert.equal(verdict.kind, "small");
    assert.ok(verdict.probability >= 0.8);
  }
});

test("evaluateCandidatesCached：逐候选构建区域查询（与 evaluateCandidates 等价）", () => {
  // mc 层扫描管线经 cached 入口按候选区域构建批量缓存；builder 忽略 bounds
  // 返回同一 provider（MockWorld 即"内存缓存"语义）→ 结果必须与直传一致
  const { world, logs } = buildOak();
  const cs = extractTrunkCandidates(logs);
  const direct = evaluateCandidates(cs, world.provider);
  const cached = evaluateCandidatesCached(cs, () => world.provider);
  assert.deepEqual(cached, direct);
  assert.equal(cached.trees.length, 1);
});

// ─── 随机扰动测试（参数空间扫描） ──────────────────────
// 确定性种子（mulberry32）保证失败可复现。手搭 fixture 之外的第二道防线：
// 真树参数空间扰动（树干高 4-7、树冠偏移/半径/层数随机、底部层随机缺角）
// 全部必须接受；伪树扰动（单层叶板/矮双层/浮空叶板/异物混杂）全部必须拒绝。

/** mulberry32 确定性伪随机（种子固定 → 失败可复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机小树：1×1 树干高 4-7，树冠中心可偏移 ±1、半径 1-2、层数 2-4，底部层外圈随机缺角 */
function randomSmallTree(rng: () => number, woodId: string): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 6);
  const h = 4 + Math.floor(rng() * 4); // 4-7
  const logs = trunk(world, column(0, 0, h), woodId);
  const skip = new Set(["0,0"]);
  const r = rng() < 0.5 ? 1 : 2;
  const layers = r === 1 ? 3 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 3); // r1: 3-4, r2: 2-4
  const offX = Math.floor(rng() * 3) - 1;
  const offZ = Math.floor(rng() * 3) - 1;
  for (let i = 0; i < layers; i++) leafDisk(world, offX, h - 1 + i, offZ, r, skip);
  // 底部层外圈（脚下 3×3 保持完整）随机缺角——悬崖容错场景
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
      if (rng() < 0.25) world.set(dx, 0, dz, "minecraft:air");
    }
  }
  return { world, logs };
}

/** 随机大树：2×2 树干高 4-8，树冠偏移/半径/层数随机 */
function randomBigTree(rng: () => number, woodId: string): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 7);
  const h = 4 + Math.floor(rng() * 5); // 4-8
  const cells: [number, number, number][] = [];
  for (let y = 1; y <= h; y++) {
    cells.push([0, y, 0], [1, y, 0], [0, y, 1], [1, y, 1]);
  }
  const logs = trunk(world, cells, woodId);
  const skip = new Set(["0,0", "1,0", "0,1", "1,1"]);
  const r = 2 + Math.floor(rng() * 2); // 2-3
  const layers = 2 + Math.floor(rng() * 3); // 2-4
  const offX = Math.floor(rng() * 3) - 1;
  const offZ = Math.floor(rng() * 3) - 1;
  for (let i = 0; i < layers; i++) leafDisk(world, offX, h - 1 + i, offZ, r, skip);
  return { world, logs };
}

/** 随机伪树（必须拒绝）：单层叶板 / 矮柱双层叶板（H 兜底）/ 浮空叶板（A=0）/ 双层树冠+大量异物（F 击杀） */
function randomFakeTree(rng: () => number): { world: MockWorld; logs: TreeLog[] } {
  const world = new MockWorld();
  layGround(world, 5);
  const mode = Math.floor(rng() * 4);
  const h = mode === 1 ? 2 + Math.floor(rng() * 2) : 2 + Math.floor(rng() * 5); // 双层模式柱高 ≤3（否则树样）
  const logs = trunk(world, column(0, 0, h));
  const skip = new Set(["0,0"]);
  if (mode === 0) {
    // 单层叶板（任意尺寸，C=0.4 击杀）
    leafDisk(world, 0, h + 1, 0, 1 + Math.floor(rng() * 3), skip);
  } else if (mode === 1) {
    // 双层叶板 + 矮柱（H ≤ 0.75 击杀）
    const r = 1 + Math.floor(rng() * 2);
    leafDisk(world, 0, h + 1, 0, r, skip);
    leafDisk(world, 0, h + 2, 0, r, skip);
  } else if (mode === 2) {
    // 浮空叶板（离树干顶 3 格，A=0 击杀）
    leafDisk(world, 0, h + 3, 0, 1 + Math.floor(rng() * 2), skip);
  } else {
    // 双层树冠 + 大量异物（15-25 块木板，F 击杀——树周围 10+ 异物即可疑）
    leafDisk(world, 0, h + 1, 0, 2, skip);
    leafDisk(world, 0, h + 2, 0, 2, skip);
    for (let i = 0; i < 15 + Math.floor(rng() * 11); i++) {
      world.planks(Math.floor(rng() * 5) - 2, 1 + Math.floor(rng() * h), Math.floor(rng() * 5) - 2);
    }
  }
  return { world, logs };
}

test("随机扰动：小树参数空间 300 例全接受（P ≥ 0.8）", () => {
  const rng = mulberry32(20260814);
  const woodIds = ["oak", "spruce", "birch", "jungle", "acacia", "cherry", "mangrove"];
  for (let i = 0; i < 300; i++) {
    const woodId = woodIds[Math.floor(rng() * woodIds.length)]!;
    const { world, logs } = randomSmallTree(rng, woodId);
    const r = scanTreeResources(logs, world.provider);
    assert.equal(r.trees.length, 1, `第 ${i} 例（wood=${woodId}）应接受`);
    assert.ok(r.trees[0]!.probability >= 0.8, `第 ${i} 例 P=${r.trees[0]?.probability}`);
  }
});

test("随机扰动：大树参数空间 150 例全接受（kind=big）", () => {
  const rng = mulberry32(20260815);
  const woodIds = ["dark_oak", "spruce", "jungle"];
  for (let i = 0; i < 150; i++) {
    const woodId = woodIds[Math.floor(rng() * woodIds.length)]!;
    const { world, logs } = randomBigTree(rng, woodId);
    const r = scanTreeResources(logs, world.provider);
    assert.equal(r.trees.length, 1, `第 ${i} 例（wood=${woodId}）应接受`);
    assert.equal(r.trees[0]!.kind, "big", `第 ${i} 例应为大树`);
    assert.ok(r.trees[0]!.probability >= 0.8, `第 ${i} 例 P=${r.trees[0]?.probability}`);
  }
});

test("随机扰动：伪树 300 例全拒绝（P < 0.8）", () => {
  const rng = mulberry32(20260816);
  for (let i = 0; i < 300; i++) {
    const { world, logs } = randomFakeTree(rng);
    const r = scanTreeResources(logs, world.provider);
    assert.equal(r.trees.length, 0, `第 ${i} 例应拒绝`);
  }
});
