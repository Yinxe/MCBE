// 采集大脑行为仿真：HarvestBrain 以注入 senses 逐拍驱动（与能力层同一调用次序），
// 锁原木采集的行为签名：自树基沿列上伐、砍到够不着即整株收场转下株（不攀爬）。
// 共性契约：①采尽附近自动判停（连续干涸扫描）②导航走不通只进会话跳过表、不污共享池
// ③同格反复挥拍读回不消失（够不着）才计共享失败（连败拉黑后仍可干涸判停）。
// 行走以"引擎观测"代入：导航只裁决列（高位 Y→落点=该列自顶向下的第一处地面），
// 结论按 arrived/stuck/timeout 在若干拍后回灌大脑，与能力层 walkTo→standDone 同次序；
// 引擎真实导航/通视另有游戏内冒烟清单。
import test from "node:test";
import assert from "node:assert/strict";

import type { Vec3 } from "../scripts/domain/Coords";
import { horizontalDistance } from "../scripts/domain/Coords";
import { DEFAULT_CLAIM_PROBES, DEFAULT_POOL_CAP, SharedPool } from "../scripts/domain/Pool";
import { HarvestGrounds } from "../scripts/domain/HarvestGrounds";
import type { HarvestKindId, HarvestPoint } from "../scripts/domain/HarvestRules";
import {
  approachCandidates,
  columnKey,
  columnProbeLimit,
  HARVEST_BREAK_REACH,
  HARVEST_CLAIM_PROBES,
  HARVEST_DISCOVER_PROBE,
  HARVEST_DRY_TRIES,
  HARVEST_NAV_DEADLINE_TICKS,
  HARVEST_NAV_HIGH_Y,
  HARVEST_NAV_POLL_TICKS,
  HARVEST_NAV_WALK_BUDGET_TICKS,
  HARVEST_REACH_MARGIN,
  harvestRecipe,
  inBreakReach,
  specOf,
} from "../scripts/domain/HarvestRules";
import { NAV_CHECK_INTERVAL } from "../scripts/domain/NavRules";
import type { WalkOutcome } from "../scripts/domain/NavRules";
import type { HarvestScanJob, HarvestSenses } from "../scripts/domain/HarvestAI";
import { HarvestBrain } from "../scripts/domain/HarvestAI";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const parseCell = (k: string): Vec3 => {
  const [x, y, z] = k.split(",").map(Number);
  return { x: x!, y: y!, z: z! };
};

/**
 * 方块列世界：blocks=目标格集（read 返回采集对象 id），solid=地形格（read 返回石——非目标但可立足）。
 * read 恒有值（空格显式返回空气），undefined 只保留给"未加载"语义（本仿真不产生）。
 */
function makeWorld(typeId: string) {
  const blocks = new Set<string>();
  const solid = new Set<string>();
  return {
    blocks,
    solid,
    read: (loc: Vec3): string => {
      const k = cellKey(loc.x, loc.y, loc.z);
      if (blocks.has(k)) return typeId;
      return solid.has(k) ? "minecraft:stone" : "minecraft:air";
    },
    stack: (x: number, z: number, yFrom: number, yTo: number) => {
      for (let y = yFrom; y <= yTo; y++) blocks.add(cellKey(x, y, z));
    },
    ground: (xFrom: number, xTo: number, zFrom: number, zTo: number, yFrom: number, yTo: number) => {
      for (let x = xFrom; x <= xTo; x++)
        for (let z = zFrom; z <= zTo; z++) for (let y = yFrom; y <= yTo; y++) solid.add(cellKey(x, y, z));
    },
    /** 破一格：只移除该格、掉一份（无方块掉落物理，掉落物即本格类型） */
    breakAt: (loc: Vec3): string[] => {
      const k = cellKey(loc.x, loc.y, loc.z);
      if (!blocks.has(k)) return [];
      blocks.delete(k);
      return [typeId];
    },
  };
}
type World = ReturnType<typeof makeWorld>;
const makeLogWorld = (): World => {
  const w = makeWorld(specOf("wood").scanTypeIds[0]!);
  w.ground(-4, 20, -4, 14, 60, 63); // 平原：树干 64 起，脚层 64 可站
  return w;
};

const isSolid = (w: World, c: Vec3): boolean =>
  w.blocks.has(cellKey(c.x, c.y, c.z)) || w.solid.has(cellKey(c.x, c.y, c.z));
/**
 * 引擎贴靠落点模型：候选只给 xz 列 + 高位 Y，脚位层=该列自顶向下第一个"脚下实心"的层。
 * @returns 落点（列中心）；null=该列无地面，引擎无路可走、假人原地不动
 */
const settle = (w: World, p: Vec3): Vec3 | null => {
  const x = Math.floor(p.x);
  const z = Math.floor(p.z);
  for (let y = Math.floor(p.y); y > -64; y--) {
    if (isSolid(w, { x, y: y - 1, z })) return { x: p.x, y, z: p.z };
  }
  return null;
};

