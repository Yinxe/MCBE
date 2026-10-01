// ─── 采集决策大脑（domain 逐拍状态机：唯一"下一步做什么"的裁决者） ───
// 每拍按当下位置重新决策，无协程等待——等待只表达为 wakeIn（能力层换算 nextWakeAt）；
// 世界读取全走注入的 senses。
// 相位：PLAN（裁决/认领）/ SCAN（分帧补扫）/ MOVE（走向当前格的一个站位列）/ MINE（当前格连挥）/
// SETTLE（起砍后的掉落扫尾窗）。
// MOVE 纪律：一个站位列发一条走位走到底，不重发；走位是否走通由 engine 逐拍位置观测裁决并回灌
// （arrived/stuck/timeout/entity_invalid/cancelled/error 见 NavRules.WalkOutcome），
// 大脑只按结论换下一候选或弃列。站位只给 xz 列与高位 Y，脚位层由引擎按列投影地面。
// MINE 纪律：挥拍受理与列推进以"目标格读回消失"为唯一事实，距离闸用 domain 破坏距
// （入圈 5.5、续航 7），单格预算内不消失才换走位——射线可见性不参与裁决。
// 单格破坏预算首格全额，同列每换一次站位减半（有下限）：够不着的列不再每轮付满额学费。
// 安全护栏先于一切效用：绝不追挖自身脚下列（先挪开站位再挖）；向下续航受坑缘截断；
// 高出当下可达带的格整列收场转下株（不攀爬追挖）。

import type { Vec3 } from "./Coords";
import { distance3d, horizontalDistance } from "./Coords";
import type { SharedPool } from "./Pool";
import type { WalkOutcome } from "./NavRules";
import type { HarvestPoint, HarvestRecipe } from "./HarvestRules";
import {
  HARVEST_BREAK_REACH,
  HARVEST_CELL_BREAK_BUDGET_TICKS,
  HARVEST_CLAIM_PROBES,
  HARVEST_DISCOVER_PROBE,
  HARVEST_DRY_TRIES,
  HARVEST_NAV_DEADLINE_TICKS,
  HARVEST_NAV_GIVEUP_TRIES,
  HARVEST_NAV_POLL_TICKS,
  HARVEST_RECHECK_TICKS,
  HARVEST_RETRY_BUDGET_FLOOR_TICKS,
  HARVEST_SCAN_BUDGET,
  HARVEST_SCAN_COOLDOWN_TICKS,
  HARVEST_SKIP_TTL,
  HARVEST_SKIP_TTL_STARVED,
  approachCandidates,
  columnKey,
  discoveryCells,
  entryTooHigh,
  inBreakReach,
  isBotOwnColumn,
  makeChainLimit,
  probeColumnBase,
  topmostPerColumn,
  upCell,
} from "./HarvestRules";

// ─── 注入契约（能力侧实现；大脑零世界访问） ────────────────────

/** 分帧区域扫描任务（能力侧包 RegionScanner） */
export interface HarvestScanJob {
  step(budget: number): Vec3[];
  readonly done: boolean;
  readonly ok: boolean;
}

/** 大脑的观测面 */
export interface HarvestSenses {
  /** 该格方块 typeId；undefined=读不到（区块未加载/实体瞬态失效），与空气语义不同 */
  read(cell: Vec3): string | undefined;
  /** 发起一次分帧区域扫描 */
  startScan(rect: { min: Vec3; max: Vec3 }, types: readonly string[]): HarvestScanJob;
  /** 人读日志（决策留痕，能力侧按 debugLog 把关） */
  log(msg: string): void;
}

/** 大脑装配参数 */
export interface HarvestBrainDeps {
  recipe: HarvestRecipe;
  pool: SharedPool<HarvestPoint>;
  /** 认领/扫描标归属键（会话键 s<botId>#<seq>） */
  owner: string;
  senses: HarvestSenses;
  /** 域级扫描节流是否到点 */
  scanDue(now: number): boolean;
  /** 记录本域扫描时刻 */
  markScanned(now: number): void;
  /** 该占用键的会话此刻是否仍在线（PLAN 顺带收回死占用） */
  claimLive(holder: string): boolean;
}

