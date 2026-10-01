// ─── 自动钓鱼能力 ──────────────────────────────────────────────────
// 相位机驱动寻点→导航→抛竿→等咬→收竿→拾取循环；同一钓点继续钓时从 ALIGN 相位重新进入。
// 能力是全局单例、零实例字段，每假人状态挂 data["fishing"]。
// tick 回调同步短小无 await，导航/抛收竿协程只把纯结果写回上下文槽位（F-18）。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import { ownerBotId } from "../../domain/Session";
import type { Vec3 } from "../../domain/Coords";
import { horizontalDistance } from "../../domain/Coords";
import type { NavOutcome } from "../../domain/NavRules";
import { ACTION_HOLD_TTL_TICKS, GAZE_HOLD_TTL_TICKS } from "../../domain/Leases";
import { CancelToken } from "../../domain/Cancellation";
import { computeTargetYaw } from "../../domain/Angle";
import { diffLootCounts, lootFingerprint } from "../../domain/Fingerprint";
import { FISHING_LOOT_IDS } from "../../domain/WorkChest";
import type { FishSpot, FishFailReason } from "../../domain/FishingSpot";
import {
  MAINHAND_SLOT,
  NOTIFY_RADIUS,
  SPOT_NOTIFY_RADIUS,
  WATER_BLOCK_IDS,
  FISH_ALIGN_DIST,
  FISH_ALIGN_FAIL_DIST,
  FISH_BACKPACK_NEAR_FULL_GAP,
  FISH_CLAIM_PROBES,
  FISH_COMPOSE_MAX_STANDS,
  FISH_INIT_TICKS,
  FISH_NOTIFY_COOLDOWN_TICKS,
  FISH_PICK_MAX_DIST,
  FISH_RECHECK_TICKS,
  FISH_STALE_ROUNDS,
  FISH_SCAN_BUDGET,
  FISH_SCAN_COOLDOWN_TICKS,
  FISH_SCAN_RADIUS,
  FISH_SCAN_Y_RADIUS,
  FISH_SPOT_STRIKES,
  FISH_RATE_DEFAULT,
  FISH_SUCK_PULSE_TICKS,
  classifyFishingScan,
  decayRate,
  fishingSpotKey,
  fishFailureLabel,
  isAtStandSpot,
  recoverRate,
  repairSpotAim,
  standAuditLabel,
  standCenter,
  withinStandReach,
} from "../../domain/FishingSpot";
import {
  BITE_CHECK_TICKS,
  BITE_TIMEOUT_TICKS,
  LOOT_SETTLE_TICKS,
  STABILIZE_TICKS,
  initBiteState,
  updateBiteTracker,
} from "../../domain/BiteWatch";
import type { BiteState } from "../../domain/BiteWatch";
import type { FishZone } from "../../domain/FishingZone";
import { ZONE_REUSE_MAX_DIST } from "../../domain/FishingZone";
import { angler } from "../../engine/Angler";
import type { CastResult } from "../../engine/Angler";
import { blockCenter, readBlock } from "../../engine/Atomic";
import { gaze } from "../../engine/Gaze";
import { suction } from "../../engine/DropSuction";
import { mover } from "../../engine/Mover";
import { RegionScanner, spotScanner } from "../../engine/Scanner";
import type { RegionRect } from "../../engine/Scanner";
import type { EntityOps } from "../../engine/EntityOps";
import type { Runtime } from "../Runtime";
import type { BotEventBus } from "../Events";
import { ctxOf } from "./Common";

type FishPhase = "INIT" | "PICK" | "SCAN" | "NAV" | "ALIGN" | "CAST" | "SETTLE" | "WATCH" | "REEL" | "LOOT";

/** 异步原子在途结果槽（F-18：token 取消 + 纯结果回写） */
interface AtomSlot<R> {
  inFlight: boolean;
  token: CancelToken | null;
  result: R | null;
}

/** 收竿意图（决定 REEL 完成后的分流） */
type ReelKind = "bite" | "timeout" | "early";

interface FishCtx {
  /** 当前独占钓点（null=未持有） */
  spot: FishSpot | null;
  /** 本会话所在钓区 id（0=未挂；区合并/消散由注册表解析，start 时不固定具体区） */
  zoneId: number;
  /** 连续"池非空却无点可认领"轮数（点位池陈旧的判据，见 FISH_STALE_ROUNDS） */
  staleRounds: number;
  /** 下次允许扫描的时间（冷却截止 tick） */
  scanCooldownAt: number;
  scanner: RegionScanner | null;
  water: Vec3[];
  nav: AtomSlot<NavOutcome>;
  align: AtomSlot<NavOutcome>;
  cast: AtomSlot<CastResult>;
  reel: AtomSlot<CastResult> & { kind: ReelKind };
  /** 落点异常时提前收竿的原因；收竿完成后按点位失败处理 */
  earlyReason: "landed" | "snagged" | null;
  /** 同一钓点连续"找不到鱼钩"次数：无钩不等于点位失败，累计达 FISH_SPOT_STRIKES 才按点位失败换点 */
  lostStreak: number;
  /** 当前鱼钩所属点位键（null=无钩或归属已失效）；换点后旧钓点遗留的钩不能当作本点已抛 */
  hookKey: string | null;
  bite: BiteState;
  watchDeadline: number;
  /** 渔获事件采集窗口（WATCH 期间开启、REEL 结束）：窗口外的槽位变化（抛竿/换竿/卸载）不计入渔获 */
  lootWindow: boolean;
  pendingLoot: Record<string, number>;
  /** 收竿前的背包快照基准（事件漏计时改用快照差集） */
  lootBefore: Record<string, number> | null;
  /** 找点相关播报的节流截止 tick */
  notifyAt: number;
  /** 下次吸取节拍的时间（tick 截止）：半径内散件与经验球按 FISH_SUCK_PULSE_TICKS 吸附 */
  suckAt: number;
}

/** 水面方块 id 集合（与扫描白名单同一份定义） */
const WATER_ID_SET = new Set<string>(WATER_BLOCK_IDS);

/**
 * 渔获掉落类型白名单：真源在 domain/WorkChest（吸取过滤与工作箱搬运共用一份）。
 * 引擎的物品实体不携带来源归属信息，只能按类型过滤：
 * 吸取只收渔获相关掉落，避免把邻位作业假人的采集掉落吸进本假人背包。
 */