/** 纯池语义夹具：单格点 loc=base */
const pt = (key: string, x: number, y: number, z: number): HarvestPoint => {
  const loc = v(x, y, z);
  return { key, loc, base: loc };
};

// ─── 大脑单假人驱动 ─────────────────────────────────────

interface SimOptions {
  /** 挥拍受理闸（缺省恒受理）：恒 false 模拟"距离在破坏距内但引擎迟迟不破"——读回恒不消失 */
  breakGate?: (bot: Vec3, cell: Vec3) => boolean;
  /** false=导航发而不走（假人原地不动）：引擎观测到静止且未到位，结论 stuck */
  walkOk?: boolean;
  /** 每拍位移函数：模拟持续行走（如绕圈）——一直在挪就是不到，结论走满预算 timeout */
  drive?: (bot: Vec3, now: number) => Vec3;
  /** 扫描可信度（false=区块读不全的异常轮，不计入干涸） */
  scanOk?: boolean;
  maxTicks?: number;
  /** 提前停表判据（如"拿到第一个点即停"） */
  until?: (brain: HarvestBrain) => boolean;
}

interface SimStats {
  broken: number;
  breakOrder: Vec3[];
  breakBot: Vec3[];
  sucked: number;
  sucks: number;
  /** 大脑发出的挥拍指令总数（学费预算口径：每拍一条） */
  swings: number;
  scans: number;
  navigates: number;
  /** 大脑决策日志（停滞/弃列等留痕） */
  logs: string[];
  finished: boolean;
  finishWhy: string;
}

interface SimResult {
  st: SimStats;
  pool: SharedPool<HarvestPoint>;
  brain: HarvestBrain;
  bot: Vec3;
  now: number;
}

function simHarvest(kind: HarvestKindId, world: World, start: Vec3, opts: SimOptions = {}): SimResult {
  const recipe = harvestRecipe(kind);
  const pool = new SharedPool<HarvestPoint>();
  const owner = "s1#1";
  const maxTicks = opts.maxTicks ?? 20000;
  let bot = { ...start };
  let now = 0;
  const st: SimStats = {
    broken: 0,
    breakOrder: [],
    breakBot: [],
    sucked: 0,
    sucks: 0,
    swings: 0,
    scans: 0,
    navigates: 0,
    logs: [],
    finished: false,
    finishWhy: "",
  };
  const senses: HarvestSenses = {
    read: (cell) => world.read(cell),
    startScan: (rect) => {
      const hits = [...world.blocks]
        .map(parseCell)
        .filter(
          (c) =>
            c.x >= rect.min.x &&
            c.x <= rect.max.x &&
            c.y >= rect.min.y &&
            c.y <= rect.max.y &&
            c.z >= rect.min.z &&
            c.z <= rect.max.z
        );
      st.scans++;
      let delivered = false;
      const job: HarvestScanJob = {
        step: () => {
          if (delivered) return [];
          delivered = true;
          return hits;
        },
        get done() {
          return delivered;
        },
        ok: opts.scanOk !== false,
      };
      return job;
    },
    log: (msg) => {
      st.logs.push(msg);
    },
  };
  const brain = new HarvestBrain({
    recipe,
    pool,
    owner,
    senses,
    scanDue: () => true,
    markScanned: () => {},
    claimLive: (h) => h === owner,
  });
  // 在途走位（与能力层同口径）：发起后由"引擎观测"在若干拍后回灌结论，大脑只消费结论
  let walk: { outcome: WalkOutcome; at: number; land: Vec3 | null } | null = null;
  while (now <= maxTicks) {
    if (walk && now >= walk.at) {
      if (walk.land) bot = walk.land;
      brain.standDone(walk.outcome);
      walk = null;
    }
    const res = brain.tick(now, bot);
    for (const cmd of res.commands) {
      if (cmd.op === "navigate") {
        const land = opts.walkOk === false ? null : settle(world, cmd.to);
        walk = opts.drive
          ? { outcome: "timeout", at: now + HARVEST_NAV_WALK_BUDGET_TICKS, land: null }
          : land
            ? { outcome: "arrived", at: now + NAV_CHECK_INTERVAL, land }
            : { outcome: "stuck", at: now + NAV_CHECK_INTERVAL, land: null };
        st.navigates++;
      } else if (cmd.op === "swing") {
        st.swings++;
        if (opts.breakGate && !opts.breakGate(bot, cmd.cell)) continue;
        const drops = world.breakAt(cmd.cell);
        if (drops.length > 0) {
          st.broken++;
          st.breakOrder.push({ ...cmd.cell });
          st.breakBot.push({ ...bot });
          st.sucked += drops.filter(recipe.acceptsDrop).length;
        }
      } else if (cmd.op === "suck") {
        st.sucks++;
      } else if (cmd.op === "autoStop") {
        st.finished = true;
        st.finishWhy = cmd.reason;
      }
    }
    if (st.finished || (opts.until?.(brain) ?? false)) break;
    const dt = Math.max(1, res.wakeIn);
    if (opts.drive) bot = opts.drive(bot, now + dt);
    now += dt;
  }
  return { st, pool, brain, bot, now };
}

