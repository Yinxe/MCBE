// domain 纯逻辑单测：咬钩跟踪 / 站位几何与落点判定 / 播报 / 战利品指纹 / 共享池失败计数。
import test from "node:test";
import assert from "node:assert/strict";

import { BITE_DROP_THRESHOLD, initBiteState, updateBiteTracker } from "../scripts/domain/BiteWatch";
import type { Vec3 } from "../scripts/domain/Coords";
import type { StandProbe, StandObservation } from "../scripts/domain/FishingSpot";
import {
  standCenter,
  fishingSpotKey,
  isAtStandSpot,
  judgeHookPlacement,
  fishFailureLabel,
  classifyFishingScan,
  composeStandCandidates,
  auditStand,
  standAuditLabel,
  countAdjacentWaters,
  judgeStandSpot,
  standFailureReason,
  FISH_PICK_MAX_DIST,
  FISH_RATE_DEFAULT,
  FISH_RATE_MIN,
  FISH_RATE_STEP,
  FISH_SPOT_STRIKES,
  rankFishSpots,
  decayRate,
  recoverRate,
  adjacentWaterCells,
  repairSpotAim,
} from "../scripts/domain/FishingSpot";
import type { FishSpot } from "../scripts/domain/FishingSpot";
import { ownerBotId } from "../scripts/domain/Session";
import { lootFingerprint, diffLootCounts } from "../scripts/domain/Fingerprint";
import { SharedPool } from "../scripts/domain/Pool";
import type { PoolPoint } from "../scripts/domain/Pool";

// ─── BiteWatch：滚动最高点参照 ──

test("updateBiteTracker：首采样初始化不触发", () => {
  const s = initBiteState();
  assert.equal(s.maxY, undefined);
  assert.equal(updateBiteTracker(s, 64), false);
  assert.equal(s.maxY, 64);
});

test("updateBiteTracker：上浮刷新最高点、不下判", () => {
  const s = initBiteState();
  updateBiteTracker(s, 64);
  assert.equal(updateBiteTracker(s, 64.1), false);
  assert.equal(s.maxY, 64.1);
});

test("updateBiteTracker：净降超阈值判咬钩（慢速渐进不漏检）", () => {
  const s = initBiteState();
  updateBiteTracker(s, 64);
  assert.equal(updateBiteTracker(s, 64 - BITE_DROP_THRESHOLD), false, "恰等阈值不触发");
  assert.equal(updateBiteTracker(s, 64 - BITE_DROP_THRESHOLD - 0.01), true);
});

test("updateBiteTracker：正常浮动（阈值内）不触发", () => {
  const s = initBiteState();
  updateBiteTracker(s, 64);
  assert.equal(updateBiteTracker(s, 63.9), false);
  assert.equal(updateBiteTracker(s, 63.8), false);
});

// ─── FishingSpot：几何键 / 落点 / 播报 ──

test("standCenter：站位格中心 +0.5（y 原样）", () => {
  assert.deepEqual(standCenter({ x: 10, y: 64, z: -3 }), { x: 10.5, y: 64, z: -2.5 });
});

test("isAtStandSpot：脚在格面上水平 ≤0.8 判到位（免寻路档与 ALIGN 同口径）", () => {
  const stand: Vec3 = { x: 10, y: 64, z: -3 };
  assert.ok(isAtStandSpot({ x: 10.5, y: 64, z: -2.5 }, stand), "格中心正上站位");
  assert.ok(isAtStandSpot({ x: 10.0, y: 64.0, z: -3.0 }, stand), "格角容差内");
  assert.ok(isAtStandSpot({ x: 11.2, y: 64.05, z: -2.5 }, stand), "水平 0.7 内");
  assert.ok(!isAtStandSpot({ x: 11.4, y: 64, z: -2.5 }, stand), "水平 0.9 超档要走寻路/微对齐");
  assert.ok(!isAtStandSpot({ x: 10.5, y: 65.5, z: -2.5 }, stand), "悬空同列不算到位（竖直 ±1）");
  assert.ok(!isAtStandSpot({ x: 10.5, y: 62.0, z: -2.5 }, stand), "陷落同列不算到位");
});

test("fishingSpotKey：站位格全维唯一编码（钓区改由 FishingZones 按 id 寻址，无池键）", () => {
  assert.equal(fishingSpotKey("minecraft:overworld", { x: 1, y: 2, z: 3 }), "minecraft:overworld:1,2,3");
});

test("judgeHookPlacement：实体优先（归档用户规格 2.1.x——勾中任何实体即 snagged，陆上勾实体也算）", () => {
  assert.equal(judgeHookPlacement(false, true), "snagged");
  assert.equal(judgeHookPlacement(false, false), "landed");
  assert.equal(judgeHookPlacement(true, true), "snagged");
  assert.equal(judgeHookPlacement(true, false), "water");
});

