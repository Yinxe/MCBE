// 钓鱼流程仿真：确定性伪随机世界 + 纯 domain 模型，验证单 tick 成本有界、流程必然收敛、点位计数恒等。
// 引擎侧（getBlocks/导航）以等价预算模型代入，不依赖 @minecraft 运行时。
import test from "node:test";
import assert from "node:assert/strict";

import type { Vec3 } from "../scripts/domain/Coords";
import { horizontalDistance } from "../scripts/domain/Coords";
import { DEFAULT_CLAIM_PROBES, DEFAULT_POOL_CAP, SharedPool } from "../scripts/domain/Pool";
import type { FishSpot, SpotCandidate } from "../scripts/domain/FishingSpot";
import {
  AIM_MAX_LEVEL,
  classifyFishingScan,
  FISH_CLAIM_PROBES,
  FISH_PICK_MAX_DIST,
  FISH_RATE_DEFAULT,
  FISH_RATE_MIN,
  FISH_SCAN_COOLDOWN_TICKS,
  FISH_SCAN_RADIUS,
  FISH_SCAN_Y_RADIUS,
  FISH_SPOT_STRIKES,
  FISH_STALE_ROUNDS,
  decayRate,
  fishingSpotKey,
  rankFishSpots,
  recoverRate,
  sortSpotCandidates,
  standCenter,
  withinStandReach,
} from "../scripts/domain/FishingSpot";
import type { FishZone, ZoneRect } from "../scripts/domain/FishingZone";
import { FishingZones, ZONE_REUSE_MAX_DIST } from "../scripts/domain/FishingZone";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// ─── 确定性随机源（mulberry32：固定种子=可复现的世界） ──

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── 钓点夹具 ────────────────────────────────────────

function spot(x: number, y: number, z: number, level = 3): FishSpot {
  const stand = v(x, y, z);
  return {
    stand,
    aim: { target: stand, level },
    distSqCenter: x * x + z * z,
    key: `nether:${x},${y},${z}`,
    rate: FISH_RATE_DEFAULT,
  };
}

/** 整数格点阵（键必然互异）：从 center 按 offset 起、step 步长铺开 */
function spotGrid(center: Vec3, count: number, offset: number, step = 2): FishSpot[] {
  const out: FishSpot[] = [];
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const gx = i % side;
    const gz = Math.floor(i / side);
    out.push(spot(center.x + offset + gx * step, 64, center.z + offset + gz * step));
  }
  return out;
}

// 距离判据与生产同源：组装筛/PICK 预筛/陈旧清退/本仿真一律 withinStandReach
const farFrom =
  (home: Vec3) =>
  (p: FishSpot): boolean =>
    !withinStandReach(home, p.stand);

test("仿真·钓点池：一次扫描灌入 200 候选被容量封顶（复核成本不随池深膨胀）", () => {
  const pool = new SharedPool<FishSpot>();
  const added = pool.refill(spotGrid(v(0, 64, 0), 200, 24, 2));
  assert.equal(added, DEFAULT_POOL_CAP);
  assert.equal(pool.stats().free, DEFAULT_POOL_CAP);
  assert.ok(pool.claim("a") !== null);
  assert.equal(pool.stats().free, DEFAULT_POOL_CAP - 1, "已占用的点不占空闲容量");
});

test("仿真·钓点池：单轮认领复核不超预算，轮转保证末位候选不饿死", () => {
  const pool = new SharedPool<FishSpot>(3, 3, 64);
  const all = spotGrid(v(0, 64, 0), 40, 2, 2);
  pool.refill(all);
  const last = all[all.length - 1]!.key;
  let probes = 0;
  const accept = (p: FishSpot): boolean => {
    probes++;
    return p.key === last; // 最坏排布：唯一合格点压在队尾
  };
  let claimed: FishSpot | null = null;
  let rounds = 0;
  while (!claimed && rounds < 40) {
    claimed = pool.claimWhere("bot", accept);
    rounds++;
  }
  assert.ok(claimed, "轮转必须最终探到队尾合格点");
  assert.equal(rounds, Math.ceil(40 / DEFAULT_CLAIM_PROBES), "每轮固定预算，轮数可预测");
  assert.ok(probes <= 40, `整池至多复核一遍（实际 ${probes} 次）`);
});