/** 破格序列按列分组（保持首次出现序）：列 → 该列破格 y 序 */
function groupByColumn(order: readonly Vec3[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const c of order) {
    const k = `${c.x}:${c.z}`;
    const ys = out.get(k);
    if (ys) ys.push(c.y);
    else out.set(k, [c.y]);
  }
  return out;
}

// ─── 行为签名 ─────────────────────────────────────────

test("采集仿真·近处成片原木逐株伐尽后自动判停：每列自树基沿列上伐，掉落全收，盒外树不误报已采尽", () => {
  const w = makeLogWorld();
  w.stack(2, 2, 64, 69);
  w.stack(5, 2, 64, 69);
  w.stack(12, 2, 64, 69); // 扫描盒内远处：须走过去
  w.stack(40, 2, 64, 69); // 扫描盒外：本轮不该发现，也不该因此不判停
  const total = 18;
  const r = simHarvest("wood", w, v(0.5, 64, 0.5));

  assert.equal(r.st.broken, total, "盒内三株整株伐尽（每列 6 格逐格砍到顶）");
  assert.equal(r.st.sucked, total, "伐干掉落物全数磁吸");
  assert.ok(r.st.navigates > 0, "存在导航走位（远处树贴靠开挖）");
  assert.ok(r.st.sucks > 5, "连挥期间按拍发磁吸指令，不是只在整列收场时吸一次");
  assert.ok(r.st.finished && r.st.finishWhy.includes("原木"), `盒内采尽后按干涸扫描判停：${r.st.finishWhy}`);
  assert.equal(w.blocks.size, 6, "扫描盒外的树原样保留——判停只代表附近已无");
  assert.equal(r.pool.stats().blacklisted, 0, "全程零共享失败标记");
  for (const [col, ys] of groupByColumn(r.st.breakOrder)) {
    assert.deepEqual(ys, [64, 65, 66, 67, 68, 69], `列 ${col} 自树基向上连伐`);
  }
});

test("采集仿真·高树干砍到够着即整株收场转下株：出可达带的树冠不爬挖、不污共享池", () => {
  const w = makeLogWorld();
  w.stack(3, 3, 64, 72); // 9 格高树干：脚层 64 + reachUp 5 → 伐到 y69 收场，y70..72 留冠
  w.stack(6, 3, 64, 69); // 旁边常规树：整株可伐
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { maxTicks: 5000 });

  assert.equal(r.st.broken, 12, "两树各伐到可达带内即止（恒 12 即证未爬冠追挖）");
  assert.equal(r.pool.stats().blacklisted, 0, "出带树冠只属当下够不着，绝不记共享池失败");
  assert.ok(w.blocks.has(cellKey(3, 70, 3)) && w.blocks.has(cellKey(3, 72, 3)), "出带树冠整段保留");
  assert.ok(!w.blocks.has(cellKey(3, 69, 3)) && !w.blocks.has(cellKey(6, 64, 3)), "高树下部与常规树均已伐尽");
  assert.deepEqual(groupByColumn(r.st.breakOrder).get("3:3"), [64, 65, 66, 67, 68, 69], "高树自基至带上限连伐");
});

test("采集仿真·身边有完整树不误报干涸：够不着的高列只进会话跳过表，池零失败也不误停", () => {
  const w = makeLogWorld();
  w.stack(1, 0, 70, 75); // 高悬列：最低格出可达带，本假人当下够不着
  w.stack(3, 0, 64, 69); // 身边完整可采树
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { maxTicks: 3000 });

  assert.equal(r.st.broken, 6, "可采的那棵沿列伐干整株");
  assert.equal(r.pool.stats().blacklisted, 0, "够不着绝不记入共享池——黑名单毒化根除");
  assert.ok(w.blocks.has(cellKey(1, 72, 0)), "高悬列保留给能站上去的场合，不被判死");
  assert.ok(!r.st.finished, "高悬列仍被池跟踪期间绝不误报'附近已无'");
});

test("采集仿真·够不着的树冠混在可采林中不阻断推进：可达原木全伐、不可达列不污池不呆停", () => {
  const w = makeLogWorld();
  w.stack(2, 0, 64, 69); // 常规可采树
  w.stack(4, 0, 64, 72); // 高树干：下部可达、70..72 出带留冠
  w.stack(6, 0, 70, 74); // 高悬列：整列当下够不着
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { maxTicks: 5000 });

  assert.equal(r.st.broken, 12, "两棵可采树都伐到可达带上限，不被夹在中间的够不着列拖住少砍");
  assert.equal(r.pool.stats().blacklisted, 0, "够不着列不记共享失败——不毒化他人也不毒化自己");
  assert.ok(!w.blocks.has(cellKey(2, 64, 0)) && !w.blocks.has(cellKey(4, 69, 0)), "两棵可采树下部均已伐尽");
  assert.ok(w.blocks.has(cellKey(4, 71, 0)), "高树留冠保留（出带不强爬）");
  assert.ok(w.blocks.has(cellKey(6, 70, 0)), "整列够不着者原样保留");
});