test("fishFailureLabel：全枚举均有中文、timeout 不属失败枚举", () => {
  assert.equal(fishFailureLabel("landed"), "鱼钩勾中固体方块（落陆地），本次钓鱼失败");
  assert.equal(fishFailureLabel("snagged"), "鱼钩勾中实体生物，本次钓鱼失败");
  assert.equal(fishFailureLabel("hook-lost"), "鱼钩中途消失，本次钓鱼失败");
  assert.equal(fishFailureLabel("no-rod"), "没有鱼竿");
  assert.equal(fishFailureLabel("offline"), "假人不在线");
  assert.equal(fishFailureLabel("error"), "执行失败");
});

test("classifyFishingScan：无水优先、有水面无候选=no-spot、双有=成功", () => {
  assert.equal(classifyFishingScan(0, 0), "no-water");
  assert.equal(classifyFishingScan(0, 5), "no-water", "水面数为 0 优先判 no-water（候选数无从谈起）");
  assert.equal(classifyFishingScan(12, 0), "no-spot");
  assert.equal(classifyFishingScan(12, 3), undefined);
});

// ─── Fingerprint：战利品指纹与快照差异 ──

test("lootFingerprint：无附魔裸 typeId；有附魔排序拼 #id:level", () => {
  assert.equal(lootFingerprint("minecraft:cod", []), "minecraft:cod");
  const a = lootFingerprint("minecraft:fishing_rod", [
    { id: "b", level: 2 },
    { id: "a", level: 1 },
  ]);
  assert.equal(a, "minecraft:fishing_rod#a:1,b:2");
  // 顺序无关（排序保稳定）
  const b = lootFingerprint("minecraft:fishing_rod", [
    { id: "a", level: 1 },
    { id: "b", level: 2 },
  ]);
  assert.equal(a, b);
});

test("diffLootCounts：仅正增量；缺失视为 0；减少忽略", () => {
  const out = diffLootCounts({ cod: 3, rod: 1 }, { cod: 5, salmon: 2, rod: 1 });
  assert.deepEqual(out, { cod: 2, salmon: 2 });
  assert.deepEqual(diffLootCounts({ cod: 5 }, { cod: 2 }), {});
});

// ─── SharedPool：占用中记失败与清零（noteFail/resetFail）与筛选取点 ──

interface P extends PoolPoint {
  key: string;
  tag: string;
}
const mk = (key: string, tag = ""): P => ({ key, tag });
const fill = (pool: SharedPool<P>, ...points: P[]) => pool.refill(points);

test("noteFail：未达阈值 kept 同点重试、保留占用", () => {
  const pool = new SharedPool<P>(3, 3);
  fill(pool, mk("a"));
  const spot = pool.claim("bot1");
  assert.ok(spot);
  assert.equal(pool.noteFail("bot1"), "kept");
  assert.equal(pool.noteFail("bot1"), "kept");
  // 仍持有（占用未释放）：再 claim 返回 null（防囤）
  assert.equal(pool.claim("bot1"), null);
});

test("noteFail：达阈值 banned 黑标共享并解除占用", () => {
  const pool = new SharedPool<P>(3, 3);
  fill(pool, mk("a"));
  pool.claim("bot1");
  assert.equal(pool.noteFail("bot1"), "kept");
  assert.equal(pool.noteFail("bot1"), "kept");
  assert.equal(pool.noteFail("bot1"), "banned");
  // 点被拉黑后其他 bot 取不到它
  fill(pool, mk("a")); // 重灌同名点应被黑名单挡住
  assert.equal(pool.claim("bot2"), null);
});

test("noteFail：无占用返回 none", () => {
  const pool = new SharedPool<P>();
  assert.equal(pool.noteFail("ghost"), "none");
});

test("resetFail：钓获清零失败计数（同点续钓前嫌尽释）", () => {
  const pool = new SharedPool<P>(3, 3);
  fill(pool, mk("a"));
  pool.claim("bot1");
  pool.noteFail("bot1");
  pool.noteFail("bot1");
  pool.resetFail("bot1");
  assert.equal(pool.noteFail("bot1"), "kept");
});

test("claimWhere：逐点复核，不合用回队尾轮转防饿死", () => {
  const pool = new SharedPool<P>();
  fill(pool, mk("a", "bad"), mk("b", "good"));
  const spot = pool.claimWhere("bot1", (p) => p.tag === "good");
  assert.ok(spot);
  assert.equal(spot.key, "b");
  // bad 点仍在池中（未消耗），下个人可自定判据再取
  assert.equal(pool.stats().free, 1);
});

test("countUsable：按接受判据过滤计数（水位线口径）", () => {
  const pool = new SharedPool<P>();
  fill(pool, mk("a", "x"), mk("b", "y"), mk("c", "x"));
  assert.equal(pool.countUsable(), 3);
  assert.equal(
    pool.countUsable((p) => p.tag === "x"),
    2
  );
});