test("仿真·钓点池：远点占满容量时靠陈旧轮清退重扫脱身（老逻辑在此死等）", () => {
  const home = v(0, 64, 0);
  const pool = new SharedPool<FishSpot>();
  assert.equal(pool.refill(spotGrid(home, DEFAULT_POOL_CAP, 30, 2)), DEFAULT_POOL_CAP, "远点全数入池（占满容量）"); // 全池离假人 >16 格
  assert.ok(pool.freeKeys().every((k) => k.length > 0));
  let stale = 0;
  let scans = 0;
  let probes = 0;
  let picked: FishSpot | null = null;
  for (let round = 0; round < 200 && !picked; round++) {
    picked = pool.claimWhere("bot", (p) => {
      probes++;
      return !farFrom(home)(p);
    });
    if (picked) break;
    stale = pool.stats().free > 0 ? stale + 1 : 0;
    if (stale < FISH_STALE_ROUNDS) continue;
    stale = 0;
    scans++;
    pool.pruneFree(farFrom(home));
    pool.refill(spotGrid(home, 5, 1, 1)); // 重扫在假人身边出新点
  }
  assert.ok(picked, "陈旧池必须被清退并重扫出可用点");
  assert.equal(scans, 1);
  assert.ok(probes <= FISH_CLAIM_PROBES * (FISH_STALE_ROUNDS + 1), `脱身前的复核成本有界（实际 ${probes}）`);
  assert.equal(pool.needsRefill(), false, "清退后由重扫补位——水位线本身不是脱身条件");
});

test("仿真·组装期按认领半径筛（用户实测 2026-09-28「空闲32／超距32」死循环根因）：星级优先＋容量封顶会挤光近岸点", () => {
  const home = v(0, 64, 0);
  // 事实模型：站位离岸越远连续水面越长、星级越高（5 封顶）；星级降序 ⇒ 队首永远是 16 格外的深水区站位。
  const candidates: SpotCandidate[] = [];
  for (let d = 1; d <= 30; d++) {
    for (let k = 0; k < 3; k++) {
      const stand = v(d, 64, k);
      candidates.push({
        stand,
        aim: { target: stand, level: Math.min(AIM_MAX_LEVEL, Math.ceil(d / 6)) },
        distSqCenter: d * d + k * k,
      });
    }
  }
  const nearKeys = new Set(
    candidates.filter((c) => withinStandReach(home, c.stand)).map((c) => fishingSpotKey("overworld", c.stand))
  );
  const sorted = sortSpotCandidates(candidates);
  const feed = (list: SpotCandidate[], pool: SharedPool<FishSpot>) =>
    pool.refill(
      list.map((c): FishSpot => ({ ...c, key: fishingSpotKey("overworld", c.stand), rate: FISH_RATE_DEFAULT })),
      "bot"
    );
  const nearPrefilter = (p: FishSpot): boolean => withinStandReach(home, p.stand);

  // 修复前口径对照：组装不筛距离，近岸点在入池封顶一步就被星级挤光，预筛/清退/重扫皆无解
  const legacy = new SharedPool<FishSpot>();
  feed(sorted, legacy);
  assert.equal(legacy.stats().free, DEFAULT_POOL_CAP, "修复前：入池 32（对位用户日志「空闲32」）");
  assert.equal(
    legacy.freeKeys().filter((k) => nearKeys.has(k)).length,
    0,
    "修复前：16 格内的近岸点一个都没进池（全被星级排序+容量封顶挤掉）"
  );
  assert.equal(
    legacy.claimWhere("bot", () => true, FISH_CLAIM_PROBES, nearPrefilter),
    null,
    "修复前：预筛零复核即判超距（对位「超距32」）"
  );

  // 现行口径：composeSpots 传 maxStandDist=FISH_PICK_MAX_DIST，
  // 可达筛排在封顶之前（纯算术、不占探块预算）
  const gated = new SharedPool<FishSpot>();
  feed(sortSpotCandidates(candidates.filter((c) => withinStandReach(home, c.stand))), gated);
  assert.ok(gated.stats().free > 0, "修复后：近岸点入池");
  assert.ok(
    gated.freeKeys().every((k) => nearKeys.has(k)),
    "池内全部在认领半径内（不再有超距点占容量）"
  );
  assert.ok(gated.claimWhere("bot", () => true, FISH_CLAIM_PROBES, nearPrefilter) !== null, "首拍即领到点并开钓");
});

test("仿真·水面采集失败不播报「附近没有水面」", () => {
  assert.equal(classifyFishingScan(0, 0, false), "error");
  assert.equal(classifyFishingScan(0, 0, true), "no-water");
  assert.equal(classifyFishingScan(12, 0, true), "no-spot");
  assert.equal(classifyFishingScan(12, 3, true), undefined);
});