test("采集仿真·贴身邻株经 6 邻发现也必须自其真实树基整株伐尽：下探补出树基而非从半腰起砍", () => {
  const w = makeLogWorld();
  w.stack(16, 2, 64, 69); // 恰在初始扫描盒边缘（max x=16）：入池
  w.stack(17, 2, 64, 69); // 盒外一株：只能靠破列后 6 邻发现——发现格与被砍列顶等高（半腰）
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { maxTicks: 5000 });

  const cols = groupByColumn(r.st.breakOrder);
  assert.equal(r.st.broken, 12, "两株整株伐尽（半腰起砍的漏砍回归护栏）");
  assert.deepEqual(cols.get("17:2"), [64, 65, 66, 67, 68, 69], "邻株自下探出的真树基连伐，不是只砍半腰那一格");
  assert.equal(w.blocks.size, 0, "两株原木全部采空");
});

test("采集仿真·永远够不着的单列：反复挥拍读回不消失，同列换站位用尽才计共享失败连败拉黑", () => {
  const w = makeLogWorld();
  w.stack(12, 2, 64, 69); // 远处单列：先贴靠走位，到位后破不掉才进换站位轨道
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { breakGate: () => false, maxTicks: 40000 });

  assert.equal(r.st.broken, 0, "读回不消失就一格不计采毕");
  assert.ok(r.st.navigates >= 1, "先贴靠走位，随后在原站位反复开挥（站位仍在破坏距内不再折返导航）");
  assert.ok(
    r.st.swings <= 1500,
    `学费减半：每访一列挥空 200+100+50+50+50 拍，三访拉黑共 1350 拍（旧恒 3×1000），实际 ${r.st.swings}`
  );
  assert.ok(r.now < 3000, `减半学费+短退避让整场收敛更快（旧口径 ≈5000t+），实际 ${Math.round(r.now)}t`);
  assert.equal(r.pool.stats().blacklisted, 1, "同列换站位 5 次仍破不掉＝真够不着，连败达阈进共享黑名单");
  assert.ok(r.st.finished && r.st.finishWhy.includes("原木"), `拉黑后池脱离跟踪，干涸判停可达：${r.st.finishWhy}`);
});

test("采集仿真·挪步但不逼近同样止损：绕圈走位满单候选预算即换下一候选，不拖到整轮贴靠超时", () => {
  const w = makeLogWorld();
  w.stack(12, 2, 64, 69);
  // 导航不落地、假人恒以 7.5 格半径绕列转圈：一直在挪，到目标距离零改善
  const orbit = (bot: Vec3): Vec3 => {
    const dx = bot.x - 12;
    const dz = bot.z - 2;
    const a = 0.5 / Math.max(Math.hypot(dx, dz), 1e-6);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return { x: 12 + dx * ca - dz * sa, y: bot.y, z: 2 + dx * sa + dz * ca };
  };
  const r = simHarvest("wood", w, v(19.5, 64, 2), { walkOk: false, drive: orbit, maxTicks: 20000 });

  assert.equal(r.st.broken, 0, "没进可达带就一格不砍");
  assert.ok(
    r.st.logs.some((m) => m.includes("走位超时，换下一候选")),
    "一直在挪但就是不到——由走位预算止损换候选（旧口径靠位移窗判停滞）"
  );
  assert.ok(r.st.navigates >= 12, `每次换一候选各发一条走位，实际 ${r.st.navigates}`);
  assert.ok(
    r.st.logs.some((m) => m.includes(`该列导航超时`)),
    "整轮贴靠（8 候选）没走通即弃列，不等每个候选都跑满预算"
  );
  assert.ok(r.st.finished && r.st.finishWhy.includes("导航"), `站位反复走不通→连续无果列数达阈暂停：${r.st.finishWhy}`);
  assert.equal(r.pool.stats().blacklisted, 0, "绕圈走不通只是本假人当下无路——不污共享池");
});

test("采集仿真·无他处可去时跳过退避缩短：单堵死列 150t 即复评，不空等 600t", () => {
  const w = makeLogWorld();
  w.stack(12, 2, 64, 69);
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { walkOk: false, maxTicks: 20000 });

  assert.ok(r.st.finished && r.st.finishWhy.includes("导航"), `3 列无果即任务暂停：${r.st.finishWhy}`);
  assert.ok(
    r.now < 2400,
    `池内无其他可领点时弃列仅退避 150t（旧恒 600t 口径整场 ≈3000t+），实际 ${Math.round(r.now)}t`
  );
  assert.equal(r.pool.stats().blacklisted, 0, "导航走不通仍只短期跳过");
});