test("countTracked：空闲+占用都算跟踪，拉黑/未知不算（区分零进账是枯竭还是仅被跳过）", () => {
  const p1 = new SharedPool<P>();
  fill(p1, mk("a"), mk("b"));
  p1.claim("bot1"); // a 转占用，b 仍空闲
  assert.equal(p1.countTracked([]), 0, "空键列表零跟踪");
  assert.equal(p1.countTracked(["a", "b"]), 2, "占用中的 a 与空闲的 b 都被跟踪");
  assert.equal(p1.countTracked(["a", "b", "z"]), 2, "未知键 z 不计");

  const p2 = new SharedPool<P>();
  fill(p2, mk("a"), mk("b"), mk("c"));
  p2.claim("bot1"); // 取走 a
  p2.ban("bot1"); // a 进黑名单、脱离跟踪
  assert.equal(p2.countTracked(["a", "b", "c"]), 2, "拉黑的 a 不算跟踪，仅空闲 b/c 计");
  assert.equal(p2.countTracked(["a"]), 0, "全部拉黑→零跟踪（真·枯竭判据）");
});

test("ban：独占放弃直接黑标共享", () => {
  const pool = new SharedPool<P>();
  fill(pool, mk("a"));
  pool.claim("bot1");
  pool.ban("bot1");
  assert.equal(pool.stats().blacklisted, 1);
  assert.equal(pool.stats().claimed, 0);
});

// ─── claimWhere 免费预筛通道 ──

interface Col extends PoolPoint {
  key: string;
  /** 离假人的水平距离（纯算术判据的替身，零世界读） */
  d: number;
}
const at = (key: string, d: number): Col => ({ key, d });

test("prefilter 零成本出局不吃复核预算——池首一排远点仍能一轮认领队尾近点", () => {
  const pool = new SharedPool<Col>(3, 3, 32);
  // 入池按星级降序 ⇒ 海边形态：远的高星点排满池首，够得着的点沉在队尾
  pool.refill([...Array.from({ length: 25 }, (_, i) => at(`f${i}`, 40)), at("near", 3)]);
  let accepts = 0;
  const got = pool.claimWhere(
    "bot1",
    (p) => {
      accepts++;
      return true;
    },
    6,
    (p) => p.d <= 16
  );
  assert.ok(got);
  assert.equal(got.key, "near");
  assert.equal(accepts, 1, "25 个远点走免费通道，一次昂贵的现场复核都不该花");
  assert.equal(pool.stats().free, 25, "远点转队尾尽数留池（走近后仍可服务）");
});

test("同形无 prefilter（旧口径）：6 个预算全喂给远点 → 池深 26 也判一无所获", () => {
  const pool = new SharedPool<Col>(3, 3, 32);
  pool.refill([...Array.from({ length: 25 }, (_, i) => at(`f${i}`, 40)), at("near", 3)]);
  let accepts = 0;
  const got = pool.claimWhere("bot1", (p) => (accepts++, p.d <= 16), 6);
  assert.equal(got, null, "旧实现把纯算术判据塞进 accept，预算在池首就耗尽");
  assert.equal(accepts, 6);
});

test("prefilter 轮转语义：全池超距时判空且队列原序不动（下轮走近再接）", () => {
  const pool = new SharedPool<Col>(3, 3, 32);
  pool.refill([at("a", 40), at("b", 41)]);
  assert.equal(
    pool.claimWhere(
      "bot1",
      () => true,
      6,
      (p) => p.d <= 16
    ),
    null
  );
  assert.deepEqual(pool.freeKeys(), ["a", "b"], "转队尾两次即复原，不产生重排抖动");
});

test("prefilter 与黑标互不干扰：黑标点仍直接出局、不占预算也不回队尾", () => {
  const pool = new SharedPool<Col>(3, 3, 32);
  pool.refill([at("banned", 1), at("far", 40), at("good", 2)]);
  pool.claim("bot2"); // 占走 banned(1)
  pool.ban("bot2"); // 连续失败标记生效后移出候选
  const got = pool.claimWhere(
    "bot1",
    () => true,
    6,
    (p) => p.d <= 16
  );
  assert.ok(got);
  assert.equal(got.key, "good");
  assert.equal(pool.stats().free, 1, "far 留池、banned 已出局");
});

// ─── 站位组装几何（domain/composeStandCandidates） ──
// 回归：站位层算错一层（支撑落到水面自身那层）⇒ 岸边零候选，本组用例钉死这一层几何。