test("仿真·钓点池：随机混合结论 200 轮账目恒等（不丢点、不双占）", () => {
  const rand = rng(0xf1545);
  const pool = new SharedPool<FishSpot>(3, 3, 64);
  assert.equal(pool.refill(spotGrid(v(0, 64, 0), 50, 2, 2)), 50, "50 点全数入池（容量 64 未触顶）");
  const bots = ["b0", "b1", "b2", "b3", "b4"];
  const held = new Set<string>();
  for (let round = 0; round < 200; round++) {
    const bot = bots[Math.floor(rand() * bots.length)]!;
    if (held.has(bot)) {
      const dice = rand();
      if (dice < 0.6) {
        pool.release(bot, "ok");
        held.delete(bot);
      } else if (dice < 0.9) {
        if (pool.noteFail(bot) === "banned") held.delete(bot); // 在场失败默认仍持有
      } else {
        pool.ban(bot);
        held.delete(bot);
      }
    } else if (pool.claimWhere(bot, () => rand() < 0.8)) {
      held.add(bot);
    }
    assert.equal(pool.stats().claimed, held.size, `第 ${round} 轮占用数应等于在册持有者`);
    assert.equal(new Set(pool.freeKeys()).size, pool.stats().free, "空闲队列不得出现重复点");
    assert.ok(pool.stats().free + pool.stats().claimed <= 64, "池深不越容量界");
  }
  for (const bot of bots) pool.forceRelease(bot);
  const { free, claimed, blacklisted } = pool.stats();
  assert.equal(claimed, 0, "强制回池后不得有残留占用（会话亡囤点泄漏）");
  assert.equal(free + blacklisted, 50, `点不丢：free ${free} + 黑标 ${blacklisted} = 入池 50`);
});

// ─── 整轮循环仿真（轮次计数 + 故障注入） ──────
// 一轮 =「挂靠钓区 → 取点 → 走位 → 抛竿 → 归还」；tick 成本按引擎侧口径建模，锁流程收敛性与单轮成本上界。
// 钓鱼侧决策走真实 FishingZones 注册表（复用/建区/并区/复核/节流/消散）；
// legacy/staleEscape 形态复现修复前判定作对照。

const ROUND_TICKS_PER_CELL = 10;
const ROUND_APPROACH_BUDGET = 120;
const ROUND_CAST_TICKS = 100;

interface FishScanOutcome {
  ok: boolean;
  water: number;
  spots: FishSpot[];
}

/** 站位结构复核四档（口径同 engine/Scanner.checkStand） */
type StandCheck = "ok" | "invalid" | "occupied" | "unreadable";

interface FishWorld {
  /** 站位的世界真实状态：是否仍站得住
   * （水被排干/支撑被挖=invalid，他人踩位=occupied，区块未加载=unreadable） */
  structure: (p: FishSpot) => StandCheck;
  scan: (nth: number, at: Vec3) => FishScanOutcome;
  nav?: (p: FishSpot) => "arrived" | "failed";
  cast: (p: FishSpot) => "ok" | "fail";
  /** 连续失败达到阈值时"按当下水面重算瞄准"是否与在册瞄准不同
   * （判据同生产 repairSpotAim，仿真只提供实际结果） */
  aimShifted?: (p: FishSpot) => boolean;
}

/** 扫描窗（±16 水平 / ±8 层高，口径同能力侧 scanRect） */
const scanBox = (at: Vec3): ZoneRect => ({
  min: { x: at.x - FISH_SCAN_RADIUS, y: at.y - FISH_SCAN_Y_RADIUS, z: at.z - FISH_SCAN_RADIUS },
  max: { x: at.x + FISH_SCAN_RADIUS, y: at.y + FISH_SCAN_Y_RADIUS, z: at.z + FISH_SCAN_RADIUS },
});

interface FishSimStats {
  casts: Array<{ bot: string; key: string; ticks: number }>;
  /** 区内各项计数 */
  created: number;
  merged: number;
  sweeps: number;
  liveZones: number;
  scans: number;
  errorScans: number;
  /** 结构失效被移出池的点数（认领复核 + 抛竿失败两条路合计） */
  removals: number;
  /** 连续失败达到阈值后落定的三路裁决：修复 / 降率 / 读不到原样回池 */
  repairs: number;
  demotions: number;
  transientKeeps: number;
  maxProbes: number;
  waits: number;
}

interface BotSim {
  zoneId: number;
  stale: number;
  scanAt: number;
}

/**
 * 钓鱼整轮仿真：每轮每个假人走一遍「复用/建区 → 认领复核 → 走位抛竿 → 结论归还」。
 * @param staleEscape - 是否启用陈旧轮清退逃逸（false=不清退，池满远点即永不重扫）
 * @param startNow - 全局单调时钟起点（多段仿真续用同一注册表时必传）
 */