/** 大脑单拍指令（能力侧逐条执行，不做任何再判断） */
export type HarvestCommand =
  | { op: "navigate"; to: Vec3 }
  | { op: "stopMove" }
  | { op: "tool"; cell: Vec3 }
  | { op: "aim"; cell: Vec3 }
  | { op: "swing"; cell: Vec3 }
  | { op: "stopSwing" }
  | { op: "suck"; center: Vec3 }
  | { op: "autoStop"; reason: string };

export interface HarvestTickResult {
  commands: HarvestCommand[];
  /** 下一次唤起间隔（tick）；工作相恒 1（逐拍复评），等待/扫尾放宽 */
  wakeIn: number;
}

export type HarvestPhase = "PLAN" | "SCAN" | "MOVE" | "MINE" | "SETTLE";

/** 单点站位候选换尽前的同点连败止损上限（次）：够不着↔走位来回的出口 */
const MAX_RELOCATIONS = 4;
/** 走位结论的人读原因（arrived 在 MOVE 内另判"到位仍够不着"，cancelled 由 standDone 挡在门外） */
const MOVE_OUTCOME_WHY: Record<WalkOutcome, string> = {
  arrived: "到位仍够不着",
  stuck: "停滞",
  timeout: "走位超时",
  entity_invalid: "假人实体失效",
  cancelled: "走位被替换",
  error: "走位发起异常",
};
/** 作业相（MOVE/MINE/SETTLE）的磁吸节拍（tick） */
const SETTLE_SUCTION_TICKS = 5;

// ─── 大脑 ──────────────────────────────────────────────────────

export class HarvestBrain {
  private phase: HarvestPhase = "PLAN";
  private point: HarvestPoint | null = null;
  private digCell: Vec3 | null = null;
  /** 当前起挥格键（换格才重发 tool/aim；空串=未锚定） */
  private swingKey = "";
  private navDeadline = 0;
  /** 本列站位候选列（进入 MOVE 时按当下位置算一次，换格/换列重算） */
  private stands: Vec3[] = [];
  private standIdx = 0;
  /** 能力侧回灌的在途走位结论（null=结论未到，继续等；cancelled 不回灌） */
  private standOutcome: WalkOutcome | null = null;
  private relocs = 0;
  /** 本列确认破坏过的格数（>0 即本列有产出，转场失败计数清零） */
  private columnBroken = 0;
  /** 连续整列导航没走通的列数（达 HARVEST_NAV_GIVEUP_TRIES 终态） */
  private gives = 0;
  /** 本列单格破坏预算基数：换站位一次减半（下限 HARVEST_RETRY_BUDGET_FLOOR_TICKS），换列恢复全额 */
  private cellBudgetBase = HARVEST_CELL_BREAK_BUDGET_TICKS;
  private cellBudget = HARVEST_CELL_BREAK_BUDGET_TICKS;
  private settleUntil = 0;
  private lastSuckAt = 0;
  private emptyScans = 0;
  private lastScanEnd = -Infinity;
  private scanner: HarvestScanJob | null = null;
  private scanHits: Vec3[] = [];
  /** 会话私有短期跳过表：列键 → 复评时刻（够不着/走不通只对本假人失效） */
  private readonly skip = new Map<string, number>();
  /** 本轮认领复核确认已消失的列键（他人采完），认领后统一除名 */
  private dead: string[] = [];
  private finished = false;

  constructor(private readonly deps: HarvestBrainDeps) {}

  get phaseName(): HarvestPhase {
    return this.phase;
  }

  get holdsPoint(): boolean {
    return this.point !== null;
  }