test("采集仿真·导航全程原地不动：引擎观测到静止即换下一站位候选，站位用尽整列只短期跳过", () => {
  const w = makeLogWorld();
  w.stack(12, 2, 64, 69);
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { walkOk: false, maxTicks: 20000 });

  assert.equal(r.st.broken, 0, "没走到站位就一格不砍");
  assert.ok(r.st.navigates >= 2, "停滞即换下一站位候选，多发过走位");
  assert.ok(r.now >= NAV_CHECK_INTERVAL, "停滞结论按引擎观测节拍（一拍静止）回报，不瞬时弃点");
  assert.ok(
    r.st.logs.some((m) => m.includes("停滞，换下一候选")),
    "原地停下且没到位＝stuck，换下一候选（不是等整轮超时）"
  );
  assert.equal(r.pool.stats().blacklisted, 0, "从站位走不通不代表对所有假人不成立——绝不记共享失败");
});

test("采集仿真·扫描异常轮不计入干涸（异常≠无资源）：可信空轮满 3 轮才判停", () => {
  const w = makeLogWorld();
  const bad = simHarvest("wood", w, v(0.5, 64, 0.5), { scanOk: false, maxTicks: 3000 });
  assert.ok(bad.st.scans >= 3 && !bad.st.finished, "连串不可信扫描绝不判'附近已无'");

  w.stack(2, 2, 64, 69);
  const good = simHarvest("wood", w, v(0.5, 64, 0.5), { maxTicks: 5000 });
  assert.ok(good.st.finished && good.st.broken === 6, "可信轮下采尽即判停");
});

test("采集仿真·会话中止即还点还标：forfeit 归还持点并急停，扫描标不被死会话扣住", () => {
  const w = makeLogWorld();
  w.stack(2, 2, 64, 69);
  const r = simHarvest("wood", w, v(0.5, 64, 0.5), { until: (b) => b.holdsPoint });
  assert.ok(r.brain.holdsPoint, "先决条件：已持点");
  assert.equal(r.pool.stats().claimed, 1);
  const ops = r.brain.forfeit().map((c) => c.op);
  assert.deepEqual(ops.sort(), ["stopMove", "stopSwing"], "急停指令=停挥+停走");
  assert.equal(r.pool.stats().claimed, 0, "持点归还共享池");
  assert.ok(r.pool.acquireScanToken("other#9"), "扫描标可被他人接走（forfeit 已释放）");
});

// ─── 成本有界 ─────────────────────────────────────────

test("流程仿真·容量封顶：百列候选一灌即截断，池深恒定 32", () => {
  const pool = new SharedPool<HarvestPoint>();
  const many: HarvestPoint[] = Array.from({ length: 100 }, (_, i) => pt(columnKey(i, 0), i, 64, 0));
  assert.equal(pool.refill(many), DEFAULT_POOL_CAP);
  assert.equal(pool.stats().free, DEFAULT_POOL_CAP);
});

test("流程仿真·认领复核预算：每轮 ≤6 点，队尾合格点轮转必达不饿死", () => {
  const pool = new SharedPool<HarvestPoint>(3, 3, 64);
  const all: HarvestPoint[] = Array.from({ length: 40 }, (_, i) => pt(columnKey(i, 0), i, 64, 0));
  pool.refill(all);
  const last = all[all.length - 1]!.key;
  let probes = 0;
  let claimed: HarvestPoint | null = null;
  let rounds = 0;
  while (!claimed && rounds < 40) {
    claimed = pool.claimWhere("bot", (p) => (probes++, p.key === last), HARVEST_CLAIM_PROBES);
    rounds++;
  }
  assert.ok(claimed, "轮转必须最终探到队尾合格点");
  assert.equal(rounds, Math.ceil(40 / HARVEST_CLAIM_PROBES), "每轮固定预算，轮数可预测");
  assert.ok(probes <= 40, `整池至多复核一遍（实际 ${probes} 次）`);
});

test("流程仿真·claimNearest 位次与预算：rank 升序复核、cut 零成本出局、复核未中回队尾", () => {
  const pool = new SharedPool<HarvestPoint>(3, 3, 64);
  const all: HarvestPoint[] = Array.from({ length: 12 }, (_, i) => pt(columnKey(i, 0), i, 64, 0));
  pool.refill(all);
  assert.equal(
    pool.claimNearest(
      "b",
      () => 0,
      () => false,
      6
    ),
    null
  );
  assert.deepEqual(
    pool.freeKeys(),
    ["6:0", "7:0", "8:0", "9:0", "10:0", "11:0", "0:0", "1:0", "2:0", "3:0", "4:0", "5:0"],
    "复核未中的 6 点回队尾、其余保持原位——不丢点、下轮轮转"
  );
  const got = pool.claimNearest(
    "b",
    (p) => p.loc.x,
    () => true,
    2,
    (p) => p.loc.x <= 3
  );
  assert.ok(got && Number(got.key.split(":")[0]) <= 3, "cut 不成立的候选不参与评选");
});