function simFishRounds(
  zones: FishingZones,
  dimId: string,
  bots: readonly Vec3[],
  world: FishWorld,
  opts: { rounds: number; nowStep?: number; staleEscape?: boolean; startNow?: number }
): FishSimStats {
  const nav = world.nav ?? (() => "arrived" as const);
  const homes = bots.map((home, i) => ({ name: `b${i}`, home }));
  const state = new Map<string, BotSim>(homes.map((b) => [b.name, { zoneId: 0, stale: 0, scanAt: 0 }]));
  const stats: FishSimStats = {
    casts: [],
    created: 0,
    merged: 0,
    sweeps: 0,
    liveZones: 0,
    scans: 0,
    errorScans: 0,
    removals: 0,
    repairs: 0,
    demotions: 0,
    transientKeeps: 0,
    maxProbes: 0,
    waits: 0,
  };
  const doScan = (zone: FishZone, at: Vec3, by: string): void => {
    stats.scans++;
    zones.markScanned(dimId, now);
    const s = world.scan(stats.scans, at);
    if (classifyFishingScan(s.water, s.spots.length, s.ok) === "error") stats.errorScans++;
    zone.grow(scanBox(at)); // 覆盖盒随实际扫过的范围长大
    zone.pool.refill(s.spots, by); // 失败轮也走 refill（唯一清扫描标出口，验主）
  };
  let now = opts.startNow ?? 0;
  for (let round = 0; round < opts.rounds; round++) {
    stats.sweeps += zones.sweep(now);
    for (const { name, home } of homes) {
      const st = state.get(name)!;
      // 1. 就近钓区：以假人当下站位为准（挂靠区不粘身——被挪走后就地换区/建区）
      const found = zones.nearest(dimId, home, ZONE_REUSE_MAX_DIST);
      let zone = found ? zones.use(found.id, now) : undefined;
      if (!zone) {
        if (!zones.scanDue(dimId, now)) {
          stats.waits++;
          continue; // 同维度建区还在节流时段内，本次退避
        }
        const before = zones.zonesOf(dimId).length;
        zone = zones.create(dimId, scanBox(home), now);
        stats.created++;
        if (zones.zonesOf(dimId).length < before + 1) stats.merged++;
        st.zoneId = zone.id;
        zones.markScanned(dimId, now);
        if (!zone.pool.acquireScanToken(name)) continue;
        doScan(zone, home, name);
        continue; // 扫描跨 tick：下一轮才认领
      }
      st.zoneId = zone.id; // 挂靠区随当下站位刷新（并区后经 use 解析回存活区）
      const pool = zone.pool;
      pool.sweepScanToken((holder) => state.has(holder));
      // 2. 区内选点：距离 ≤16 预筛 + 结构复核，不成立的点当场移除；
      //    失败则解除占用、回池排队（无同点续钓通道）
      const dead: string[] = [];
      let probes = 0;
      let tooFar = 0;
      const spot = pool.claimWhere(
        name,
        (p) => {
          probes++;
          const check = world.structure(p);
          if (check === "invalid") dead.push(p.key);
          return check === "ok";
        },
        FISH_CLAIM_PROBES,
        // 距离=零成本预筛（转队尾不吃复核预算）
        (p) => {
          if (withinStandReach(home, p.stand)) return true;
          tooFar++;
          return false;
        }
      );
      stats.maxProbes = Math.max(stats.maxProbes, probes);
      if (dead.length > 0) stats.removals += pool.removeKeys(dead);
      if (!spot) {
        // 4. 无点可领：区非空才计陈旧轮；低水位/陈旧到点 → 本区再扫（单飞行标 + 双冷却）
        st.stale = pool.stats().free > 0 ? st.stale + 1 : 0;
        // 整轮一个半径内的点都没复核到 ⇒ 池点全跟着旧站位，陈旧确定成立，不等 3 轮
        const noneNear = tooFar > 0 && probes === 0;
        const forceRescan = noneNear || (opts.staleEscape === true && st.stale >= FISH_STALE_ROUNDS);
        if (
          (pool.needsRefill() || forceRescan) &&
          now >= st.scanAt &&
          zones.scanDue(dimId, now) &&
          pool.acquireScanToken(name)
        ) {
          st.scanAt = now + FISH_SCAN_COOLDOWN_TICKS;
          st.stale = 0;
          if (forceRescan) pool.pruneFree(farFrom(home));
          doScan(zone, home, name);
        } else stats.waits++;
        continue;
      }
      st.stale = 0;
      if (nav(spot) !== "arrived") {
        pool.release(name, "ok"); // 导航失败与点位无关 → 无条件回池重选
        stats.waits++;
        continue;
      }
      // 3. 抛竿结论落地：每次失败都"记一次失败 + 解除占用 + 换点"；
      //    连续失败满 FISH_SPOT_STRIKES 才落定裁决——
      //    结构塌了移除 / 环境变了修复（成功率复位）/ 结构仍在降率 / 读不到原样回池（不定罪）
      const dist = horizontalDistance(home, standCenter(spot.stand));
      stats.casts.push({
        bot: name,
        key: spot.key,
        ticks: Math.min(ROUND_APPROACH_BUDGET, Math.ceil(dist) * ROUND_TICKS_PER_CELL) + ROUND_CAST_TICKS,
      });
      if (world.cast(spot) === "ok") {
        pool.resetFail(name);
        spot.rate = recoverRate(spot.rate); // 钓获即证明点位还能服务，回一档
        pool.release(name, "ok");
        continue;
      }
      const strike = pool.strikeRelease(name);
      if (strike.state !== "due" || !strike.point) continue; // none/retry：换点，池内点位不动
      const verdict = world.structure(strike.point);
      if (verdict === "invalid") {
        pool.settle(strike.point, "drop");
        stats.removals++;
      } else if (verdict === "unreadable") {
        pool.settle(strike.point, "keep");
        stats.transientKeeps++;
      } else if (world.aimShifted?.(strike.point) === true) {
        strike.point.rate = FISH_RATE_DEFAULT; // 修复＝按当下世界重算过，成功率重新计满档
        pool.settle(strike.point, "keep");
        stats.repairs++;
      } else {
        strike.point.rate = decayRate(strike.point.rate);
        pool.settle(strike.point, "keep");
        stats.demotions++;
      }
    }
    now += opts.nowStep ?? 1;
  }
  stats.liveZones = zones.zonesOf(dimId).length;
  return stats;
}