const AIR = "minecraft:air";
const WATER = "minecraft:water";
const SAND = "minecraft:sand";
const kk = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** 体素世界夹具（键域内即真值，缺席=空气；探针零 IO） */
function voxelWorld(entries: Record<string, string>): {
  cells: Vec3[];
  probe: StandProbe;
  water: (p: Vec3) => boolean;
} {
  const world = new Map(Object.entries(entries));
  const at = (p: Vec3): string => world.get(kk(p.x, p.y, p.z)) ?? AIR;
  const id = (x: number, y: number, z: number): string => at({ x, y, z });
  // 水面格：本格是水且正上方精确空气（调用方预筛后喂入）
  const cells: Vec3[] = [];
  for (const [k, v] of world) {
    if (v !== WATER) continue;
    const parts = k.split(",").map(Number);
    const [x, y, z] = [parts[0]!, parts[1]!, parts[2]!];
    if (id(x, y + 1, z) === AIR) cells.push({ x, y, z });
  }
  return {
    cells,
    water: (p) => at(p) === WATER,
    probe: {
      isAir: (p) => at(p) === AIR,
      support: (p) => {
        const t = at(p);
        return { id: t, air: t === AIR, liquid: t === WATER };
      },
    },
  };
}

/** 平沙岸：岸方块与水面同层（顶面齐平），水在 +x 侧铺开 count 格 */
function beach(count: number, waterY = 64, shoreX = -1): Record<string, string> {
  const world: Record<string, string> = {};
  for (let i = 0; i < count; i++) world[kk(i, waterY, 0)] = WATER;
  world[kk(shoreX, waterY, 0)] = SAND;
  return world;
}

test("站位几何：岸方块与水面同层 ⇒ 站位=水面层上方 1 格（平沙滩必出点）", () => {
  const { cells, probe, water } = voxelWorld(beach(6));
  const spots = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256);
  assert.equal(spots.length, 1, "平沙岸出一个站位（旧几何此处恒为 0＝站水边也找不到点）");
  const s = spots[0]!;
  assert.deepEqual(s.stand, { x: -1, y: 65, z: 0 }, "站位在支撑（岸方块）上方 1 格");
  assert.equal(s.aim.level, 5, "瞄准沿水面层延伸（站位层全空气，延伸平面错一层即 0 星）");
  assert.equal(s.aim.target.y, 64, "瞄准目标在水面层，不是站位层");
});

test("站位几何：头顶有遮挡（梁/树冠）即出局", () => {
  const entries = beach(6);
  entries[kk(-1, 66, 0)] = SAND; // 站位上方第二格被堵
  const { cells, probe, water } = voxelWorld(entries);
  assert.equal(composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256).length, 0);
});

test("站位几何：危险支撑（岩浆块/熔岩）不出点", () => {
  for (const bad of ["minecraft:magma_block", "minecraft:lava"]) {
    const entries = beach(6);
    entries[kk(-1, 64, 0)] = bad;
    const { cells, probe, water } = voxelWorld(entries);
    assert.equal(composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256).length, 0, bad);
  }
});

test("站位几何：同层 8 邻共享站位去重，瞄准取最近水面方向延伸", () => {
  // 唯一一块岸（其余格读作空气=支撑不成立）被四片水包围：一个站位、方向取最近水面
  const world: Record<string, string> = {
    [kk(0, 64, 0)]: SAND,
    [kk(0, 64, -1)]: WATER,
    [kk(0, 64, -2)]: WATER,
    [kk(0, 64, -3)]: WATER,
    [kk(1, 64, -1)]: WATER,
    [kk(1, 64, 1)]: WATER,
  };
  const { cells, probe, water } = voxelWorld(world);
  const spots = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256);
  assert.equal(spots.length, 1, "四片水共享同一站位（去重）");
  assert.deepEqual(spots[0]!.stand, { x: 0, y: 65, z: 0 });
  assert.equal(spots[0]!.aim.level, 3, "沿 −z 侧连续水面延伸到第 3 格（曼哈顿水平距）");
  assert.deepEqual(spots[0]!.aim.target, { x: 0, y: 64, z: -3 }, "瞄准目标在水面层");
});

/** 高山鱼塘/水渠形：塘底水在 waterY，岸顶方块比水面高 1 格（人站 feetY 抛竿） */
function raisedPond(count: number, waterY = 62, shoreTop = 63, feetY = 64): Record<string, string> {
  const world: Record<string, string> = {};
  for (let i = 0; i < count; i++) world[kk(i, waterY, 0)] = WATER;
  world[kk(-1, waterY, 0)] = SAND;
  world[kk(-1, shoreTop, 0)] = "minecraft:grass_block";
  return { ...world, [kk(-1, feetY - 1, 0)]: "minecraft:grass_block" };
}