test("流程仿真·多假人就近认领零冲突：各拿各的近点、同点双占不存在", () => {
  const pool = new SharedPool<HarvestPoint>(3, 3, 64);
  pool.refill(Array.from({ length: 8 }, (_, i) => pt(columnKey(i, 0), i, 64, 0)));
  const rank =
    (at: Vec3) =>
    (p: HarvestPoint): number =>
      horizontalDistance(at, { x: p.loc.x + 0.5, y: at.y, z: p.loc.z + 0.5 });
  const a = v(0.5, 64, 0.5);
  const b = v(7.5, 64, 0.5);
  const ka = pool.claimNearest("sa", rank(a), () => true, HARVEST_CLAIM_PROBES);
  const kb = pool.claimNearest("sb", rank(b), () => true, HARVEST_CLAIM_PROBES);
  assert.equal(ka?.key, "0:0", "A 拿离自己最近的");
  assert.equal(kb?.key, "7:0", "B 拿离自己最近的");
  assert.equal(
    pool.claimNearest("sa", rank(a), () => true, HARVEST_CLAIM_PROBES),
    null,
    "持点者不得再领（防囤）"
  );
  assert.equal(pool.stats().claimed, 2);
  pool.release("sa", "ok");
  pool.release("sb", "spent");
  assert.equal(pool.freeKeys().includes("7:0"), false, "spent 除名不回流");
});

test("流程仿真·多假人同池互斥：每 bot 至多一点、并发认领不重样、全 spent 后水位线触发补扫", () => {
  const pool = new SharedPool<HarvestPoint>(3, 3, 64);
  pool.refill(Array.from({ length: 12 }, (_, i) => pt(columnKey(i, 0), i, 64, 0)));
  const bots = ["a", "b", "c"];
  for (let round = 0; round < 4; round++) {
    const held = new Map<string, string>();
    for (const bot of bots) {
      const p = pool.claimWhere(bot, () => true, HARVEST_CLAIM_PROBES);
      assert.ok(p, `第 ${round} 轮 ${bot} 应有点可领`);
      held.set(bot, p!.key);
      assert.equal(
        pool.claimWhere(bot, () => true, HARVEST_CLAIM_PROBES),
        null,
        "持点者不得再领（防囤）"
      );
    }
    assert.equal(new Set(held.values()).size, bots.length, "同轮各 bot 点位互不重复");
    for (const [bot, key] of held) {
      assert.equal(pool.freeKeys().includes(key), false, "已占用点不在空闲队列");
      pool.release(bot, "spent");
    }
  }
  assert.equal(pool.stats().free, 0, "全 spent——除名不回流");
  assert.ok(pool.needsRefill(), "耗尽后水位线触发补扫");
});

test("流程仿真·blocked 连败 3 全局共享：他人认领直接跳过且不占复核预算", () => {
  const pool = new SharedPool<HarvestPoint>();
  const p = pt("3:7", 3, 64, 7);
  pool.refill([p]);
  for (let i = 1; i <= 3; i++) {
    const c = pool.claimWhere("b1", () => true, 1);
    assert.ok(c);
    pool.release("b1", "blocked");
  }
  const st = pool.stats();
  assert.equal(st.blacklisted, 1);
  assert.equal(st.free, 0, "达阈那次不回流");
  assert.equal(
    pool.claimWhere("b2", () => true, HARVEST_CLAIM_PROBES),
    null,
    "已拉黑的点空转出局"
  );
  assert.equal(pool.refill([p], "b2"), 0, "拉黑后池不再收它——不清除就永不回池");
});

test("流程仿真·一次性赦免复现后必收敛：3 轮空手即达干涸轮数，不无限复现", () => {
  const pool = new SharedPool<HarvestPoint>();
  const p = pt("2:2", 2, 64, 2);
  pool.refill([p]);
  for (let i = 0; i < 3; i++) {
    pool.claimWhere("b", () => true, 1);
    pool.release("b", "blocked");
  }
  assert.equal(pool.stats().blacklisted, 1);
  let revived = false;
  let emptyScans = 0;
  let scans = 0;
  while (emptyScans < HARVEST_DRY_TRIES) {
    scans++;
    let added = pool.refill([p], "b");
    if (added === 0 && !revived) {
      const st = pool.stats();
      if (st.free === 0 && st.claimed === 0 && st.blacklisted > 0) {
        assert.equal(pool.pardonKeys([p.key]), 1, "赦免同时清失败次数");
        revived = true;
        added = pool.refill([p], "b");
      }
    }
    emptyScans = added > 0 ? 0 : emptyScans + 1;
    const c = pool.claimWhere("b", () => true, 1);
    if (c) pool.release("b", "blocked");
  }
  assert.equal(scans, 4, "1 轮复现 + 3 轮空手即达干涸轮数，不无限复现");
});