test("仿真·钓鱼整轮：同湖多假人一次扫描全共享（就近复用零扫描成本）", () => {
  const homes = [v(0, 64, 0), v(2, 64, 2), v(4, 64, 0), v(-2, 64, 2)];
  const world: FishWorld = {
    structure: () => "ok",
    scan: () => ({ ok: true, water: 20, spots: spotGrid(v(0, 64, 0), 6, 1, 1) }),
    cast: () => "ok",
  };
  const stats = simFishRounds(new FishingZones(), "overworld", homes, world, { rounds: 12, nowStep: 5 });
  assert.equal(stats.created, 1, "首假人建区，其余就近复用——全区一次建区");
  assert.equal(stats.scans, 1, "四假人 12 轮只扫一遍（复用即零扫描）");
  assert.equal(stats.liveZones, 1);
  const perBot = new Map<string, number>();
  for (const c of stats.casts) perBot.set(c.bot, (perBot.get(c.bot) ?? 0) + 1);
  assert.equal(perBot.size, 4, "四人都吃到同一片钓点");
  for (const [bot, n] of perBot) assert.ok(n >= 10, `${bot} 轮轮有竿（实际 ${n}）`);
  assert.ok(stats.maxProbes <= FISH_CLAIM_PROBES, `单轮现场复核有界（实际峰值 ${stats.maxProbes} 点）`);
});

test("仿真·钓鱼整轮：远湖各自建区、16 格内建区即并区（在途点不丢不双占）", () => {
  const world: FishWorld = {
    structure: () => "ok",
    scan: (_nth, at) => ({ ok: true, water: 20, spots: spotGrid(at, 6, 1, 1) }),
    cast: () => "ok",
  };
  const zones = new FishingZones();
  // 西岸 0、东岸 200（远湖独立）、中间 40（与西区盒间隙 8 → 建区即并区）
  const stats = simFishRounds(zones, "overworld", [v(0, 64, 0), v(200, 64, 0), v(40, 64, 0)], world, {
    rounds: 60,
    nowStep: 5,
  });
  assert.equal(stats.created, 3, "三假人各建一次区（就近无区才扫——用户规格）");
  assert.equal(stats.merged, 1, "x/z 间隙 ≤16 的新区并入近邻成一个");
  assert.equal(stats.liveZones, 2, "并后活表=西区（含中间）+ 东区");
  assert.equal(stats.scans, 3, "各扫各的，互不越池（旧存储区共池会把人派到另一个湖）");
  const west = zones.get(1)!;
  assert.equal(west.id, 1, "存活区=最老区（id 稳定，成员无需搬迁）");
  assert.ok(west.rect.max.x >= 56, `覆盖盒随并区推进（实际 max.x=${west.rect.max.x}）`);
  assert.equal(zones.get(3)?.id, 1, "被并区退为墓碑：经解析指回存活区，不再占活表");
  assert.equal(zones.zonesOf("overworld").length, 2, "活表只剩西区与东区");
  const perBot = new Map<string, number>();
  for (const c of stats.casts) perBot.set(c.bot, (perBot.get(c.bot) ?? 0) + 1);
  assert.equal(perBot.size, 3, "三区并两区后每人都还在钓（并区不中断在途会话）");
  assert.ok(west.pool.stats().claimed <= 2, "每假人至多占一点（搬迁不产生双占）");
});

