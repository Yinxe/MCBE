// ─── 引擎层钓点扫描仿真：判据零打桩，只把体素世界观测（WorldProbe）接进 node 侧 ──
// 锁三条：单 tick 查询体积与读块预算有界（慢操作治理）；
// 组装产出必过现场复核（auditStand）；顶筛交付数量逐格守恒。
import "./stubs/MinecraftRuntime"; // 必须首行：@minecraft/* 只发 d.ts

import test from "node:test";
import assert from "node:assert/strict";

import type { Vec3 } from "../scripts/domain/Coords";
import {
  WATER_BLOCK_IDS,
  FISH_PICK_MAX_DIST,
  FISH_SCAN_BUDGET,
  auditStand,
  standAuditLabel,
  withinStandReach,
} from "../scripts/domain/FishingSpot";
import type { RegionRect, WorldProbe } from "../scripts/engine/Scanner";
import { RegionScanner, SCAN_SLICE_CELLS, spotScanner } from "../scripts/engine/Scanner";

const AIR = "minecraft:air";
const STONE = "minecraft:stone";
const WATER = "minecraft:water";
const DIM = "minecraft:overworld";

/** 世界 y 域（越界=读不到，与真实维度同口径：不可读≠没有水） */
const Y_MIN = -64;
const Y_MAX = 320;

// ─── 体素仿真世界（WorldProbe 的测试侧实现：纯字典，零 @minecraft） ──

class VoxelSim implements WorldProbe {
  private readonly voxels = new Map<string, string>();
  /** 体积查询累计次数：一箱一片，绝不整卷 */
  queries = 0;
  maxCellsPerQuery = 0;
  /** 单格读累计账（memo 口径） */
  reads = 0;
  readonly readKeys = new Set<string>();
  /** 单 tick 读取次数（预算口径：每步复位） */
  stepReads = 0;
  stepQueries = 0;
  stepMaxCells = 0;

  set(p: Vec3, id: string): void {
    this.voxels.set(k(p), id);
  }

  fillBox(min: Vec3, max: Vec3, id: string): void {
    for (let x = min.x; x <= max.x; x++)
      for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) this.set({ x, y, z }, id);
  }

  /** 单 tick 账复位（drain 每步一次） */
  beginStep(): void {
    this.stepReads = 0;
    this.stepQueries = 0;
    this.stepMaxCells = 0;
  }

  /** 读取计数复位（只锁某一段窗口的 memo，例如组装窗口） */
  resetReads(): void {
    this.reads = 0;
    this.readKeys.clear();
  }

  cells(box: RegionRect, includeTypes: readonly string[]): Vec3[] {
    this.queries++;
    this.stepQueries++;
    const w = box.max.x - box.min.x + 1;
    const h = box.max.y - box.min.y + 1;
    const d = box.max.z - box.min.z + 1;
    const volume = w * h * d;
    this.maxCellsPerQuery = Math.max(this.maxCellsPerQuery, volume);
    this.stepMaxCells = Math.max(this.stepMaxCells, volume);
    const out: Vec3[] = [];
    for (let x = box.min.x; x <= box.max.x; x++)
      for (let y = box.min.y; y <= box.max.y; y++)
        for (let z = box.min.z; z <= box.max.z; z++) {
          const id = this.voxels.get(`${x},${y},${z}`);
          if (id !== undefined && includeTypes.includes(id)) out.push({ x, y, z });
        }
    return out;
  }

  read: WorldProbe["read"] = (p) => {
    const y = Math.floor(p.y);
    if (y < Y_MIN || y > Y_MAX) return undefined; // 越界=读不到（未加载同口径）
    const id = this.voxels.get(k(p)) ?? AIR;
    this.reads++;
    this.stepReads++;
    this.readKeys.add(k(p));
    return { id, air: id === AIR, liquid: id === WATER };
  };
}