  /**
   * 能力侧回灌在途走位结论（engine 按位置观测裁决，cancelled 不回灌）：
   * 只缓冲，下一拍 MOVE 消费——状态变更一律走 tick 路径。
   * @param outcome - 走位结论
   * @returns 无
   */
  standDone(outcome: WalkOutcome): void {
    if (outcome === "cancelled") return;
    this.standOutcome = outcome;
  }

  /**
   * 单拍推进（同步、短、无 IO——观测只经 deps.senses）。
   * @param now - 当前时钟 tick
   * @param bot - 假人位置（连续坐标）
   * @returns 待执行指令与下一次唤起间隔
   */
  tick(now: number, bot: Vec3): HarvestTickResult {
    if (this.finished) return { commands: [], wakeIn: HARVEST_RECHECK_TICKS };
    for (const [key, until] of this.skip) if (now >= until) this.skip.delete(key);
    switch (this.phase) {
      case "SCAN":
        return this.tickScan(now, bot);
      case "MOVE":
        return this.tickMove(now, bot);
      case "MINE":
        return this.tickMine(now, bot);
      case "SETTLE":
        return this.tickSettle(now, bot);
      default:
        return this.tickPlan(now, bot);
    }
  }

  /**
   * 会话中止（能力 stop 路径）：无条件归还持点与扫描标（幂等）。
   * @returns 待执行的急停指令
   */
  forfeit(): HarvestCommand[] {
    this.scanner = null;
    this.scanHits = [];
    this.dead = [];
    if (this.point) this.deps.pool.forceRelease(this.deps.owner);
    this.deps.pool.releaseScanToken(this.deps.owner);
    this.point = null;
    this.digCell = null;
    this.swingKey = "";
    return [{ op: "stopSwing" }, { op: "stopMove" }];
  }

  // ── PLAN：认领→补扫→判空 ──

  private tickPlan(now: number, bot: Vec3): HarvestTickResult {
    const d = this.deps;
    d.pool.sweepClaims((h) => h === d.owner || d.claimLive(h));
    if (this.gives >= HARVEST_NAV_GIVEUP_TRIES) {
      this.finished = true;
      return {
        commands: [{ op: "autoStop", reason: `连续 ${this.gives} 列导航走不过去，任务暂停` }],
        wakeIn: HARVEST_RECHECK_TICKS,
      };
    }
    if (this.point) return this.seizeColumn(now, bot);
    const claim = d.pool.claimNearest(
      d.owner,
      (p) => horizontalDistance(bot, { x: p.loc.x + 0.5, y: bot.y, z: p.loc.z + 0.5 }),
      (p) => this.entryOk(now, bot, p),
      HARVEST_CLAIM_PROBES,
      // 认领带宽已由扫描盒界定（水平 16 格，对角可达 ~22）。若再按水平 16 截断，
      // 盒角外的点既认领不到又留在池里，干涸判定永不可达——原地空转不挪窝。
      (p) => !this.skip.has(p.key)
    );
    if (this.dead.length > 0) {
      d.pool.removeKeys(this.dead);
      d.pool.pardonKeys(this.dead);
      this.dead = [];
    }
    if (claim) {
      this.point = claim;
      d.senses.log(`认领列 ${claim.key}`);
      return this.seizeColumn(now, bot);
    }
    if (
      d.pool.needsRefill() &&
      d.scanDue(now) &&
      now - this.lastScanEnd >= HARVEST_SCAN_COOLDOWN_TICKS &&
      d.pool.acquireScanToken(d.owner)
    ) {
      this.startScan(bot);
      return { commands: [], wakeIn: 1 };
    }
    if (d.pool.countUsable() > 0) return { commands: [], wakeIn: HARVEST_RECHECK_TICKS };
    if (this.emptyScans >= HARVEST_DRY_TRIES) {
      this.finished = true;
      return {
        commands: [{ op: "autoStop", reason: `连续 ${this.emptyScans} 轮扫描附近已无${d.recipe.label}` }],
        wakeIn: HARVEST_RECHECK_TICKS,
      };
    }
    return { commands: [], wakeIn: HARVEST_RECHECK_TICKS };
  }