test("仿真·抛竿失败裁决（缺56）：塌了的除名，还站得住的降率留池、绝不冻结", () => {
  const home = v(0, 64, 0);
  const lake = spotGrid(home, 4, 1, 1);
  const broken = new Set([lake[0]!.key, lake[1]!.key]); // 两点结构已塌（水被排干）
  const world: FishWorld = {
    structure: (p) => (broken.has(p.key) ? "invalid" : "ok"),
    scan: () => ({ ok: true, water: 20, spots: [] }), // 无新点：只吃首轮建的池
    cast: () => "fail",
  };
  const zones = new FishingZones();
  const seeded = zones.create("overworld", scanBox(home), 0);
  seeded.pool.refill(lake);
  const stats = simFishRounds(zones, "overworld", [home], world, { rounds: 24, nowStep: 5 });
  assert.ok(stats.removals >= 2, `塌了的点必被除名（实际除名 ${stats.removals}）`);
  const perKey = new Map<string, number>();
  for (const c of stats.casts) perKey.set(c.key, (perKey.get(c.key) ?? 0) + 1);
  for (const key of broken) assert.ok(!perKey.has(key), "结构不成立的点从不抛竿（认领复核即除名）");
  assert.ok(perKey.size >= 2, `失败即切换区内其他有效点（实抛 ${perKey.size} 个点）`);
  // 锁定行为：连续失败满阈值不再拉黑冻结——结构仍在就降率留池（0% 也当保底）；
  // 是否移出池永远由结构判据决定，故"同点最多抛 3 次"不成立；此处改锁降率与留池
  const alive = lake.filter((c) => !broken.has(c.key));
  // 裁决只在连续失败满阈值那一拍发生：其余失败只是"记一笔 + 换点"
  assert.equal(
    stats.demotions + stats.repairs,
    Math.floor(stats.casts.length / FISH_SPOT_STRIKES),
    `每满 ${FISH_SPOT_STRIKES} 败裁决一次（实抛 ${stats.casts.length} 竿 → 裁决 ${stats.demotions + stats.repairs} 次）`
  );
  assert.equal(seeded.pool.stats().blacklisted, 0, "钓侧黑标制已退场（池里一个黑标都不该有）");
  assert.equal(stats.errorScans, 0, "空结果是「无新点」而非采集失败");
  const st = zones.get(seeded.id)!.pool.stats();
  assert.equal(st.claimed, 0, "收尾不囤点");
  assert.equal(st.free, alive.length, `除名即出局、好点全留池（free=${st.free}）`);
  for (const c of alive)
    assert.equal(c.rate, FISH_RATE_MIN, `连败到底也只是降到最低档（${c.rate}%）——排最后但绝不出局`);
});

test("仿真·区块读不到是世界瞬态不是点位的罪：不除名不降率，读通后照常抛竿", () => {
  const home = v(0, 64, 0);
  const lake = spotGrid(home, 3, 1, 1);
  let calls = 0;
  const world: FishWorld = {
    // 第一次认领时复核恰好碰上区块未加载（unreadable）：既不该移除点位，也不该记一笔失败
    structure: () => (++calls === 1 ? "unreadable" : "ok"),
    scan: () => ({ ok: true, water: 20, spots: [] }),
    cast: () => "fail", // 读通后每竿都失败：连续失败满阈值时结构复核已恢复 → 降率而非定罪
  };
  const zones = new FishingZones();
  const zone = zones.create("overworld", scanBox(home), 0);
  zone.pool.refill(lake);
  const stats = simFishRounds(zones, "overworld", [home], world, { rounds: 4, nowStep: 5 });
  assert.equal(stats.removals, 0, "读不到≠结构不成立（不误除名）");
  assert.equal(zone.pool.stats().blacklisted, 0, "瞬态读失败不误黑钓点（黑标=结构在而真抛不中才记）");
  assert.equal(zone.pool.stats().free + zone.pool.stats().claimed, 3, "一个点都没丢");
  assert.ok(stats.casts.length > 0, "读通后照常抛竿（流程没被瞬态卡死）");
});

test("仿真·连败满阈值即让位（缺56 优先序闭环）：同星级先钓可信点，降率后自动排到后面", () => {
  const home = v(0, 64, 0);
  const near = spot(1, 64, 1); // 同星级、同成功率 → 距心近的在前
  const far = spot(3, 64, 3);
  const world: FishWorld = {
    structure: () => "ok", // 结构一直站得住：没有任何理由移除点位或把它拉黑
    scan: () => ({ ok: true, water: 20, spots: [] }),
    cast: () => "fail",
  };
  const zones = new FishingZones();
  const zone = zones.create("overworld", scanBox(home), 0);
  zone.pool.refill([near, far]);
  const stats = simFishRounds(zones, "overworld", [home], world, { rounds: 12, nowStep: 5 });
  const keys = stats.casts.map((c) => c.key);
  assert.equal(keys.length, 12, "十二拍十二竿（池里有可用点就绝不空转）");
  for (let i = 1; i < keys.length; i++)
    assert.notEqual(keys[i], keys[i - 1], `第 ${i + 1} 拍绝不与上一拍同点——每败必换点（用户规格末句）`);
  // 连续失败计数记在点位上：未满阈值只轮转回队尾，满 FISH_SPOT_STRIKES 才降率回池
  assert.equal(stats.demotions, 4, `两点各被裁决两次（12 竿 ÷ ${FISH_SPOT_STRIKES} 连败 ÷ 2 点）`);
  assert.equal(stats.repairs, 0, "环境没变就不叫修复");
  assert.equal(stats.removals, 0, "结构在就绝除名");
  assert.equal(near.rate, FISH_RATE_DEFAULT - 50, "降率两格（100→75→50）");
  assert.equal(far.rate, FISH_RATE_DEFAULT - 50, "另一颗同步降档");
  assert.equal(zone.pool.stats().blacklisted, 0, "钓侧不再产生黑标");
});