test("流程仿真·判死除名连失败次数作废：死键拉黑残留清退后同列资源可再入池", () => {
  const pool = new SharedPool<HarvestPoint>();
  const dead = pt("9:9", 9, 64, 9);
  pool.refill([dead]);
  pool.claimWhere("b", () => true, 1);
  pool.release("b", "blocked"); // fails=1
  pool.claimWhere("b", () => true, 1);
  pool.release("b", "blocked"); // fails=2
  pool.claimWhere("b", () => true, 1);
  pool.ban("b"); // 直接拉黑（与大脑 blocked 达阈同构）
  assert.equal(pool.stats().blacklisted, 1);
  pool.removeKeys([dead.key]); // 认领复核判死 → removeKeys + pardonKeys
  pool.pardonKeys([dead.key]);
  const st = pool.stats();
  assert.equal(st.blacklisted, 0);
  assert.equal(st.free, 0);
  const reborn = pt("9:9", 9, 65, 9); // 同列重生到新顶格
  assert.equal(pool.refill([reborn], "b"), 1, "旧账清零后同列以新面目复现");
});

test("流程仿真·发现回吐与池去重：known 列拒收、占用列拒收、拉黑列拒收", () => {
  const pool = new SharedPool<HarvestPoint>();
  const a = pt("0:0", 0, 65, 0);
  const b = pt("1:0", 1, 64, 0);
  const c = pt("2:0", 2, 64, 0);
  pool.refill([a, c]);
  pool.claimWhere("x", () => true, 1); // 领走 a
  for (let i = 0; i < 3; i++) {
    const got = pool.claimWhere("y", () => true, 1);
    if (got) pool.release("y", "blocked");
  } // c 连败三次被拉黑
  assert.equal(pool.refill([a, b, c], "x"), 1, "占用/拉黑都拒收，只有新列 b 入池");
  assert.equal(pool.refill([b], "x"), 0, "known 去重");
});

// ─── 贴靠落点：候选只给列，脚位层由引擎按列投影地面 ──
// 复现 engine 语义：导航到 (x, 高位 Y, z) 落到该列自顶向下的第一处地面，脚本侧不判可站性。
const projectGround = (w: Set<string>, c: Vec3): number | null => {
  for (let y = Math.floor(c.y); y > -64; y--) if (w.has(cellKey(c.x, y - 1, c.z))) return y;
  return null;
};
const footOf = (c: Vec3, y: number): Vec3 => v(c.x + 0.5, y, c.z + 0.5);

test("贴靠仿真·平地树：环列皆投影到地面层，站进去第一拍就够得着；目标列投影是树顶故不入候选", () => {
  const w = new Set<string>();
  for (let x = 0; x <= 10; x++) for (let z = 160; z <= 175; z++) w.add(cellKey(x, 63, z)); // 地面实心层
  for (let y = 64; y <= 69; y++) w.add(cellKey(5, y, 168)); // 6 格树干
  const bot = v(5.5, 64, 175.5); // 站在地上（脚位层 64），正北 7 格
  const base = v(5, 64, 168);

  assert.equal(projectGround(w, v(base.x, HARVEST_NAV_HIGH_Y, base.z)), 70, "目标列投影落点是树顶——故候选环不含本列");

  const cells = approachCandidates(base, bot);
  assert.equal(cells.length, 8);
  for (const c of cells) {
    const y = projectGround(w, c);
    assert.equal(y, 64, `环列 ${JSON.stringify(c)} 投影到地面层`);
    assert.ok(inBreakReach(footOf(c, y!), base), "到位判据与就地开挖判据同闸");
  }
  assert.equal(cells[0]!.z, 169, "首选＝离假人最近的南侧贴靠列（正北 7 格外走过来）");
});

test("贴靠仿真·山坡高树基：低处假人也能由坡顶列投影到基座同层（旧口径此处恒判无站位）", () => {
  const w = new Set<string>();
  // 坡面向树升高：树柱及紧邻 x=5..7 实心地表堆到 y=67（坡顶面之上 y=68 起为空气）
  for (let x = 5; x <= 7; x++) for (let z = 166; z <= 170; z++) for (let y = 50; y <= 67; y++) w.add(cellKey(x, y, z));
  for (let y = 68; y <= 73; y++) w.add(cellKey(5, y, 168)); // 坡顶树干：最低原木基座 y=68
  const bot = v(12.5, 64, 168.5); // 低处平地（脚层 64），正东 7 格外
  const base = v(5, 68, 168);

  const stands = approachCandidates(base, bot).flatMap((c) => {
    const y = projectGround(w, c);
    return y === null || !inBreakReach(footOf(c, y), base) ? [] : [{ c, y }];
  });
  assert.ok(
    stands.some((s) => s.y === 68),
    "坡顶侧身列投影到基座同层——假人被投到与树基齐平处，不需脚本猜层"
  );
  assert.ok(
    stands.every((s) => inBreakReach(footOf(s.c, s.y), base)),
    "落点复判仍走过不到位闸（够不着的列不判到位）"
  );
});