  /**
   * 弃列复评时长：池水位不足且别无他点可领（"没别的去处"）时才缩短早复评；
   * 有他点可干就维持常规时长，别在堵住的列上反复回头。
   * @param key - 刚归还的列键（release ok 后它已回空闲队列，不算"其他可领点"）
   */
  private skipTtl(key: string): number {
    const d = this.deps;
    if (!d.pool.needsRefill()) return HARVEST_SKIP_TTL;
    return d.pool.countUsable((p) => p.key !== key && !this.skip.has(p.key)) > 0
      ? HARVEST_SKIP_TTL
      : HARVEST_SKIP_TTL_STARVED;
  }

  /**
   * 认领复核：首格成立且现场仍为目标格。
   * 脚下同列放行认领（MOVE 先挪开站位再挖）；高出当下可达带只短期跳过（不计共享失败）；
   * 首格确认已被采空→记入 dead 待统一除名；读不到（未加载）≠已消失，放行待到场复判。
   */
  private entryOk(now: number, bot: Vec3, p: HarvestPoint): boolean {
    const entry = this.deps.recipe.entryCell(p, bot);
    if (!entry) {
      if (!isBotOwnColumn(bot, p)) {
        this.skip.set(p.key, now + this.skipTtl(p.key));
        return false;
      }
      return true;
    }
    const id = this.deps.senses.read(entry);
    if (id === undefined) return true;
    if (!this.deps.recipe.isTarget(id)) {
      this.dead.push(p.key);
      return false;
    }
    return true;
  }

  /** 定桩：进入 MOVE。站位候选列到 MOVE 首拍再按当下位置现算 */
  private seizeColumn(now: number, bot: Vec3): HarvestTickResult {
    this.digCell = this.deps.recipe.entryCell(this.point!, bot);
    this.swingKey = "";
    this.resetStands(now);
    this.relocs = 0;
    this.columnBroken = 0;
    this.cellBudgetBase = HARVEST_CELL_BREAK_BUDGET_TICKS;
    this.phase = "MOVE";
    return { commands: [], wakeIn: 1 };
  }

  /**
   * 站位候选与在途走位结论一并作废（换列、换格、被推离后重选），贴靠预算随新一轮候选重计。
   * @param now - 当前时钟 tick
   * @returns 无
   */
  private resetStands(now: number): void {
    this.stands = [];
    this.standIdx = 0;
    this.standOutcome = null;
    this.navDeadline = now + HARVEST_NAV_DEADLINE_TICKS;
  }

  // ── MOVE：一个站位列一条走位走到底；结论由能力侧按引擎观测回灌 ──

  private tickMove(now: number, bot: Vec3): HarvestTickResult {
    const d = this.deps;
    if (!this.point) {
      this.phase = "PLAN";
      return { commands: [], wakeIn: 1 };
    }
    if (!this.digCell) {
      const entry = d.recipe.entryCell(this.point, bot);
      if (entry) this.digCell = entry;
    }
    if (this.digCell && inBreakReach(bot, this.digCell)) {
      this.enterMine();
      return { commands: [{ op: "stopMove" }], wakeIn: 1 };
    }
    const work = this.digCell ?? d.recipe.approachCell(this.point);
    if (this.stands.length === 0) {
      this.stands = approachCandidates(work, bot);
      this.standIdx = 0;
      return this.issueStand();
    }
    const outcome = this.standOutcome;
    if (outcome === null) {
      if (now >= this.navDeadline) {
        this.giveupColumn(now, "该列导航超时");
        return { commands: [{ op: "stopMove" }], wakeIn: 1 };
      }
      return { commands: [], wakeIn: HARVEST_NAV_POLL_TICKS };
    }
    this.standOutcome = null;
    // 停下即已投影到该列地面：水平到位却仍够不着＝落点离目标太远，同样换下一列
    return this.advanceStand(now, MOVE_OUTCOME_WHY[outcome]);
  }