test("站位几何·放宽（用户规格 2026-09-28）：岸顶比水面高 1 格也出点（高山鱼塘/水渠）", () => {
  const { cells, probe, water } = voxelWorld(raisedPond(6));
  const spots = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256);
  assert.equal(spots.length, 1, "高岸同样出一个站位（组装两形并收）");
  const s = spots[0]!;
  assert.deepEqual(s.stand, { x: -1, y: 64, z: 0 }, "站位=高一层岸顶的上方 1 格");
  assert.equal(s.aim.target.y, 62, "瞄准仍落在**水面自己那一层**（不是站位下方一格的空气层）");
  assert.equal(s.aim.level, 5, "延伸沿水面层连续 5 格（错位平面即 0 星）");
});

test("站位几何·放宽不重复出点：同一根柱只有最顶层实心方块的上方成立", () => {
  const entries: Record<string, string> = {
    [kk(0, 62, 0)]: WATER,
    [kk(1, 62, 0)]: WATER,
    [kk(-1, 62, 0)]: SAND, // 岸柱：62 与 63 两层都有方块（岸顶高于水面）
    [kk(-1, 63, 0)]: SAND,
  };
  const { cells, probe, water } = voxelWorld(entries);
  const spots = composeStandCandidates(cells, { x: 0, y: 63, z: 0 }, probe, water, 256);
  assert.equal(spots.length, 1, "两层支撑候选只有可行那一形留池（同柱不重复出点）");
  assert.deepEqual(spots[0]!.stand, { x: -1, y: 64, z: 0 });
});

test("站位可达筛：远点走免费通道（认领半径筛排在复核预算之前）", () => {
  // 两条平行岸：x=-1 岸（贴 center）与 x=40 岸（远得够不着）
  const entries = { ...beach(6), [kk(41, 64, 0)]: WATER, [kk(42, 64, 0)]: WATER, [kk(40, 64, 0)]: SAND };
  const { cells, probe, water } = voxelWorld(entries);
  let supports = 0;
  const counted: StandProbe = { ...probe, support: (p) => (supports++, probe.support(p)) };
  const free = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, counted, water, 256);
  const freeSupports = supports;
  assert.equal(free.length, 2, "不筛距离：近岸 + 远处岸都出点");
  supports = 0;
  const gated = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, counted, water, 256, FISH_PICK_MAX_DIST);
  assert.equal(gated.length, 1, "按认领半径筛：只留近岸点（否则星级优先+容量封顶把近点挤光＝入池32／超距32）");
  assert.deepEqual(gated[0]!.stand, { x: -1, y: 65, z: 0 });
  assert.ok(supports < freeSupports, `远点一次昂贵复核都不该花（${supports} < ${freeSupports}）`);
});

test("站位预算：复核预算硬封顶（组装成本不随水面积线性膨胀）", () => {
  const world: Record<string, string> = {};
  for (let z = 0; z < 10; z++) {
    world[kk(0, 64, z)] = WATER;
    world[kk(-1, 64, z)] = SAND;
  }
  const { cells, probe, water } = voxelWorld(world);
  let supports = 0;
  const counted: StandProbe = { ...probe, support: (p) => (supports++, probe.support(p)) };
  const spots = composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, counted, water, 3);
  assert.equal(supports, 3, "复核恰好花满预算 3（第 4 个候选起直接收摊）");
  assert.ok(spots.length <= 3, `产出候选不超预算（实际 ${spots.length}）`);
});

// ─── 组装 ↔ 现场复核同判据 ──
// 锁：composeStandCandidates 的产出必过 auditStand——两处判据同源，
// 因此池内点不会因判据不一致而被自己剔除。

/** 体素世界 → 观测原语（缺席=空气；"?"=读不到，模拟未加载区块） */
function voxelObs(entries: Record<string, string>): StandObservation {
  const world = new Map(Object.entries(entries));
  return {
    block: (p) => {
      const t = world.get(kk(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)));
      if (t === undefined) return { id: AIR, air: true, liquid: false };
      if (t === "?") return undefined;
      return { id: t, air: t === AIR, liquid: t === WATER || t === "minecraft:flowing_water" };
    },
  };
}

test("不变量：composeStandCandidates 的每个产出站位，auditStand 直读复核必判 ok", () => {
  const fixtures: Record<string, string>[] = [
    beach(6),
    raisedPond(6),
    {
      [kk(0, 62, 0)]: WATER,
      [kk(1, 62, 0)]: WATER,
      [kk(-1, 62, 0)]: SAND,
      [kk(-1, 63, 0)]: SAND,
    },
    {
      // 十字水面：一站位共享多水格，瞄准向 −z 延伸
      [kk(0, 64, 0)]: WATER,
      [kk(1, 64, 0)]: WATER,
      [kk(0, 64, -1)]: WATER,
      [kk(0, 64, -2)]: WATER,
      [kk(0, 64, -3)]: WATER,
      [kk(-1, 64, 0)]: SAND,
    },
  ];
  for (const entries of fixtures) {
    const { cells, probe, water } = voxelWorld(entries);
    const obs = voxelObs(entries);
    for (const s of composeStandCandidates(cells, { x: 0, y: 64, z: 0 }, probe, water, 256)) {
      const audit = auditStand(s.stand, obs);
      assert.equal(
        audit.verdict,
        "ok",
        `组装认账的点复核必须认账 ${JSON.stringify(s.stand)} → ${standAuditLabel(audit)}`
      );
      assert.ok(audit.waters > 0, "邻水观测非零");
    }
  }
});