function k(p: Vec3): string {
  return `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
}

// ─── 场景：海（含水下轮）+ 与水面齐平的平滩 + 岸顶高 1 格的高山鱼塘 ──
// 全场景零绝对高度依赖（判据全程相对水面自身那一层），y=64 只是当下水位。

/** 水位层 */
const SEA_Y = 64;
/** 海洋 x 上界（含）：x∈[0,18] 水深 2 格（y=63 为水下轮——顶筛必须滤掉） */
const SEA_X_MAX = 18;
/** 平滩列（与水面齐平：支撑层即水面层，SUPPORT_LEVEL_OFFSETS 的 0 形） */
const BEACH_X = 19;
/** 高山鱼塘（岸顶比水面高 1 格：支撑在水面上一层，SUPPORT_LEVEL_OFFSETS 的 1 形） */
const POND = { min: { x: 30, z: 20 }, max: { x: 34, z: 24 } };

const SCENE_MIN = { x: 0, y: 60, z: 0 };
const SCENE_MAX = { x: 40, y: 68, z: 40 };

/** 海面列顶数 + 塘面列顶数（顶筛应交付的全部水面格数） */
const SEA_TOPS = (SEA_X_MAX + 1) * (SCENE_MAX.z + 1);
const POND_TOPS = (POND.max.x - POND.min.x + 1) * (POND.max.z - POND.min.z + 1);

function buildScene(): VoxelSim {
  const sim = new VoxelSim();
  // 陆地基准：x≥BEACH_X 实心到 y=64（与海水面齐平的平原）
  sim.fillBox({ x: BEACH_X, y: 60, z: SCENE_MIN.z }, { x: SCENE_MAX.x, y: SEA_Y, z: SCENE_MAX.z }, STONE);
  // 海床 + 水体（两层：63 水下轮、64 水面）
  sim.fillBox({ x: SCENE_MIN.x, y: 60, z: SCENE_MIN.z }, { x: SEA_X_MAX, y: 62, z: SCENE_MAX.z }, STONE);
  sim.fillBox({ x: SCENE_MIN.x, y: 63, z: SCENE_MIN.z }, { x: SEA_X_MAX, y: SEA_Y, z: SCENE_MAX.z }, WATER);
  // 高山鱼塘：塘底即平原 y=63，水面 y=64，四周只砌周界岸顶 y=65（比水面高 1 格）
  sim.fillBox({ x: POND.min.x, y: SEA_Y, z: POND.min.z }, { x: POND.max.x, y: SEA_Y, z: POND.max.z }, WATER);
  for (let x = POND.min.x - 1; x <= POND.max.x + 1; x++) {
    for (let z = POND.min.z - 1; z <= POND.max.z + 1; z++) {
      const inner = x > POND.min.x - 1 && x < POND.max.x + 1 && z > POND.min.z - 1 && z < POND.max.z + 1;
      if (!inner) sim.set({ x, y: 65, z }, STONE); // 塘心上方留空气，否则水面被压住不成"面"
    }
  }
  return sim;
}

/** 逐 tick 喂一片（Fishing SCAN 相位即这一形状），返回攒下的水面与分帧次数 */
function drain(scanner: RegionScanner, sim: VoxelSim, budget = FISH_SCAN_BUDGET) {
  const water: Vec3[] = [];
  const stepReads: number[] = [];
  const stepCells: number[] = [];
  let frames = 0;
  while (!scanner.done) {
    sim.beginStep();
    for (const hit of scanner.step(budget)) water.push(hit);
    stepReads.push(sim.stepReads);
    stepCells.push(sim.stepMaxCells);
    frames++;
    assert.ok(frames < 500, "扫描必须有限帧收敛（死循环即账目崩）");
    assert.equal(sim.stepQueries <= 1, true, "一个 tick 至多一片体积查询");
  }
  return { water, frames, stepReads, stepCells };
}

// ─── 慢操作：一箱一片 + 读块预算，绝不整卷一枪 ──────────────────

test("切片计划：任一片体积 ≤ SCAN_SLICE_CELLS，一片恰一层且 y 升序全覆盖", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const whole = (SCENE_MAX.x - SCENE_MIN.x + 1) * (SCENE_MAX.y - SCENE_MIN.y + 1) * (SCENE_MAX.z - SCENE_MIN.z + 1);
  assert.ok(scanner.plan.length > 1, `必须分片（整卷 ${whole} 格正是 158ms 那一枪）`);
  for (const slice of scanner.plan) {
    const cells = (slice.max.x - slice.min.x + 1) * (slice.max.y - slice.min.y + 1) * (slice.max.z - slice.min.z + 1);
    assert.ok(cells <= SCAN_SLICE_CELLS, `切片 ${cells} 格超预算 ${SCAN_SLICE_CELLS}`);
    assert.equal(slice.min.y, slice.max.y, "一片恰好一层（逐层推进是分帧的形状）");
  }
  // 列顶归约依赖"自低向高，后写即更高"
  const ys = scanner.plan.map((s) => s.min.y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! >= ys[i - 1]!, "切片必须按 y 非降推进");
  assert.equal(new Set(ys).size, SCENE_MAX.y - SCENE_MIN.y + 1, "每一层都有片");
});

test("分帧账目：查询次数=切片数、单步读块 ≤ 预算、总帧数=scanTicks 设计量", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { frames, stepReads, stepCells } = drain(scanner, sim);
  // 列顶数量在采集段结束才定，故设计量在收官后核对（scanTicks 的口径即此）
  assert.equal(frames, scanner.scanTicks(FISH_SCAN_BUDGET), "扫描时长是设计量（长等位/长 move 的据）");
  assert.equal(sim.queries, scanner.plan.length, "一片一次体积查询，不多不少");
  assert.equal(sim.maxCellsPerQuery <= SCAN_SLICE_CELLS, true, "任一 tick 的查询体积破档");
  for (const reads of stepReads) assert.ok(reads <= FISH_SCAN_BUDGET, `单步读块 ${reads} 超预算`);
  for (const cells of stepCells) assert.ok(cells <= SCAN_SLICE_CELLS, `单步查询 ${cells} 格破档`);
  assert.ok(scanner.ok, "仿真世界全程可读");
});

// ─── 顶筛与计数：只吐列顶水面，不吞不漏不重吐 ───────────────────

test("顶筛：交付的都是正上方精确空气的列顶，水下轮（y=63）一个不吐", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water, frames } = drain(scanner, sim);
  assert.equal(water.length, SEA_TOPS + POND_TOPS);
  assert.equal(scanner.deliveredCount, water.length, "调用方攒下的数=已交付数（既不吞也不重吐）");
  assert.ok(frames > scanner.plan.length, "水面筛另占帧（读块预算摊帧）");
  const seen = new Set<string>();
  for (const cell of water) {
    const key = k(cell);
    assert.ok(!seen.has(key), `同一列重复吐：${key}`);
    seen.add(key);
    assert.equal(cell.y, SEA_Y, `非列顶水面混进来了：${key}`);
    assert.equal(sim.read({ x: cell.x, y: cell.y + 1, z: cell.z })?.id, AIR, `头顶非精确空气却报了水面：${key}`);
  }
});

test("requireAirAbove=false（原木等通用采集）：原样吐全部命中格，账目逐格守恒", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, {
    requireAirAbove: false,
    probe: sim,
  });
  const { water } = drain(scanner, sim, 50);
  assert.equal(water.length, SEA_TOPS * 2 + POND_TOPS, "水下轮也照吐（列内最高归调用方组装）");
  assert.equal(scanner.deliveredCount, water.length);
  const y63 = water.filter((c) => c.y === 63).length;
  assert.ok(y63 > 0 && y63 < water.length, `两档都在且比例对：y63=${y63}`);
});

// ─── 组装 ↔ 现场复核：同一份观测，入池的点必过复核 ──────────────

test("组装产出逐点通过 auditStand（同观测同判据）——入池即除名在结构上不可能", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water } = drain(scanner, sim);
  const center: Vec3 = { x: BEACH_X + 0.5, y: 65, z: 20.5 };
  sim.resetReads();
  const spots = spotScanner.composeSpots(DIM, water, center, 256, undefined, sim);
  assert.ok(spots.length > 0, "海 + 平滩 + 高山塘不该组装为零");
  // 锁：组装窗口内每格至多读一次（memo 生效，成本不失控）
  assert.equal(sim.reads, sim.readKeys.size, "读块记忆没生效：同一格被组装读了两次以上");
  for (const s of spots) {
    const audit = spotScanner.auditStand(DIM, s.stand, sim);
    assert.equal(audit.verdict, "ok", `组装入池的点复核塌了：(${s.stand}) ${standAuditLabel(audit)}`);
  }
});

test("两形并收：与水面齐平的平滩（形①）与岸顶高 1 格的高山鱼塘（形②）都出点", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water } = drain(scanner, sim);
  const center: Vec3 = { x: 20, y: 65, z: 20 };
  const spots = spotScanner.composeSpots(DIM, water, center, 256, undefined, sim);
  const beach = spots.filter((s) => s.stand.x === BEACH_X && s.stand.y === SEA_Y + 1);
  const pond = spots.filter(
    (s) =>
      s.stand.y === 66 &&
      s.stand.x >= POND.min.x - 1 &&
      s.stand.x <= POND.max.x + 1 &&
      s.stand.z >= POND.min.z - 1 &&
      s.stand.z <= POND.max.z + 1
  );
  assert.ok(beach.length > 0, "岸与水面齐平（归档原生形）出点为零");
  assert.ok(pond.length > 0, "岸顶比水面高 1 格的高山鱼塘出点为零");
  // 支撑口径：平滩支撑与水面同层（y=64 实心），塘沿支撑比水面高 1 格（y=65 实心）
  assert.equal(sim.read({ x: beach[0]!.stand.x, y: beach[0]!.stand.y - 1, z: beach[0]!.stand.z })?.id, STONE);
  assert.equal(sim.read({ x: pond[0]!.stand.x, y: pond[0]!.stand.y - 1, z: pond[0]!.stand.z })?.id, STONE);
  // 瞄准平面恒在水面自身那一层（无绝对高度）
  for (const s of spots) assert.equal(k(s.aim.target).split(",")[1], String(SEA_Y), `瞄准跑出了水层：(${s.stand})`);
});

test("认领半径筛与 PICK 同口径：组装产出的点全在 withinStandReach 内", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water } = drain(scanner, sim);
  const center: Vec3 = { x: POND.min.x, y: 65, z: POND.min.z };
  const spots = spotScanner.composeSpots(DIM, water, center, 256, FISH_PICK_MAX_DIST, sim);
  assert.ok(spots.length > 0, "以塘为参照中心，塘沿点必在 16 格内");
  for (const s of spots)
    assert.ok(withinStandReach(center, s.stand, FISH_PICK_MAX_DIST), `超距点漏筛入池：(${s.stand})`);
});

test("复核预算只给真支撑：开阔水面的空气柱不吃额度（大水体出得了近岸点）", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water } = drain(scanner, sim);
  assert.ok(water.length > 700, `场景要有开阔水面才测得出这一条：${water.length}`);
  const center: Vec3 = { x: 20, y: 65, z: 20 };
  // 复核预算收到 16（真实档 256）：验证开阔水面的空气柱不占用复核预算
  const spots = spotScanner.composeSpots(DIM, water, center, 16, FISH_PICK_MAX_DIST, sim);
  assert.ok(spots.length > 0, "小额度下近岸点位被海面空气柱挤光（缺44⑭ 复现）");
  for (const s of spots) {
    assert.notEqual(sim.read(s.stand)?.id, WATER, `站位落在水面上：(${s.stand})`);
    assert.ok(withinStandReach(center, s.stand, FISH_PICK_MAX_DIST), `额度烧到了超距点：(${s.stand})`);
  }
});

test("世界真的变了才失效：支撑被挖走后复核归因 support-air（除名换点的据）", () => {
  const sim = buildScene();
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: sim });
  const { water } = drain(scanner, sim);
  const spots = spotScanner.composeSpots(DIM, water, { x: 20, y: 65, z: 20 }, 256, undefined, sim);
  const spot = spots[0]!;
  assert.equal(spotScanner.auditStand(DIM, spot.stand, sim).verdict, "ok");
  sim.set({ x: spot.stand.x, y: spot.stand.y - 1, z: spot.stand.z }, AIR); // 有人把脚下挖走了
  const after = spotScanner.auditStand(DIM, spot.stand, sim);
  assert.equal(after.verdict, "invalid");
  assert.equal(after.reason, "support-air");
  // domain 纯函数与 engine 侧实现在同一次读上必同一结论
  const direct = auditStand(spot.stand, { block: (p) => sim.read(p) });
  assert.equal(direct.verdict, "invalid");
  assert.equal(direct.reason, after.reason);
});

test("采集异常≠附近没有水：全空气判 no-water，切片抛错判 error 且作废部分命中", () => {
  const empty = new VoxelSim(); // 空世界：全空气，确实没有水
  const scanner = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: empty });
  const { water } = drain(scanner, empty);
  assert.equal(water.length, 0);
  assert.ok(scanner.ok, "空世界读取正常＝采集可信，0 水面才是真的没有水");

  const boom = new VoxelSim();
  boom.cells = () => {
    throw new Error("区块未加载");
  };
  const broken = new RegionScanner(DIM, { min: SCENE_MIN, max: SCENE_MAX }, WATER_BLOCK_IDS, { probe: boom });
  drain(broken, boom);
  assert.equal(broken.ok, false, "切片异常必须标记采集不可信");
  assert.equal(broken.failReason, "扫描查询出错", "失败归因要点名错误性质（未加载区块走 UnloadedChunksError 分支）");
  assert.equal(broken.deliveredCount, 0, "异常轮次的部分命中一并作废");
});