  /** 换下一站位候选；候选用尽即整列弃点。why 进决策日志区分走位结论类型 */
  private advanceStand(now: number, why: string): HarvestTickResult {
    this.standIdx++;
    if (this.standIdx >= this.stands.length) {
      this.giveupColumn(now, "该列站位候选全部走不通");
      return { commands: [{ op: "stopMove" }], wakeIn: 1 };
    }
    this.deps.senses.log(`站位 ${this.standIdx}/${this.stands.length} ${why}，换下一候选`);
    return this.issueStand();
  }

  /** 朝当前候选列发一条走位（y 为高位常量，脚位层交引擎按列投影地面） */
  private issueStand(): HarvestTickResult {
    const s = this.stands[this.standIdx]!;
    this.standOutcome = null;
    return {
      commands: [{ op: "navigate", to: { x: s.x + 0.5, y: s.y, z: s.z + 0.5 } }],
      wakeIn: HARVEST_NAV_POLL_TICKS,
    };
  }

  // ── MINE：当前格逐拍连挥，读回消失即同列续航 ──

  private enterMine(): void {
    this.phase = "MINE";
    this.swingKey = "";
    this.cellBudget = this.cellBudgetBase;
  }

  private tickMine(now: number, bot: Vec3): HarvestTickResult {
    const d = this.deps;
    const cell = this.digCell;
    if (!this.point || !cell) {
      this.phase = "PLAN";
      return { commands: [{ op: "stopSwing" }, { op: "stopMove" }], wakeIn: 1 };
    }
    const id = d.senses.read(cell);
    if (id === undefined) {
      // 未加载≠列尽：耗预算复判；出预算弃点（加载是暂态，不记共享失败）
      if (--this.cellBudget <= 0) {
        this.dropPoint(now, "目标格长时间读不到", "ok");
        return { commands: [{ op: "stopSwing" }, { op: "stopMove" }], wakeIn: 1 };
      }
      return { commands: [{ op: "stopSwing" }], wakeIn: 2 };
    }
    if (!d.recipe.isTarget(id)) {
      const commands: HarvestCommand[] = [];
      this.columnBroken++;
      this.gives = 0;
      this.advanceOrFinish(now, bot, commands);
      this.magnetPulse(now, bot, commands);
      return { commands, wakeIn: 1 };
    }
    if (distance3d(bot, cell) > HARVEST_BREAK_REACH) {
      // 被击退/水流推离：回 MOVE 重选站位，不计转场失败
      const commands: HarvestCommand[] = [];
      commands.push({ op: "stopSwing" });
      this.phase = "MOVE";
      this.resetStands(now);
      return { commands, wakeIn: 1 };
    }
    if (--this.cellBudget <= 0) return this.giveUpCell(now, bot, "单格破坏预算耗尽");
    const commands: HarvestCommand[] = [];
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (key !== this.swingKey) {
      this.swingKey = key;
      this.cellBudget = this.cellBudgetBase;
      commands.push({ op: "tool", cell });
      commands.push({ op: "aim", cell });
    }
    commands.push({ op: "swing", cell });
    this.magnetPulse(now, bot, commands);
    return { commands, wakeIn: 1 };
  }

  /** 作业相磁吸节拍：起砍窗口内按拍吸附脚下范围掉落 */
  private magnetPulse(now: number, bot: Vec3, commands: HarvestCommand[]): void {
    if (now - this.lastSuckAt < SETTLE_SUCTION_TICKS) return;
    this.lastSuckAt = now;
    commands.push({ op: "suck", center: bot });
  }