test("auditStand：四条判据逐条塌掉各归其名（诊断日志不再靠猜）", () => {
  const good = { [kk(0, 64, 0)]: WATER, [kk(-1, 64, 0)]: SAND };
  const stand = { x: -1, y: 65, z: 0 };
  assert.equal(auditStand(stand, voxelObs(good)).verdict, "ok", "夹具本身成立（后续对照基准）");
  assert.equal(auditStand(stand, voxelObs({ [kk(0, 64, 0)]: WATER })).reason, "support-air");
  // 支撑读不到（未加载）→ unreadable 而非 invalid（瞬态不判死）
  const noSupport = { ...good, [kk(-1, 64, 0)]: "?" };
  assert.equal(auditStand(stand, voxelObs(noSupport)).verdict, "unreadable");
  const noAbove = { ...good, [kk(-1, 64, 0)]: "?" };
  delete noAbove[kk(-1, 64, 0)];
  assert.equal(
    auditStand({ x: -1, y: 65, z: 0 }, voxelObs({ [kk(0, 64, 0)]: WATER, [kk(-1, 64, 0)]: SAND, [kk(-1, 65, 0)]: "?" }))
      .reason,
    "above1-unreadable"
  );
  // 站位被方块占据 / 头顶被占据
  assert.equal(auditStand(stand, voxelObs({ ...good, [kk(-1, 65, 0)]: "minecraft:dirt" })).reason, "above1-not-air");
  assert.equal(auditStand(stand, voxelObs({ ...good, [kk(-1, 66, 0)]: "minecraft:dirt" })).reason, "above2-not-air");
  // 危险支撑（岩浆块：实心但黑名单）
  assert.equal(
    auditStand(stand, voxelObs({ ...good, [kk(-1, 64, 0)]: "minecraft:magma_block" })).reason,
    "support-unsafe"
  );
  // 水被排干 → 邻水归因
  assert.equal(auditStand(stand, voxelObs({ [kk(-1, 64, 0)]: SAND })).reason, "no-water");
});

test("auditStand：cave_air 不算精确空气（归档规格，站进洞穴不出点）", () => {
  const entries = { [kk(0, 64, 0)]: WATER, [kk(-1, 64, 0)]: SAND, [kk(-1, 65, 0)]: "minecraft:cave_air" };
  const audit = auditStand({ x: -1, y: 65, z: 0 }, voxelObs(entries));
  assert.equal(audit.reason, "above1-not-air");
});

test("countAdjacentWaters：支撑层先命中即止，零命中才下探一层（两形并收同源）", () => {
  // 环查=支撑格的水平 8 邻（不含支撑自身——它是脚下实心块，本就不可能是水）
  const same = { [kk(1, 64, 0)]: WATER, [kk(1, 64, 1)]: WATER, [kk(-1, 63, 0)]: WATER };
  const below = { [kk(-1, 63, 0)]: WATER };
  const isWaterFrom =
    (e: Record<string, string>) =>
    (p: Vec3): boolean =>
      e[kk(p.x, p.y, p.z)] === WATER;
  assert.equal(countAdjacentWaters({ x: 0, y: 64, z: 0 }, isWaterFrom(same)), 2, "支撑层命中即返回，不再下探");
  assert.equal(countAdjacentWaters({ x: 0, y: 64, z: 0 }, isWaterFrom(below)), 1, "岸顶高一层：水面在支撑下一层");
  assert.equal(countAdjacentWaters({ x: 0, y: 64, z: 0 }, isWaterFrom({})), 0, "两层皆无水");
});

test("judgeStandSpot 与 standFailureReason 严格互补（判据一份、归因一份不漂移）", () => {
  const ids = [
    "minecraft:air",
    "minecraft:sand",
    "minecraft:water",
    "minecraft:lava",
    "minecraft:magma_block",
    "minecraft:dirt",
  ];
  for (const sup of ids) {
    const probe = {
      id: sup,
      air: sup === "minecraft:air",
      liquid: sup === "minecraft:water" || sup === "minecraft:lava",
    };
    for (const a1 of ids)
      for (const a2 of ids)
        for (const w of [0, 1]) {
          const ok = judgeStandSpot(probe, a1, a2, w);
          const reason = standFailureReason(probe, a1, a2, w);
          assert.equal(ok, reason === undefined, `judge=${ok} reason=${reason}（${sup}/${a1}/${a2}/${w}）`);
        }
  }
});