test("贴靠仿真·密林四面包围：正贴列投影到邻株树顶够不着，斜角列投影到地面即贴位", () => {
  const w = new Set<string>();
  for (let x = 2; x <= 8; x++) for (let z = 165; z <= 171; z++) w.add(cellKey(x, 63, z));
  const base = v(5, 64, 168);
  const trunk = (x: number, z: number): void => {
    for (let y = 64; y <= 69; y++) w.add(cellKey(x, y, z));
  };
  trunk(base.x, base.z);
  trunk(4, 168); // 四正邻都是别人的整棵树
  trunk(6, 168);
  trunk(5, 167);
  trunk(5, 169);

  const cells = approachCandidates(base, v(5.5, 64, 175.5));
  const usable = cells.filter((c) => {
    const y = projectGround(w, c);
    return y !== null && inBreakReach(footOf(c, y), base);
  });
  assert.ok(usable.length > 0, "斜角列地面投影仍可用——四面包围不会一个落点都没有");
  assert.ok(
    usable.every((c) => Math.abs(c.x - base.x) + Math.abs(c.z - base.z) === 2),
    `可用落点只可能是斜角列（正贴列投影到邻株顶出闸）：${JSON.stringify(usable)}`
  );
});

test("贴靠仿真·无地面地形（水面悬空原木）：环列投影全空＝引擎无路可走，一轮候选走不通即弃列", () => {
  const w = makeWorld(specOf("wood").scanTypeIds[0]!);
  w.blocks.add(cellKey(5, 64, 168)); // 单格原木悬空：四周与下方皆无支撑
  const ring = approachCandidates(v(5, 64, 168), v(5.5, 64, 178.5));
  assert.ok(
    ring.every((c) => projectGround(new Set([...w.blocks, ...w.solid]), c) === null),
    "候选恒在目标环内——远处岸线不算贴位"
  );

  const r = simHarvest("wood", w, v(5.5, 64, 178.5), { maxTicks: 20000 });
  assert.equal(r.st.broken, 0, "没有落脚点就一格不砍");
  assert.ok(
    r.st.logs.some((m) => m.includes("停滞，换下一候选")),
    "落点无地面＝引擎静止未到位，按 stuck 换下一列"
  );
  assert.ok(r.st.finished && r.st.finishWhy.includes("导航"), `连续整列走不通即暂停：${r.st.finishWhy}`);
  assert.equal(r.pool.stats().blacklisted, 0, "走不通只对本假人当下成立——不污共享池");
});

// ─── 常量自洽与注册表 ─────────────────────────────────

test("常量自洽：单候选走位预算先于整轮贴靠超时、认领预算与池默认一致、探基上限不超列理论最长", () => {
  assert.ok(
    NAV_CHECK_INTERVAL <= HARVEST_NAV_WALK_BUDGET_TICKS && HARVEST_NAV_WALK_BUDGET_TICKS < HARVEST_NAV_DEADLINE_TICKS,
    "静止观测一拍即回结论、单候选预算先于整轮超时——走不通先止损换候选，而不是拖满整轮预算"
  );
  assert.equal(HARVEST_NAV_POLL_TICKS, NAV_CHECK_INTERVAL, "大脑唤醒节拍与引擎观测节拍一致——不早醒空转、不晚醒压结论");
  assert.equal(HARVEST_CLAIM_PROBES, DEFAULT_CLAIM_PROBES, "大脑单轮认领预算与池默认一致");
  assert.ok(
    HARVEST_DISCOVER_PROBE <= columnProbeLimit(specOf("wood")),
    "6 邻探基上限不得超过扫描盒内列理论最长——否则探基永远触不到底"
  );
});

test("采集地注册表：域隔离、60t 单飞节流、forgetBot 清囤点与死扫描标", () => {
  const grounds = new HarvestGrounds();
  const woodPool = grounds.pool("minecraft:overworld", "wood");
  assert.equal(grounds.pool("minecraft:overworld", "wood"), woodPool, "同域同池（多假人共享）");
  assert.notEqual(grounds.pool("minecraft:nether", "wood"), woodPool);

  assert.equal(grounds.scanDue("minecraft:overworld", "wood", 59), false, "新域节流戳自 0 起（世界开局 3 秒内不催扫）");
  assert.ok(grounds.scanDue("minecraft:overworld", "wood", 60));
  grounds.markScanned("minecraft:overworld", "wood", 100);
  assert.equal(grounds.scanDue("minecraft:overworld", "wood", 159), false, "60t 内同域再扫=成片卡顿");
  assert.ok(grounds.scanDue("minecraft:overworld", "wood", 160));
  assert.ok(grounds.scanDue("minecraft:nether", "wood", 159), "节流按域独立");

  const p = pt("1:1", 1, 64, 1);
  woodPool.refill([p]);
  assert.ok(woodPool.acquireScanToken("s7#1"));
  woodPool.claimWhere("s7#1", () => true, 1);
  grounds.forgetBot(7);
  assert.equal(woodPool.stats().claimed, 0);
  assert.equal(woodPool.stats().free, 1, "囤点归还共享");
  assert.ok(woodPool.acquireScanToken("s8#1"), "死扫描标已清");

  grounds.forgetBot(999); // 全零域顺手丢弃（再取即新建）
  assert.deepEqual(grounds.stats("minecraft:nether", "wood"), { free: 0, claimed: 0, blacklisted: 0, lastScanAt: 0 });
});