const FISHING_LOOT_ID_SET = new Set<string>(FISHING_LOOT_IDS);

/** 掉落物是否属渔获候选类型 */
function isFishingLoot(typeId: string): boolean {
  return FISHING_LOOT_ID_SET.has(typeId);
}

/** 判断某格是否为水面：与扫描、复核共用同一读块逻辑，用于重算瞄准点 */
function waterProbeAt(dimId: string): (p: Vec3) => boolean {
  return (p) => {
    const info = readBlock(dimId, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
    return info !== undefined && WATER_ID_SET.has(info.id);
  };
}

/**
 * 自动钓鱼能力（record.workMode=fishing）。
 * 钓点由 fishingZones 统一管理：就近复用、无区建区、间隙 ≤16 格的区合并。
 */
export class FishingCap implements Capability {
  readonly id = "fishing" as const;

  constructor(
    private readonly runtime: Runtime,
    private readonly ops: EntityOps,
    events: BotEventBus
  ) {
    // 渔获事件收集：只统计 lootWindow 开启期间的槽位变化，窗口外（抛竿/换竿/卸载）一律忽略
    events.on("botSlotChanged", (ev) => this.collectLoot(ev.botId, ev.slot, ev.item));
  }

  requires(): LeaseRequest[] {
    return [{ kind: "gaze" }, { kind: "hands" }, { kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const record = this.runtime.record(session.botId);
    if (!record) return "记录缺失";
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf(cap.data, "fishing", () => FishCtxSeed());
    cap.phase = { name: "INIT", nextWakeAt: now + FISH_INIT_TICKS };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    const ctx = cap?.data["fishing"] as FishCtx | undefined;
    if (!cap || !ctx) return;
    // 三租约心跳续租（gaze 供 ALIGN 注视维持、motion 供导航、hands 供抛收竿）
    session.leases.renew("gaze", this.id, now, GAZE_HOLD_TTL_TICKS);
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    // 吸取心跳：收竿后散件与经验球会漂动/晚出现，单次吸取有漏；按节拍把半径内
    // 渔获白名单掉落与经验球吸到脚下（落点恒为本假人，归属账防邻家互夺）
    if (now >= ctx.suckAt) {
      ctx.suckAt = now + FISH_SUCK_PULSE_TICKS;
      const at = mover.snapshotOf(session.botId);
      if (at) suction.suck(at.dimensionId, at.location, isFishingLoot, session.botId, { experienceOrbs: true });
    }
    switch (cap.phase.name as FishPhase) {
      case "PICK":
        this.pick(session, ctx, now);
        break;
      case "SCAN":
        this.scan(session, ctx, now);
        break;
      case "NAV":
        this.nav(session, ctx, now);
        break;
      case "ALIGN":
        this.align(session, ctx, now);
        break;
      case "CAST":
        this.cast(session, ctx, now);
        break;
      case "SETTLE":
        this.settle(session, ctx, now);
        break;
      case "WATCH":
        this.watch(session, ctx, now);
        break;
      case "REEL":
        this.reel(session, ctx, now);
        break;
      case "LOOT":
        this.loot(session, ctx, now);
        break;
      default: // INIT 到期后直接进入 PICK（停留时长已由 nextWakeAt 决定）
        setPhase(session, 0, "PICK", now);
    }
  }

  stop(session: Session, _now: number): void {
    const ctx = session.capability?.data["fishing"] as FishCtx | undefined;
    if (!ctx) return;
    ctx.nav.token?.cancel();
    ctx.align.token?.cancel();
    ctx.cast.token?.cancel();
    ctx.reel.token?.cancel();
    gaze.stopHold(session.botId);
    mover.stop(session.botId);
    ctx.lootWindow = false;
    // 会话结束时无条件释放所占点位（避免已结束的会话长期占点）；同时释放扫描标记（校验持有者）
    const pool = this.zone(ctx)?.pool;
    pool?.forceRelease(session.sessionId);
    pool?.releaseScanToken(session.sessionId);
    ctx.spot = null;
    // WATCH/SETTLE 中被停止时在途钩会滞留：hookKey 仍在册且钩实体还在场，就补发一次收竿
    // （fire-and-forget：toggle 内部自查方向，钩已消失时不发起，防误抛新钩）
    if (ctx.hookKey !== null && angler.hasHook(session.botId)) {
      void angler
        .toggle(session.botId)
        .then(() => angler.restoreRod(session.botId))
        .catch(() => undefined);
    } else {
      angler.restoreRod(session.botId);
    }
  }

  // ─── PICK：就近钓区复用 → 区内选点（逐点核验 + 剔除失效点）→ 无区则建区扫描 ──

  private pick(session: Session, ctx: FishCtx, now: number): void {
    // PICK 入口不变量：先按原钓区归还上一轮点位，再做后续判断；归还会卡住旧区的消散，必须趁早
    if (ctx.spot) this.dropSpot(session, ctx);
    const record = this.runtime.record(session.botId);
    const self = mover.snapshotOf(session.botId);
    const selfId = session.entityId;
    if (!record || !self || !selfId) {
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now); // 实体/记录瞬态
      return;
    }
    if (!angler.hasRod(session.botId)) {
      this.say(session, ctx, now, "没有鱼竿，请放入背包", true);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    // 维度取实体当前实际值：record.dimensionId 是下线/死亡/设家点时的快照，
    // 用它找钓区、扫描、复核可能走错维度
    const dimId = self.dimensionId;
    const owner = session.sessionId;
    const zones = this.runtime.fishingZones;
    zones.sweep(now); // 先清掉空区和指向已消散区的记录，再复用，避免命中已消散的区
    // 就近钓区判据是假人当前站位；钓区不随假人移动——被传送走后就地换区或建区，
    // 否则旧区的覆盖范围被无限拉长，两个区永远无法合并
    const found = zones.nearest(dimId, self.location, ZONE_REUSE_MAX_DIST);
    const zone = found ? zones.use(found.id, now) : undefined;
    if (!zone) {
      this.openZone(session, ctx, now, dimId, self.location);
      return;
    }
    if (ctx.zoneId !== zone.id) {
      this.dbg(
        session,
        `复用钓鱼区 #${zone.id}（盒 ${zone.rect.min.x},${zone.rect.min.z}~${zone.rect.max.x},${zone.rect.max.z}）`
      );
      ctx.zoneId = zone.id;
    }
    const pool = zone.pool;
    // 失效占用兜底清理：占用记录的是会话键（`s<botId>#<序号>`），
    // 判据是"该会话此刻是否真的持有本区点位"，比"会话是否在场"更准确
    const freedClaims = pool.sweepClaims((holder) => this.holdsSpotIn(holder, zone.id));
    if (freedClaims > 0) this.dbg(session, `钓鱼区 #${zone.id} 收回失效占用 ${freedClaims} 个点位`);
    // 失效扫描标记兜底清理：持有标记的会话已下线或死亡时清除该标记，
    // 否则它发起的补充扫描永远不会完成，全区无法重扫
    pool.sweepScanToken((holder) => this.sessionAlive(holder));
    // 逐点核验：距离 ≤FISH_PICK_MAX_DIST 且 checkStand 站位仍成立；
    // 判定为"结构不成立"的点在认领后统一移除
    // 距离不合格的点走 prefilter 通道排到队尾，不占用复核预算；
    // 否则预算都花在超距点上，会出现"池非空却无点可用"
    const dead: string[] = [];
    let tooFar = 0;
    let invalid = 0;
    let occupied = 0;
    let unreadable = 0;
    let invalidSample: string | undefined;
    const near = (p: FishSpot): boolean => {
      if (withinStandReach(self.location, p.stand)) return true;
      tooFar++;
      return false;
    };
    const accept = (p: FishSpot): boolean => {
      const check = spotScanner.checkStand(dimId, p.stand, selfId);
      if (check.verdict === "invalid") {
        invalid++;
        dead.push(p.key);
        if (invalidSample === undefined) invalidSample = standAuditLabel(check.audit);
      } else if (check.verdict === "occupied") occupied++;
      else if (check.verdict === "unreadable") unreadable++;
      return check.verdict === "ok";
    };
    const spot = pool.claimWhere(owner, accept, FISH_CLAIM_PROBES, near);
    if (dead.length > 0) {
      const removed = pool.removeKeys(dead);
      this.dbg(session, `钓鱼区 #${zone.id} 结构失效点除名 ${removed} 个`);
    }
    if (spot) {
      ctx.staleRounds = 0;
      ctx.lostStreak = 0; // 新点位：连续"找不到鱼钩"计数从 0 起算
      ctx.spot = spot;
      this.dbg(
        session,
        `选点 (${spot.stand.x}, ${spot.stand.y}, ${spot.stand.z}) 星级=${spot.aim.level} 成功率=${spot.rate}%`
      );
      // 认领到的点就在脚下：省掉 ≥20t 的导航等待与 stopMoving 残留，直接进 ALIGN 核验站位后抛竿
      if (isAtStandSpot(self.location, spot.stand)) {
        this.dbg(session, "已在钓鱼点上，免寻路直接对齐抛竿");
        this.say(session, ctx, now, `已在钓鱼点，直接抛竿（${spot.aim.level} 星·成功率 ${spot.rate}%）`, true);
        setPhase(session, 0, "ALIGN", now);
        return;
      }
      this.say(session, ctx, now, `找到钓鱼点，前往（${spot.aim.level} 星·成功率 ${spot.rate}%）`, true);
      fireAtom(ctx.nav, (token) => mover.navigate(session.botId, standCenter(spot.stand), { speed: 1, token }));
      setPhase(session, 20, "NAV", now);
      return;
    }
    // 一无所获时留痕：按超距/结构不成立/被占用/区块未加载四类分别计数，便于从日志定位原因
    const st = pool.stats();
    this.dbg(
      session,
      `钓鱼区 #${zone.id} 选点未中：空闲${st.free}/占用${st.claimed} ` +
        `超距${tooFar} 结构不成立${invalid} 被占用${occupied} 读不到${unreadable}（复核预算 ${FISH_CLAIM_PROBES}）` +
        (invalidSample ? `｜不成立样例：${invalidSample}` : "")
    );
    // 区里有点却一无所获（点都太远/环境变化）时累计陈旧轮数；区本身为空属正常，不计
    ctx.staleRounds = st.free > 0 ? ctx.staleRounds + 1 : 0;
    const cause =
      unreadable > 0
        ? "站位方块读不到（区块未加载）"
        : occupied > 0
          ? "站位被实体占用"
          : invalid > 0
            ? "站位结构已不成立"
            : tooFar > 0
              ? `点位都在 ${FISH_PICK_MAX_DIST} 格外`
              : "点位正被假人占用（含本会话在持的一点，下轮自动收回）";
    // 一轮下来没有任何半径内的点＝点位陈旧已确定，不等满 3 轮就立刻清退重扫；扫描冷却与全局节流仍会先拦住
    const noneNear = tooFar > 0 && invalid + occupied + unreadable === 0;
    const forceRescan = noneNear || ctx.staleRounds >= FISH_STALE_ROUNDS;
    // 可用点偏少或陈旧达到阈值 → 本区补充扫描；拿不到扫描标记说明区内已有会话在扫，稍后再试
    if (
      (pool.needsRefill() || forceRescan) &&
      now >= ctx.scanCooldownAt &&
      zones.scanDue(dimId, now) &&
      pool.acquireScanToken(owner)
    ) {
      ctx.scanCooldownAt = now + FISH_SCAN_COOLDOWN_TICKS;
      ctx.staleRounds = 0;
      zones.markScanned(dimId, now);
      if (forceRescan) {
        // 移除半径外的陈旧点：池容量满时 needsRefill 永远为假，不清点就再也加不进新点
        const dropped = pool.pruneFree((p) => !withinStandReach(self.location, p.stand));
        if (dropped > 0) this.dbg(session, `陈旧点位清退 ${dropped} 个（> ${FISH_PICK_MAX_DIST} 格）`);
      }
      this.startScan(session, ctx, now, dimId, self.location);
      return;
    }
    this.say(
      session,
      ctx,
      now,
      `附近没有可用的钓鱼点（${st.free > 0 ? `区里还有 ${st.free} 个点但${cause}` : "点位已耗尽"}），稍后再找`,
      true
    );
    setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
  }

  /** 附近无钓区时就地建区（16 格内的邻区由注册表合并为一个），并接管首轮扫描；同维度扫描有全局节流 */
  private openZone(session: Session, ctx: FishCtx, now: number, dimId: string, at: Vec3): void {
    const zones = this.runtime.fishingZones;
    if (!zones.scanDue(dimId, now)) {
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const zone = zones.create(dimId, scanRect(at), now);
    ctx.zoneId = zone.id;
    this.dbg(session, `挂靠钓鱼区 #${zone.id}（就近无区，建区/并入）`);
    if (!zone.pool.acquireScanToken(session.sessionId)) {
      // 区里已有会话在扫描：本会话没起扫描，不吃同维建区节流，短等回 PICK 复用
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    zones.markScanned(dimId, now);
    ctx.scanCooldownAt = now + FISH_SCAN_COOLDOWN_TICKS;
    ctx.staleRounds = 0;
    this.startScan(session, ctx, now, dimId, at);
  }

  /** 启动扫描器：水平 ±FISH_SCAN_RADIUS / 高度 ±FISH_SCAN_Y_RADIUS */
  private startScan(session: Session, ctx: FishCtx, now: number, dimId: string, at: Vec3): void {
    ctx.water = [];
    ctx.scanner = new RegionScanner(dimId, scanRect(at), WATER_BLOCK_IDS);
    setPhase(session, 1, "SCAN", now);
  }

  // ─── SCAN：F-18 逐 tick 取一片水面 → composeSpots 组装后写入钓区点位池 ──

  private scan(session: Session, ctx: FishCtx, now: number): void {
    const record = this.runtime.record(session.botId);
    const self = mover.snapshotOf(session.botId);
    if (!record || !self || !ctx.scanner) {
      // 扫描作废时释放标记，避免卡住其他人的重扫
      this.zone(ctx)?.pool.releaseScanToken(session.sessionId);
      ctx.scanner = null;
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    for (const hit of ctx.scanner.step(FISH_SCAN_BUDGET)) ctx.water.push(hit);
    if (!ctx.scanner.done) {
      setPhase(session, 1, "SCAN", now);
      return;
    }
    // 组装与入池始终使用本区维度：扫描途中被跨维传送，也不会把 A 维水面写进 B 维池
    // 组装阶段按认领半径筛站位，且筛在容量封顶之前：
    // 否则按星级从高到低排序会先把近岸站位挤掉，之后 needsRefill 永不触发
    const zone = this.zone(ctx);
    if (!zone) {
      // 扫描期间所在区被清除：丢弃候选点，回 PICK 重新走就近/建区流程，不新建空区白占名额
      ctx.scanner = null;
      ctx.water = [];
      ctx.zoneId = 0;
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const dimId = zone.dimId;
    const candidates = spotScanner.composeSpots(
      dimId,
      ctx.water,
      self.location,
      FISH_COMPOSE_MAX_STANDS,
      FISH_PICK_MAX_DIST
    );
    // 失败原因分类：无水/有水面但无点位/采集失败分别提示（走找点侧节流档）；成功时静默，交 PICK 认领
    const scanFailure = classifyFishingScan(ctx.water.length, candidates.length, ctx.scanner.ok);
    if (scanFailure) {
      this.say(
        session,
        ctx,
        now,
        scanFailure === "no-water"
          ? "附近没有水面"
          : scanFailure === "no-spot"
            ? `扫描范围内有水面，但 ${FISH_PICK_MAX_DIST} 格内没有可站立的岸边点位（把假人挪到岸边水侧再试）`
            : "水面采集失败（区块未加载？），稍后重试",
        true
      );
      if (scanFailure === "error") ctx.scanCooldownAt = now + FISH_RECHECK_TICKS; // 失败时不压满冷却
    }
    zone.grow(ctx.scanner.rect); // 覆盖范围包含实际扫过的区域（合并/就近判据按实际值计算）
    const added = zone.pool.refill(
      // 新扫出的点入池时成功率为满值；排序=星级→成功率→距区中心，同星级时历史更可信的点排在前面
      candidates.map((c): FishSpot => ({ ...c, key: fishingSpotKey(dimId, c.stand), rate: FISH_RATE_DEFAULT })),
      session.sessionId
    );
    const st = zone.pool.stats();
    this.dbg(
      session,
      `钓鱼区 #${zone.id} 扫描：水面 ${ctx.water.length} → 候选 ${candidates.length} → 入池 ${added}（池 ${st.free}/${st.claimed}）`
    );
    ctx.scanner = null;
    ctx.water = [];
    setPhase(session, 0, "PICK", now);
  }

  // ─── NAV：轮询导航完成 ──

  private nav(session: Session, ctx: FishCtx, now: number): void {
    if (ctx.nav.result === null) {
      setPhase(session, 20, "NAV", now); // 仍在途中（心跳续租在 tick 开头）
      return;
    }
    const r = ctx.nav.result;
    ctx.nav = { inFlight: false, token: null, result: null };
    this.dbg(session, `导航结果=${r}`);
    if (r === "arrived") {
      setPhase(session, 0, "ALIGN", now);
      return;
    }
    // 导航失败与点位无关（路被堵/超时）：释放点位，重新找点
    this.dropSpot(session, ctx);
    setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
  }

  // ─── ALIGN：站位复核 → 微对齐 → 身体朝向水域 + HOLD 注视 ──

  private align(session: Session, ctx: FishCtx, now: number): void {
    const self = mover.snapshotOf(session.botId);
    const spot = ctx.spot;
    const zone = this.zone(ctx);
    if (!self || !spot || !zone) {
      // 区已消散或点位丢失：弃点，重新走就近/建区流程
      this.dropSpot(session, ctx);
      setPhase(session, 0, "PICK", now);
      return;
    }
    // 假人跨维传送后旧点既够不着也无法核验：直接弃点，PICK 按当前维度另找或另建区
    if (zone.dimId !== self.dimensionId) {
      this.dbg(session, `假人已换维（${self.dimensionId}），弃旧维钓鱼区 #${zone.id} 点位`);
      this.dropSpot(session, ctx);
      ctx.zoneId = 0;
      setPhase(session, 0, "PICK", now);
      return;
    }
    const dimId = zone.dimId;
    const selfId = session.entityId;
    if (!selfId) {
      // entityId 瞬态缺失时不能传空串给 checkStand 的排除项（假人会被判"自己占位"→弃点死循环）：短等重入
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const check = spotScanner.checkStand(dimId, spot.stand, selfId);
    if (check.verdict === "occupied") {
      this.say(session, ctx, now, "钓鱼点被占用或失效，换点", true);
      this.dropSpot(session, ctx);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    if (check.verdict === "invalid") {
      this.say(session, ctx, now, `钓鱼点已不成立（${standAuditLabel(check.audit)}），从钓鱼区除名并换点`, true);
      gaze.stopHold(session.botId);
      zone.pool.release(session.sessionId, "spent"); // 点位已不存在，从池中彻底移除
      ctx.spot = null;
      ctx.hookKey = null;
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    if (check.verdict === "unreadable") {
      // 区块读不到属世界瞬态，不是点位的问题：不计失败/不降成功率/不移除点位，只解除占用并排到队尾
      // （一直守在这个点会让 ALIGN 卡住）
      this.say(session, ctx, now, "站位方块读不到（区块未加载），先钓别的点", true);
      gaze.stopHold(session.botId);
      zone.pool.release(session.sessionId, "ok");
      ctx.spot = null;
      ctx.hookKey = null;
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const center = standCenter(spot.stand);
    if (horizontalDistance(self.location, center) > FISH_ALIGN_DIST) {
      if (ctx.align.result === null) {
        if (!ctx.align.inFlight) {
          fireAtom(ctx.align, (token) => mover.navigate(session.botId, center, { speed: 1, token }));
        }
        setPhase(session, 20, "ALIGN", now);
        return;
      }
      const r = ctx.align.result;
      ctx.align = { inFlight: false, token: null, result: null };
      if (r !== "arrived" && horizontalDistance(self.location, center) > FISH_ALIGN_FAIL_DIST) {
        this.dropSpot(session, ctx); // 微调失败且仍然很远——弃点重选
        setPhase(session, 0, "PICK", now);
        return;
      }
      // 微调失败但已经够近：可以接受，继续抛竿
    }
    // 不站在水里抛竿：导航到达判定宽容 |dy|≤4，被水流冲的假人可能停在点位正下方的水柱里；按点位失败进入裁决
    if (mover.inWater(session.botId)) {
      this.say(session, ctx, now, "假人脚下是水，不在水里抛竿", true);
      this.adjudicate(session, ctx, now, "够不着");
      return;
    }
    // F-06 注视租约化：抛前身体 yaw + HOLD 注视水面格中心，朝向决定落点
    const water = blockCenter(dimId, spot.aim.target);
    if (water) {
      const pitch = this.ops.readPose(session.botId)?.pitch ?? 0;
      gaze.setBodyPose(session.botId, computeTargetYaw(self.location, water), pitch);
      gaze.startHold(session.botId, water);
    }
    setPhase(session, 2, "CAST", now); // 注视生效一拍后再抛（朝向决定落点）
  }

  // ─── CAST：抛竿（already-cast 自愈 / 结果分流） ──

  private cast(session: Session, ctx: FishCtx, now: number): void {
    if (ctx.cast.inFlight) {
      if (ctx.cast.result === null) {
        setPhase(session, 20, "CAST", now);
        return;
      }
      const r = ctx.cast.result;
      ctx.cast = { inFlight: false, token: null, result: null };
      this.dispatchCast(session, ctx, r, now);
      return;
    }
    if (angler.hasHook(session.botId)) {
      // 归属核对：只有本点抛出的钩才走 already-cast 复用；换点后旧点残钩先收回再抛
      if (ctx.spot && ctx.hookKey === ctx.spot.key) {
        // 走到这里说明钩抛出于上一轮且已在水中稳定：再等满 STABILIZE 会把等待期间的
        // 咬钩当成基线（真上钩被误报超时），留一拍复核落点即可
        setPhase(session, BITE_CHECK_TICKS, "SETTLE", now);
        return;
      }
      this.dbg(session, "残钩归属他点（或无主），先收回再在本点抛竿");
    }
    // 即将发起的一次 toggle：可能是向本点抛竿，也可能是收回遗留的钩；两种结果之后鱼钩都归属本点
    ctx.hookKey = ctx.spot?.key ?? null;
    fireAtom(ctx.cast, (token) => angler.toggle(session.botId, token));
    setPhase(session, 20, "CAST", now);
  }

  private dispatchCast(session: Session, ctx: FishCtx, r: CastResult, now: number): void {
    this.dbg(session, `抛竿结果=${r}`);
    switch (r) {
      case "cast":
        setPhase(session, STABILIZE_TICKS, "SETTLE", now);
        break;
      case "reeled": // 与 hasHook 预检之间的竞态（钩刚消失又被收回）：重新发起一次
        setPhase(session, 2, "CAST", now);
        break;
      case "no-rod":
        this.say(session, ctx, now, `${fishFailureLabel("no-rod")}，请放入背包`, true);
        this.dropSpot(session, ctx);
        setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
        break;
      case "offline": // 与点位无关：释放点位重新找点（会话即将被生命周期管线接管，先自行恢复）
        this.dropSpot(session, ctx);
        setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
        break;
      case "verify-failed":
        // 服务器掉 tick 时钩的出现可晚于 2t×3 回读窗：先复核再登记：看到钩就按抛竿成功走稳定期
        if (angler.hasHook(session.botId)) {
          this.dbg(session, "抛竿复核晚见钩（tick 波动）：转稳定期，不计点位失败");
          setPhase(session, STABILIZE_TICKS, "SETTLE", now);
          return;
        }
        this.spotFail(session, ctx, "error", now);
        break;
      default:
        // no-slot/engine-refused → 该点本次抛竿失败
        this.spotFail(session, ctx, "error", now);
    }
  }

  // ─── SETTLE：稳定期之后核验落点 ──

  private settle(session: Session, ctx: FishCtx, now: number): void {
    const placement = angler.probePlacement(session.botId);
    this.dbg(session, `落点=${placement ?? "missing"}`);
    if (placement === undefined) {
      // 刚收竿后的钩残留或丢失不等于点位失败：原地继续抛
      this.lostHook(session, ctx, now);
      return;
    }
    if (placement === "water") {
      // 开启渔获窗口：此刻清空暂存，此前抛竿/换竿造成的槽位变化不计入渔获
      ctx.lostStreak = 0; // 鱼钩确认还在：连续"找不到鱼钩"计数归零
      ctx.pendingLoot = {};
      ctx.lootBefore = null;
      ctx.lootWindow = true;
      ctx.bite = initBiteState();
      ctx.watchDeadline = now + BITE_TIMEOUT_TICKS;
      setPhase(session, BITE_CHECK_TICKS, "WATCH", now);
      return;
    }
    // landed/snagged 必须先收竿再判失败，否则遗留的鱼钩会让 hasHook 长期误报
    ctx.earlyReason = placement;
    fireAtom(ctx.reel, (token) => angler.toggle(session.botId, token));
    ctx.reel.kind = "early";
    setPhase(session, 20, "REEL", now);
  }

  // ─── WATCH：咬钩监视 ──
  // 咬钩判据在 STABILIZE_TICKS 稳定期之后才可信（浮漂入水先沉后浮会造成误判），
  // 浮漂滚动最高点的净下降即视为咬钩，采样间隔 BITE_CHECK_TICKS
  // 超时 BITE_TIMEOUT_TICKS 无鱼属于正常收竿，不计入点位失败

  private watch(session: Session, ctx: FishCtx, now: number): void {
    const hook = angler.findHook(session.botId);
    if (!hook) {
      // 找不到鱼钩＝下一步该抛而不是收：同点继续抛，不判点位失败
      this.lostHook(session, ctx, now);
      return;
    }
    if (updateBiteTracker(ctx.bite, hook.y)) {
      this.say(session, ctx, now, "鱼上钩了，正在收竿！", false);
      this.startReel(session, ctx, "bite", now);
      return;
    }
    if (now >= ctx.watchDeadline) {
      this.say(session, ctx, now, `等待 ${BITE_TIMEOUT_TICKS / 20} 秒无鱼上钩，收竿结束`, false);
      this.startReel(session, ctx, "timeout", now);
      return;
    }
    setPhase(session, BITE_CHECK_TICKS, "WATCH", now);
  }

  private startReel(session: Session, ctx: FishCtx, kind: ReelKind, now: number): void {
    // 收竿前先取一次背包快照作为差集基准（收竿后立即读取会漏掉渔获）
    ctx.lootBefore = this.ops.lootSnapshot(session.botId);
    fireAtom(ctx.reel, (token) => angler.toggle(session.botId, token));
    ctx.reel.kind = kind;
    setPhase(session, 20, "REEL", now);
  }

  // ─── REEL：轮询收竿完成 → LOOT / 按失败处理 ──

  private reel(session: Session, ctx: FishCtx, now: number): void {
    if (ctx.reel.result === null) {
      setPhase(session, 20, "REEL", now);
      return;
    }
    const r = ctx.reel.result;
    const kind = ctx.reel.kind;
    this.dbg(session, `收竿结果=${r}（意图=${kind}）`);
    ctx.reel = { inFlight: false, token: null, result: null, kind };
    switch (r) {
      case "reeled":
        ctx.hookKey = null; // 钩已收回：归属信息一并清除
        if (kind === "early") {
          const reason = ctx.earlyReason ?? "error";
          ctx.earlyReason = null;
          this.spotFail(session, ctx, reason, now); // 钩已收清，现在按点位失败正常处理
        } else {
          setPhase(session, LOOT_SETTLE_TICKS, "LOOT", now); // 等 3t 让掉落物落定（立即读会漏）
        }
        break;
      case "cast":
        // 收竿瞬间钩已丢失，toggle 改为抛竿：新钩属于本点位，回到稳定期继续
        ctx.earlyReason = null;
        ctx.hookKey = ctx.spot?.key ?? null;
        setPhase(session, STABILIZE_TICKS, "SETTLE", now);
        break;
      case "verify-failed":
        ctx.earlyReason = null;
        if (kind === "early") {
          this.spotFail(session, ctx, "error", now);
        } else {
          // 鱼钩状态未知：交给下一轮 CAST 的 hasHook 预检分流（不重复计失败）
          setPhase(session, 2, "ALIGN", now);
        }
        break;
      case "no-rod":
      case "offline":
        this.say(session, ctx, now, fishFailureLabel(r === "no-rod" ? "no-rod" : "offline"), false);
        ctx.lootWindow = false;
        this.dropSpot(session, ctx);
        setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
        break;
      default:
        ctx.earlyReason = null;
        this.spotFail(session, ctx, "error", now);
    }
  }

  // ─── LOOT：渔获统计 + 播报 + 同点继续钓 ──

  private loot(session: Session, ctx: FishCtx, now: number): void {
    ctx.lootWindow = false;
    // 散落渔获与经验球由 tick 开头的吸取心跳按节拍收（FISH_SUCK_PULSE_TICKS），此处不再单独吸
    if (ctx.reel.kind === "timeout") {
      ctx.pendingLoot = {};
      setPhase(session, FISH_INIT_TICKS, "ALIGN", now); // 没钓到鱼属正常：同点继续钓，不清失败计数
      return;
    }
    const loot =
      Object.keys(ctx.pendingLoot).length > 0
        ? ctx.pendingLoot
        : diffLootCounts(ctx.lootBefore ?? {}, this.ops.lootSnapshot(session.botId)); // 漏计时改用快照差集
    ctx.pendingLoot = {};
    ctx.lootBefore = null;
    const bp = this.ops.backpackUsage(session.botId);
    let bpLabel = `背包 ${bp.used}/${bp.total}`;
    if (bp.total > 0 && bp.used >= bp.total) bpLabel += "；⚠️ 背包已满，建议清理";
    else if (bp.total > 0 && bp.used >= bp.total - FISH_BACKPACK_NEAR_FULL_GAP) bpLabel += "；⚠️ 背包快满";
    this.say(session, ctx, now, `钓到 ${lootReport(loot)}；${bpLabel}`, false);
    const pool = this.zone(ctx)?.pool;
    pool?.resetFail(session.sessionId); // 钓到鱼即清零该点此前的连续失败记录
    if (ctx.spot) {
      // 钓到鱼说明站位确实可用：成功率回升一档，下次放回池时按新数值排序
      ctx.spot.rate = recoverRate(ctx.spot.rate);
      this.dbg(session, `钓获加成：钓鱼点成功率 ${ctx.spot.rate}%（${ctx.spot.aim.level} 星）`);
    }
    setPhase(session, 5, "ALIGN", now); // 同点继续钓：重新对齐水域再抛
  }

  // ─── 失败处理：每次失败都换点，同点连败满 FISH_SPOT_STRIKES 时实地复核后定论 ──

  private spotFail(session: Session, ctx: FishCtx, reason: FishFailReason, now: number): void {
    ctx.lootWindow = false;
    ctx.pendingLoot = {};
    // 换点时不拖住旧注视（与 dropSpot 同一规则）：新点 ALIGN 末尾会重新 startHold，无副作用
    gaze.stopHold(session.botId);
    this.say(session, ctx, now, fishFailureLabel(reason), false);
    this.adjudicate(session, ctx, now, "抛竿失败");
  }

  /**
   * 点位失败处理：记一次失败并解除占用（失败即换点，不在原地重试）；同一地点连续失败满
   * FISH_SPOT_STRIKES 时把该点摘出来复核一次：结构不成立→从池中移除；星级或瞄准点变化→修复并
   * 复位成功率；评分未变→成功率降一档；世界读不到→原样放回池。成功率只用于排优先级，
   * 不作为剔除依据；是否移除只看结构判据。
   * @param cause - 失败原因文案（播报用）
   */
  private adjudicate(session: Session, ctx: FishCtx, now: number, cause: string): void {
    const zone = this.zone(ctx);
    const spot = ctx.spot;
    if (!zone || !spot) {
      this.dropSpot(session, ctx);
      setPhase(session, 0, "PICK", now);
      return;
    }
    const pool = zone.pool;
    const strike = pool.strikeRelease(session.sessionId);
    ctx.spot = null;
    ctx.hookKey = null;
    if (strike.state === "none") {
      // 本会话此刻没有占用点位（重复处理或瞬态）：不该惩罚任何点位，直接换点
      this.dbg(session, `钓鱼区 #${zone.id} ${cause}：本会话无占用点位，仅换点`);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    if (strike.state === "retry") {
      this.say(session, ctx, now, `${cause}，换点重试（该点连败 ${strike.fails}/${FISH_SPOT_STRIKES}）`, true);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    // due：连续失败达阈值，先读一次世界再定论（摘出时失败计数已清零，必须 settle 放回池）
    if (!session.entityId) {
      // entityId 瞬态缺失：复核会把假人自己判成占位，按世界瞬态同口径原样回池，下轮再裁
      pool.settle(spot, "keep");
      this.dbg(session, `钓鱼区 #${zone.id} ${cause}：实体 id 瞬态缺失，点位保留回池`);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const check = spotScanner.checkStand(zone.dimId, spot.stand, session.entityId);
    if (check.verdict === "invalid") {
      pool.settle(spot, "drop");
      this.say(
        session,
        ctx,
        now,
        `钓鱼点结构已不成立（${standAuditLabel(check.audit)}），从钓鱼区 #${zone.id} 除名`,
        false
      );
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    if (check.verdict === "unreadable") {
      pool.settle(spot, "keep");
      this.say(session, ctx, now, "站位方块读不到（区块未加载），点位保留，先钓别的点", false);
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    const aim = repairSpotAim(spot.stand, waterProbeAt(zone.dimId));
    if (!aim) {
      // 站位还能站，但周围已经没有水面可瞄准：与结构不成立同样处理
      pool.settle(spot, "drop");
      this.say(
        session,
        ctx,
        now,
        `钓鱼点周围已无水（${standAuditLabel(check.audit)}），从钓鱼区 #${zone.id} 除名`,
        false
      );
      setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
      return;
    }
    if (aim.level !== spot.aim.level || aim.target.x !== spot.aim.target.x || aim.target.z !== spot.aim.target.z) {
      spot.aim = aim;
      spot.rate = FISH_RATE_DEFAULT; // 修复后视为新点位重新计数，成功率回到满值
      pool.settle(spot, "keep");
      this.say(session, ctx, now, `钓鱼点环境已变化，修复为 ${aim.level} 星（成功率复位 ${spot.rate}%）`, false);
    } else {
      spot.rate = decayRate(spot.rate);
      pool.settle(spot, "keep");
      this.say(
        session,
        ctx,
        now,
        `钓鱼点连败 ${FISH_SPOT_STRIKES} 次（${cause}）而结构仍在，成功率降至 ${spot.rate}%，换点`,
        false
      );
    }
    setPhase(session, FISH_RECHECK_TICKS, "PICK", now);
  }

  /**
   * 找不到鱼钩：刚收竿之后钩本就该消失（实体销毁延迟一拍），不属于点位失败——
   * 不移除点位/不换点/不寻路，直接回 CAST 再抛一次（toggle 会读实际状态决定抛还是收）。
   * 同一地点连续丢失达 FISH_SPOT_STRIKES 才按点位失败处理。
   */
  private lostHook(session: Session, ctx: FishCtx, now: number): void {
    ctx.lootWindow = false;
    ctx.pendingLoot = {};
    ctx.earlyReason = null;
    ctx.hookKey = null; // 找不到鱼钩：归属信息作废
    if (++ctx.lostStreak < FISH_SPOT_STRIKES) {
      this.dbg(session, `查无鱼钩，同点续抛（连续 ${ctx.lostStreak}/${FISH_SPOT_STRIKES} 次，不算点位失败）`);
      setPhase(session, 1, "CAST", now);
      return;
    }
    ctx.lostStreak = 0;
    this.spotFail(session, ctx, "hook-lost", now);
  }

  // ─── 私有小件 ──

  /** 本会话所在钓区（区被合并时自动解析到存活的区；区已消散返回 undefined） */
  private zone(ctx: FishCtx): FishZone | undefined {
    return this.runtime.fishingZones.get(ctx.zoneId);
  }

  /**
   * 归属键是否仍是当前会话：`s<botId>#<序号>` 每次上线生成一个且永不复用，
   * 上一次上线留下的键自动视为无效
   */
  private sessionAlive(owner: string): boolean {
    const botId = ownerBotId(owner);
    return botId !== undefined && this.runtime.session(botId)?.sessionId === owner;
  }

  /** 归属键此刻是否真的持有本区点位：必须是当前会话，且其所在区解析到同一个存活区 */
  private holdsSpotIn(owner: string, zoneId: number): boolean {
    const botId = ownerBotId(owner);
    if (botId === undefined) return false;
    const session = this.runtime.session(botId);
    if (!session || session.sessionId !== owner) return false;
    const st = this.runtime.stateOf(botId);
    if (st !== "ACTIVE" && st !== "WORKING") return false;
    const ctx = session.capability?.data["fishing"] as FishCtx | undefined;
    if (!ctx || ctx.spot === null) return false;
    return this.runtime.fishingZones.get(ctx.zoneId)?.id === zoneId;
  }

  /** 弃点并放回池（该钓点仍可服务他人或自己下一轮） */
  private dropSpot(session: Session, ctx: FishCtx): void {
    // 取消注视（F-06）：HOLD 仍钉住旧点位水面时寻路，Continuous 注视与 navigateToLocation 会互相争抢朝向，
    // 表现为假人朝鱼钩方向走
    gaze.stopHold(session.botId);
    this.zone(ctx)?.pool.release(session.sessionId, "ok");
    ctx.spot = null;
    ctx.hookKey = null; // 弃点同时解除与在途鱼钩的归属关系（遗留的钩由下轮 CAST 核对后收回）
  }

  /**
   * 播报分两档：throttled=true 用于找点（半径 SPOT_NOTIFY_RADIUS，按
   * FISH_NOTIFY_COOLDOWN_TICKS 节流）；false 用于咬钩/渔获/失败原因（半径
   * NOTIFY_RADIUS，即时）。dbg 日志不受节流，始终全量输出。
   */
  private say(session: Session, ctx: FishCtx, now: number, detail: string, throttled: boolean): void {
    this.dbg(session, detail);
    if (throttled && now < ctx.notifyAt) return;
    if (throttled) ctx.notifyAt = now + FISH_NOTIFY_COOLDOWN_TICKS;
    const record = this.runtime.record(session.botId);
    // 播报按当前维度查找附近玩家；record.dimensionId 可能是旧维度快照，跨维传送会报出错误的维度
    const self = mover.snapshotOf(session.botId);
    if (!record || !self) return;
    this.ops.notifyNearby(
      self.dimensionId,
      self.location,
      throttled ? SPOT_NOTIFY_RADIUS : NOTIFY_RADIUS,
      `[模拟玩家][钓鱼] ${record.name} ${detail}`
    );
  }

  /** 步进日志 */
  private dbg(session: Session, detail: string): void {
    console.warn(`[mockplayer3] 钓鱼 ${this.runtime.record(session.botId)?.name ?? session.botId} ${detail}`);
  }

  /** 记录渔获事件（在构造函数期订阅）：主手槽位是抛收竿操作，置空也不属于渔获 */
  private collectLoot(
    botId: number,
    slot: number,
    item?: { typeId: string; amount: number; enchantments: { id: string; level: number }[] }
  ): void {
    if (slot === MAINHAND_SLOT || !item) return;
    const cap = this.runtime.session(botId)?.capability;
    if (!cap || cap.mode !== "fishing") return;
    const ctx = cap.data["fishing"] as FishCtx | undefined;
    if (!ctx || !ctx.lootWindow) return;
    const fp = lootFingerprint(item.typeId, item.enchantments);
    ctx.pendingLoot[fp] = (ctx.pendingLoot[fp] ?? 0) + item.amount;
  }
}

// ─── 模块内小件 ──

/** 扫描范围（水平 ±FISH_SCAN_RADIUS / 高度 ±FISH_SCAN_Y_RADIUS）：
 * 建区时的覆盖范围与实际扫描范围一致，合并与就近判定按实际值计算 */
function scanRect(at: Vec3): RegionRect {
  return {
    min: { x: at.x - FISH_SCAN_RADIUS, y: at.y - FISH_SCAN_Y_RADIUS, z: at.z - FISH_SCAN_RADIUS },
    max: { x: at.x + FISH_SCAN_RADIUS, y: at.y + FISH_SCAN_Y_RADIUS, z: at.z + FISH_SCAN_RADIUS },
  };
}

function FishCtxSeed(): FishCtx {
  return {
    spot: null,
    zoneId: 0,
    staleRounds: 0,
    scanCooldownAt: 0,
    scanner: null,
    water: [],
    nav: { inFlight: false, token: null, result: null },
    align: { inFlight: false, token: null, result: null },
    cast: { inFlight: false, token: null, result: null },
    reel: { inFlight: false, token: null, result: null, kind: "bite" },
    earlyReason: null,
    lostStreak: 0,
    hookKey: null,
    bite: initBiteState(),
    watchDeadline: 0,
    lootWindow: false,
    pendingLoot: {},
    lootBefore: null,
    notifyAt: 0,
    suckAt: 0,
  };
}

/** 发起异步原子（F-18）：立即挂上 token，Promise 结果只写回槽位；异常转成 "error"，不向上抛出 */
function fireAtom<R>(atom: AtomSlot<R>, issue: (token: CancelToken) => Promise<R>): void {
  const token = new CancelToken();
  atom.token = token;
  atom.inFlight = true;
  atom.result = null;
  issue(token)
    .then((r) => {
      atom.result = r;
    })
    .catch(() => {
      atom.result = "error" as R;
    });
}

/** 渔获统计（按指纹计数）→ 中文播报（typeId×N（附魔）；指纹中 # 之后是附魔段） */
function lootReport(loot: Record<string, number>): string {
  const entries = Object.entries(loot);
  if (entries.length === 0) return "（无战利品）";
  return entries
    .map(([fp, count]) => {
      const hash = fp.indexOf("#");
      const label =
        hash < 0
          ? fp
          : `${fp.slice(0, hash)}（${fp
              .slice(hash + 1)
              .split(",")
              .join("、")}）`;
      return `${label}×${count}`;
    })
    .join("、");
}

function setPhase(session: Session, wakeDelay: number, name: FishPhase, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
}