  /** 当前格迟迟破不掉：高出可达带即整列收场（不攀爬追挖），否则回 MOVE 换站位 */
  private giveUpCell(now: number, bot: Vec3, why: string): HarvestTickResult {
    const commands: HarvestCommand[] = [];
    if (this.digCell && entryTooHigh(this.digCell, bot, this.deps.recipe.reachUp)) {
      this.finishColumn(now, bot, commands);
      return { commands, wakeIn: 1 };
    }
    commands.push({ op: "stopSwing" });
    this.relocs++;
    if (this.relocs > MAX_RELOCATIONS) {
      this.deps.senses.log(`弃列 ${this.point?.key}：${why}（同列换站位 ${this.relocs} 次仍破不掉）`);
      this.dropPoint(now, why, "blocked");
      commands.push({ op: "stopMove" });
      return { commands, wakeIn: 1 };
    }
    // 同列再次破不掉：下轮学费减半（有下限）——慢破坏已由首格全额预算排除，反复付满额没有信息量
    this.cellBudgetBase = Math.max(HARVEST_RETRY_BUDGET_FLOOR_TICKS, Math.floor(this.cellBudgetBase / 2));
    this.phase = "MOVE";
    this.resetStands(now);
    return { commands, wakeIn: 1 };
  }

  /** 当前格已非目标：同列续航或整列收场（读回=唯一破坏事实） */
  private advanceOrFinish(now: number, bot: Vec3, commands: HarvestCommand[]): void {
    const d = this.deps;
    const cur = this.digCell;
    if (!this.point || !cur) {
      this.phase = "PLAN";
      return;
    }
    const next = d.recipe.nextCell(cur);
    if (makeChainLimit(d.recipe.maxDown)(cur, next, bot) || entryTooHigh(next, bot, d.recipe.reachUp)) {
      this.finishColumn(now, bot, commands);
      return;
    }
    const nid = d.senses.read(next);
    if (nid === undefined) {
      // 未加载按可续航处理——留在本列由 MINE 的读不到分支耗预算复判
      this.digCell = next;
      this.swingKey = "";
      this.cellBudget = this.cellBudgetBase;
      this.phase = "MINE";
      return;
    }
    if (!d.recipe.isTarget(nid)) {
      this.finishColumn(now, bot, commands);
      return;
    }
    if (distance3d(bot, next) > HARVEST_BREAK_REACH) {
      // 续航格出了破坏距（列高于当下站位）：回 MOVE 朝该格重选站位
      this.digCell = next;
      this.swingKey = "";
      this.phase = "MOVE";
      this.resetStands(now);
      return;
    }
    this.digCell = next;
    this.swingKey = "";
    this.cellBudget = this.cellBudgetBase;
    this.phase = "MINE";
  }

  /** 整列收场：出池、6 邻发现回灌、进掉落扫尾窗 */
  private finishColumn(now: number, bot: Vec3, commands: HarvestCommand[]): void {
    const d = this.deps;
    commands.push({ op: "stopSwing" });
    const cell = this.digCell;
    if (this.point) d.pool.release(d.owner, "spent"); // 列已尽（或他人先行采完）——彻底移除，发现回灌新列
    this.point = null;
    this.digCell = null;
    this.swingKey = "";
    if (cell) this.discover(cell);
    commands.push({ op: "suck", center: bot });
    this.lastSuckAt = now;
    this.settleUntil = now + d.recipe.dropSettleTicks;
    this.phase = "SETTLE";
    d.senses.log(`整列收场（本列破坏 ${this.columnBroken} 格，换站位 ${this.relocs} 次）`);
  }