// ─── 成功率与位次 ──

/** 造钓点：位次三要素（星级/成功率/距心）按需给 */
function rateSpot(key: string, level: number, rate: number, distSqCenter = 0): FishSpot {
  const stand = { x: distSqCenter, y: 64, z: 0 };
  return { stand, aim: { target: { x: stand.x + 1, y: stand.y, z: stand.z }, level }, distSqCenter, key, rate };
}

test("rankFishSpots：星级优先、同星看成功率、再同看距心", () => {
  assert.ok(rankFishSpots(rateSpot("a", 5, 0), rateSpot("b", 4, 100)) < 0, "高星压过满成功率");
  assert.ok(rankFishSpots(rateSpot("a", 4, 100), rateSpot("b", 4, 75)) < 0, "同星先试可信点");
  assert.ok(rankFishSpots(rateSpot("a", 4, 100, 1), rateSpot("b", 4, 100, 9)) < 0, "再同取近");
  assert.equal(rankFishSpots(rateSpot("a", 3, 50, 2), rateSpot("b", 3, 50, 2)), 0);
});

test("decayRate/recoverRate：一档 FISH_RATE_STEP，封底不为零杀、封顶满档", () => {
  assert.equal(decayRate(FISH_RATE_DEFAULT), FISH_RATE_DEFAULT - FISH_RATE_STEP);
  assert.equal(decayRate(FISH_RATE_MIN), FISH_RATE_MIN, "已到底不再降（除名只由结构判据决定）");
  assert.equal(recoverRate(FISH_RATE_MIN), FISH_RATE_STEP);
  assert.equal(recoverRate(FISH_RATE_DEFAULT), FISH_RATE_DEFAULT);
});

test("注入位次的池：入池即按 星级→成功率→距心 排，认领先给最优", () => {
  const pool = new SharedPool<FishSpot>(3, FISH_SPOT_STRIKES, 32, rankFishSpots);
  pool.refill([
    rateSpot("a3", 3, 100),
    rateSpot("b5r50", 5, 50),
    rateSpot("b5r100", 5, 100),
    rateSpot("b5r100n", 5, 100, 1),
  ]);
  assert.deepEqual(pool.freeKeys(), ["b5r100", "b5r100n", "b5r50", "a3"], "同星同率按距心升序");
  assert.equal(pool.claim("s1#1")?.key, "b5r100");
  pool.release("s1#1", "ok"); // 弃点归还走队尾（轮转公平，不按位次回插）
  assert.deepEqual(pool.freeKeys(), ["b5r100n", "b5r50", "a3", "b5r100"]);
});

test("strikeRelease：未达阈值转队尾（本轮先试别的点），达阈值摘出交裁决", () => {
  const pool = new SharedPool<FishSpot>(3, FISH_SPOT_STRIKES, 32, rankFishSpots);
  pool.refill([rateSpot("p", 5, 100), rateSpot("q", 5, 100, 1)]);
  assert.equal(pool.strikeRelease("s1#1").state, "none", "无占用不记账");
  assert.equal(pool.claim("s1#1")?.key, "p");
  const s1 = pool.strikeRelease("s1#1");
  assert.equal(s1.state, "retry");
  assert.equal(s1.fails, 1);
  assert.deepEqual(pool.freeKeys(), ["q", "p"], "失败点转队尾（轮转防饿死，不按位次回插）");
  pool.claim("s1#1"); // 取走 q
  assert.equal(pool.strikeRelease("s1#1").fails, 1, "各点各记各的连败账");
  assert.deepEqual(pool.freeKeys(), ["p", "q"]);
  pool.pruneFree((r) => r.key === "q"); // 附近只剩 p：连续失败才能累计到阈值
  for (let i = 2; i < FISH_SPOT_STRIKES; i++) {
    pool.claim("s1#1");
    assert.equal(pool.strikeRelease("s1#1").state, "retry", `第 ${i} 次失败仍回池`);
  }
  pool.claim("s1#1");
  const due = pool.strikeRelease("s1#1");
  assert.equal(due.state, "due", "第 3 次连败摘出交调用方裁决");
  assert.equal(due.point?.key, "p");
  assert.equal(due.fails, FISH_SPOT_STRIKES);
  assert.deepEqual(pool.freeKeys(), [], "裁决期点位不在队列（不落空、也不被他人抢走）");
  assert.equal(pool.strikeRelease("s1#1").state, "none", "摘出即已解除占用");
  assert.equal(pool.settle(due.point!, "keep"), true, "settle 后重新服务");
});