test("仿真·连败满阈值即修复（缺56 第二路）：环境变了重算面目、成功率复位满档", () => {
  const home = v(0, 64, 0);
  const near = spot(1, 64, 1);
  const far = spot(3, 64, 3);
  const world: FishWorld = {
    structure: () => "ok",
    scan: () => ({ ok: true, water: 20, spots: [] }),
    cast: () => "fail",
    aimShifted: () => true, // 按当下水面重算的瞄准与在册不同（水涨水落、岸形改了）
  };
  const zones = new FishingZones();
  const zone = zones.create("overworld", scanBox(home), 0);
  zone.pool.refill([near, far]);
  const stats = simFishRounds(zones, "overworld", [home], world, { rounds: 12, nowStep: 5 });
  assert.equal(stats.demotions, 0, "修复路与降率路互斥");
  assert.equal(stats.removals, 0, "结构在就不除名（用户规格：变化则修复、不成立才移除）");
  assert.equal(near.rate, FISH_RATE_DEFAULT, "修复＝以新面目重新计账，成功率回满档");
  assert.equal(far.rate, FISH_RATE_DEFAULT, "同上");
  assert.equal(zone.pool.stats().free, 2, "两点都留在区里继续服务");
});

test("仿真·认领优先序：星级相同先取成功率高的点（用户规格「同星级按成功率排」）", () => {
  const home = v(0, 64, 0);
  const dubious = spot(1, 64, 1); // 更近，但因连续失败已被降档
  dubious.rate = 50;
  const trusted = spot(3, 64, 3); // 更远，成功率满档
  const pool = new SharedPool<FishSpot>(3, 3, 64, rankFishSpots); // 与生产钓鱼区点池同一比较器
  pool.refill([dubious, trusted]);
  assert.deepEqual(pool.freeKeys(), [trusted.key, dubious.key], "入池即按位次排（可信在前）");
  assert.equal(pool.claim("s1#1")?.key, trusted.key, "同星级先钓成功率高的点");
  pool.release("s1#1", "blocked"); // 连续失败降档后应排到可信点之后
  dubious.rate = 25;
  pool.forceRelease("s1#1");
  pool.settle(trusted, "keep");
  assert.equal(pool.claim("s1#1")?.key, trusted.key, "位次随成功率账本更新");
});

test("仿真·全坏点守区不消散：重扫受双冷却节流（慢操作治理）且不空转建区", () => {
  const home = v(0, 64, 0);
  const world: FishWorld = {
    structure: () => "invalid", // 站位全塌
    scan: (nth, at) => ({ ok: true, water: 20, spots: nth === 1 ? spotGrid(at, 4, 1, 1) : [] }),
    cast: () => "ok",
  };
  const stats = simFishRounds(new FishingZones(), "overworld", [home], world, { rounds: 100, nowStep: 5 });
  assert.equal(stats.casts.length, 0, "没有一个点站得住就一竿不抛（不虚假开工）");
  assert.equal(stats.created, 1, "假人仍守在同一片水域：不反复建区空转");
  assert.equal(stats.sweeps, 0, "有人挂靠即刷新使用时刻，空区宽限窗滑动（不消散）");
  assert.equal(stats.removals, 4, `复核判死的点一次除名到底（实际 ${stats.removals}）`);
  // 追加再扫受"同维度 60t + 本会话 120t"双冷却封顶（500 tick 窗口）
  assert.ok(
    stats.scans <= 1 + Math.ceil((100 * 5) / FISH_SCAN_COOLDOWN_TICKS) + 1,
    `补扫被冷却封顶（实际 ${stats.scans} 次扫描）`
  );
});