  /** 破列后 6 邻发现：新暴露列探基定顶回灌点池（去重与拉黑由池把关） */
  private discover(cell: Vec3): void {
    const d = this.deps;
    const pts: HarvestPoint[] = [];
    for (const seed of discoveryCells(cell)) {
      if (seed.x === cell.x && seed.z === cell.z) continue; // 上下邻仍是本列（已 spent），非新列
      if (!d.recipe.isTarget(d.senses.read(seed))) continue;
      const base = probeColumnBase(
        (c) => d.senses.read(c),
        (id) => d.recipe.isTarget(id),
        seed
      );
      let top = seed;
      for (let i = 0; i < HARVEST_DISCOVER_PROBE; i++) {
        const up = upCell(top);
        if (!d.recipe.isTarget(d.senses.read(up))) break;
        top = up;
      }
      pts.push({ key: columnKey(seed.x, seed.z), loc: top, base });
    }
    if (pts.length === 0) return;
    const added = d.pool.refill(pts, d.owner);
    if (added > 0) d.senses.log(`发现回灌 ${added} 个新列`);
  }

  // ── SETTLE：枯萎/物理延迟掉落的补吸窗 ──

  private tickSettle(now: number, bot: Vec3): HarvestTickResult {
    const commands: HarvestCommand[] = [];
    this.magnetPulse(now, bot, commands);
    if (now >= this.settleUntil) {
      this.phase = "PLAN";
      return { commands, wakeIn: 1 };
    }
    return { commands, wakeIn: SETTLE_SUCTION_TICKS };
  }

  // ── SCAN：就地补扫（分帧切片，一拍一块） ──

  private startScan(bot: Vec3): void {
    const d = this.deps;
    this.scanner = d.senses.startScan(d.recipe.scanRect(bot), d.recipe.scanTypeIds);
    this.scanHits = [];
    this.phase = "SCAN";
    d.senses.log("起扫（分帧）");
  }

  private tickScan(now: number, bot: Vec3): HarvestTickResult {
    const d = this.deps;
    if (!this.scanner) {
      this.phase = "PLAN";
      d.pool.releaseScanToken(d.owner);
      return { commands: [], wakeIn: 1 };
    }
    for (const h of this.scanner.step(HARVEST_SCAN_BUDGET)) this.scanHits.push(h);
    if (!this.scanner.done) return { commands: [], wakeIn: 1 };
    const ok = this.scanner.ok;
    this.scanner = null;
    this.lastScanEnd = now;
    d.pool.releaseScanToken(d.owner);
    d.markScanned(now);
    const points = topmostPerColumn(this.scanHits, bot);
    const added = d.pool.refill(points, d.owner);
    const tracked = d.pool.countTracked(points.map((p) => p.key));
    this.scanHits = [];
    if (!ok) d.senses.log("扫描不可信（部分区块未能读取），不计入干涸");
    else if (added > 0) this.emptyScans = 0;
    else if (tracked > 0)
      this.emptyScans = 0; // 列仍在池或他人手里——不是枯竭
    else {
      this.emptyScans++;
      d.senses.log(`扫描零进账（干涸 ${this.emptyScans}/${HARVEST_DRY_TRIES}）`);
    }
    this.phase = "PLAN";
    return { commands: [], wakeIn: 1 };
  }

  // ── 弃点 ──

  /**
   * 导航整列无果（候选用尽/超时/无候选）：只计会话短期跳过，不计共享失败——
   * 从当前站位走不通不代表对所有假人不成立。连续整列无果达上限才终态暂停。
   */
  private giveupColumn(now: number, why: string): void {
    this.gives++;
    this.dropPoint(now, `${why}（连续无果 ${this.gives} 列）`, "ok");
  }

  /**
   * 归还当前持点并短期跳过该列。
   * @param verdict - ok=位置性不成立（只短期跳过）；blocked=同列反复破不掉（计入共享失败计数）
   */
  private dropPoint(now: number, why: string, verdict: "ok" | "blocked"): void {
    const d = this.deps;
    if (this.point) {
      const key = this.point.key;
      d.pool.release(d.owner, verdict);
      this.skip.set(key, now + this.skipTtl(key));
      d.senses.log(`弃列 ${key}：${why}`);
    }
    this.point = null;
    this.digCell = null;
    this.swingKey = "";
    this.phase = "PLAN";
  }
}