test("settle：keep 按就地改写后的成功率重排位次，降档≠除名（无更优时仍可用）", () => {
  const pool = new SharedPool<FishSpot>(3, FISH_SPOT_STRIKES, 32, rankFishSpots);
  const p = rateSpot("p", 5, 100);
  pool.refill([p, rateSpot("q", 5, 100, 1)]);
  pool.pruneFree((r) => r.key === "q");
  for (let i = 1; i < FISH_SPOT_STRIKES; i++) {
    pool.claim("s1#1");
    assert.equal(pool.strikeRelease("s1#1").state, "retry");
  }
  pool.claim("s1#1");
  const due = pool.strikeRelease("s1#1");
  assert.equal(due.state, "due");
  due.point!.rate = decayRate(due.point!.rate); // 应用侧裁决：结构仍在 → 降一档
  assert.equal(pool.settle(due.point!, "keep"), true);
  assert.equal(p.rate, FISH_RATE_DEFAULT - FISH_RATE_STEP, "100 → 75（一次裁决降一档）");
  pool.refill([rateSpot("fresh", 5, 100, 1)]);
  assert.deepEqual(pool.freeKeys(), ["fresh", "p"], "同星级里降档点沉到可信点后面");
  assert.equal(pool.claim("s2#1")?.key, "fresh");
  assert.equal(pool.claim("s3#1")?.key, "p", "降档≠除名：没有更优点时照样服务");
});

// ─── 钓点修复（星级变化即按当下世界重算，判据与组装同源） ──

test("adjacentWaterCells：与 countAdjacentWaters 同一条环查（支撑层优先，零命中下探一层）", () => {
  const flat = voxelWorld(beach(3));
  const stand = { x: -1, y: 65, z: 0 };
  assert.deepEqual(
    adjacentWaterCells(stand, flat.water),
    [{ x: 0, y: 64, z: 0 }],
    "支撑层（与水面同层）先查——平沙滩只吐沿岸那一列水"
  );
  const pond = voxelWorld(raisedPond(3));
  const feet = { x: -1, y: 64, z: 0 };
  assert.ok(
    adjacentWaterCells(feet, pond.water).every((c) => c.y === 62),
    "岸顶高 1 格形：支撑层无水面才下探一层取塘底"
  );
});

test("repairSpotAim：水面变窄即星级下调、变宽即上调（修复用与组装同一份判据）", () => {
  const wide = voxelWorld(beach(6));
  const stand = { x: -1, y: 65, z: 0 };
  const wideAim = repairSpotAim(stand, wide.water);
  assert.equal(wideAim?.level, 5, "六格水面延伸封顶 5 星");
  const narrow = voxelWorld(beach(2));
  const narrowAim = repairSpotAim(stand, narrow.water);
  assert.equal(narrowAim?.level, 2, "水被排干到两格→星级 2（调用方据此修复并重排位次）");
  assert.deepEqual(narrowAim?.target, { x: 1, y: 64, z: 0 }, "瞄准落在水面层最后一格");
  const dry = voxelWorld({ "-1,64,0": "minecraft:sand" });
  assert.equal(repairSpotAim(stand, dry.water), undefined, "周围无水=结构不成立，调用方除名");
});

// ─── 归属键＝会话键（botId 跨会话复用，上一个会话留下的占用不得堵住这一世） ──

test("ownerBotId：会话键换算回假人，非本格式一律 undefined", () => {
  assert.equal(ownerBotId("s7#1"), 7);
  assert.equal(ownerBotId("s7#42"), 7);
  assert.equal(ownerBotId("s0#1"), 0);
  assert.equal(ownerBotId("7"), undefined, "裸 botId 不是合法键");
  assert.equal(ownerBotId("bot1"), undefined);
  assert.equal(ownerBotId("s#1"), undefined);
});

test("池按会话键记账：前世那一笔不堵这一世的闸门，兜底清扫再把它收回（缺54/缺56①）", () => {
  const pool = new SharedPool<FishSpot>(3, FISH_SPOT_STRIKES, 32, rankFishSpots);
  pool.refill([rateSpot("p", 5, 100), rateSpot("q", 5, 100, 1)]);
  assert.equal(pool.claim("s7#1")?.key, "p", "上一世认领 p");
  assert.equal(
    pool.claim("s7#2")?.key,
    "q",
    "重连后的这一世照常取点（旧口径按 botId 记账：同键=已占，这里必返 null＝整池认不出）"
  );
  assert.equal(pool.claim("s7#2"), null, "同会话防囤：一点在手不给第二点");
  const alive = (owner: string) => owner === "s7#2"; // 应用侧判据=键等于当下会话键
  assert.equal(pool.sweepClaims(alive), 1, "前世那笔死账收回 1 点");
  assert.deepEqual(pool.freeKeys(), ["p"]);
  assert.equal(pool.claim("s8#1")?.key, "p", "收回的点重新服务");
});