test("仿真·钓鱼整轮：并区把远岸点带进复用区时靠陈旧清退脱身（修复前在此永不抛竿）", () => {
  const home = v(0, 64, 0);
  const world: FishWorld = {
    structure: () => "ok",
    scan: (_nth, at) => ({ ok: true, water: 20, spots: spotGrid(at, 6, 1, 1) }), // 重扫在假人身边出新点
    cast: () => "ok",
  };
  const legacyPool = new SharedPool<FishSpot>();
  legacyPool.refill(spotGrid(home, DEFAULT_POOL_CAP, 30, 2)); // 全池 > 认领半径（并区搬进来的远岸点）
  let stale = 0;
  let legacyCasts = 0;
  for (let round = 0; round < 120; round++) {
    if (legacyPool.claimWhere("b0", (p) => !farFrom(home)(p), FISH_CLAIM_PROBES)) legacyCasts++;
    stale = legacyPool.stats().free > 0 ? stale + 1 : 0;
    if (stale >= FISH_STALE_ROUNDS) stale = 0; // 修复前：清退判据从不生效（无 forceRescan 分支）
  }
  assert.equal(legacyCasts, 0, "修复前：池满→水位线永不成立→永不重扫，一轮竿也抛不出");

  const zones = new FishingZones();
  const seeded = zones.create("overworld", scanBox(home), 0); // 覆盖盒含假人（就近复用命中）
  seeded.pool.refill(spotGrid(home, DEFAULT_POOL_CAP, 30, 2)); // 但池里全是邻区并进来的远点
  const fixed = simFishRounds(zones, "overworld", [home], world, { rounds: 20, nowStep: 5, staleEscape: true });
  assert.ok(fixed.casts.length > 0, "修复后：陈旧轮清退远点、重扫身边新点即开钓");
  assert.equal(fixed.scans, 1, "一次清退+重扫即脱身，不反复全池扫描");
  assert.ok(fixed.maxProbes <= FISH_CLAIM_PROBES, `单轮现场复核有界（实际峰值 ${fixed.maxProbes} 点）`);
  assert.ok(
    fixed.casts.every((c) => c.ticks <= ROUND_APPROACH_BUDGET + ROUND_CAST_TICKS),
    "单轮走位成本被靠近预算封顶"
  );
  assert.ok(zones.get(seeded.id)!.pool.stats().claimed <= 1, "并区远点清退后仍在容量界内（不越界囤点）");
  assert.ok(zones.get(seeded.id)!.pool.stats().free <= 6, "远岸 32 点清退后只剩身边新点（旧点不回潮）");
});

test("仿真·池首一排远点（用户实测 2026-09-28：入池 26 仍报无可用点）：预筛通道零复核即开钓", () => {
  const home = v(0, 64, 0);
  const world: FishWorld = {
    structure: () => "ok",
    scan: (_nth, at) => ({ ok: true, water: 20, spots: spotGrid(at, 6, 1, 1) }),
    cast: () => "ok",
  };
  const buried = (pool: SharedPool<FishSpot>) =>
    pool.refill([...spotGrid(home, 25, 30, 2), ...spotGrid(home, 1, 3, 1)]); // 25 远 + 1 近沉底
  // 修复前行为复刻：距离判据塞在 accept 里，池首远点逐轮占用 6 个复核预算
  const legacy = new SharedPool<FishSpot>();
  buried(legacy);
  let legacyProbes = 0;
  let legacyFirstCastRound = -1;
  for (let round = 0; round < 8; round++) {
    const got = legacy.claimWhere(
      "b0",
      (p) => {
        legacyProbes++;
        return !farFrom(home)(p);
      },
      FISH_CLAIM_PROBES
    );
    if (got && legacyFirstCastRound < 0) legacyFirstCastRound = round;
    legacy.release("b0", "ok");
  }
  assert.ok(legacyFirstCastRound >= 4, `修复前：轮转 26 点才够到沉底的近点（首轮即 ${legacyFirstCastRound}）`);
  assert.ok(
    legacyProbes >= 26,
    `修复前：够到近点前把 26 个点全部现场复核一遍（每点≈5 探块+1 查询，实际 ${legacyProbes} 次）`
  );

  const zones = new FishingZones();
  const seeded = zones.create("overworld", scanBox(home), 0);
  buried(seeded.pool);
  const fixed = simFishRounds(zones, "overworld", [home], world, { rounds: 5, nowStep: 5, startNow: 10 });
  assert.ok(fixed.casts.length > 0, "修复后：同一池子首拍就认领到沉底的近点并开钓");
  assert.equal(fixed.maxProbes, 1, "近点之前零复核（远点走免费通道）");
  assert.equal(fixed.scans, 0, "有现成近点就不必重扫（不为远点清退而白扫一片）");
});

test("仿真·全区点位都在半径外（并区带进邻岸远点）：免费预筛判出超距即刻清退重扫", () => {
  const home = v(0, 64, 0);
  const world: FishWorld = {
    structure: () => "ok",
    scan: (_nth, at) => ({ ok: true, water: 20, spots: spotGrid(at, 6, 1, 1) }), // 重扫在假人身边出新点
    cast: () => "ok",
  };
  const zones = new FishingZones();
  const seeded = zones.create("overworld", scanBox(home), 0);
  seeded.pool.refill(spotGrid(home, 26, 30, 2)); // 26 点全在认领半径外
  // staleEscape 缺省=不开陈旧轮逃逸：能脱身只可能是"整轮零复核→判定全超距"这条快路
  const stats = simFishRounds(zones, "overworld", [home], world, { rounds: 3, nowStep: 5, startNow: 10 });
  assert.equal(stats.scans, 1, "首拍即判超距并清退重扫（不再空等 3 个陈旧轮 ≈150t）");
  assert.ok(stats.casts.length > 0, "重扫出新点后开钓");
  assert.equal(stats.maxProbes, 1, "超距点一次昂贵复核都不该花");
});
