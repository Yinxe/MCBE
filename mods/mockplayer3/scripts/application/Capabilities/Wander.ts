// ─── 随机游走能力 ──────────────────────────────────────────────────
// 走停节律循环：间隔待机偶发扭头→选线行走→短停；导航失败短等待即重选，不进长休息。
// 节奏/自然化参数收敛于 DEFAULT_WANDER_CONFIG，单位=引擎周期。
// 能力是全局单例、零实例字段，状态挂 data["wander"]。
// tick 回调同步短小，路线协程只把纯结果写回槽位，等待唯一经 nextWakeAt（F-18）。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import type { NavOutcome } from "../../domain/NavRules";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { CancelToken } from "../../domain/Cancellation";
import { DEFAULT_WANDER_CONFIG, pickLookTargetYaw, randomBetween } from "../../domain/Stroll";
import { strollOps } from "../../engine/StrollOps";
import { mover } from "../../engine/Mover";
import type { EntityOps } from "../../engine/EntityOps";
import type { Runtime } from "../Runtime";
import { ctxOf } from "./Common";

type WanderPhase = "IDLE" | "PICK" | "WALK" | "REST";

/** 引擎周期（tick）——配置节奏单位即此 */
const WANDER_CYCLE_TICKS = 10;

interface WanderCtx {
  /** 当前阶段剩余等待（tick） */
  wait: number;
  /** 转头节流周期计数（对 lookAroundInterval 取模） */
  lookTick: number;
  /** 路线协程在途状态（F-18：token 取消 + 纯结果回写） */
  walk: { inFlight: boolean; token: CancelToken | null; result: NavOutcome | null };
}

/** 随机游走行为（record.workMode=wander） */
export class WanderCap implements Capability {
  readonly id = "wander" as const;

  constructor(
    private readonly runtime: Runtime,
    private readonly ops: EntityOps
  ) {}

  requires(): LeaseRequest[] {
    return [{ kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf(cap.data, "wander", () => ({
      wait: randomBetween(DEFAULT_WANDER_CONFIG.intervalMin, DEFAULT_WANDER_CONFIG.intervalMax) * WANDER_CYCLE_TICKS,
      lookTick: 0,
      walk: { inFlight: false, token: null, result: null },
    }));
    cap.phase = { name: "IDLE", nextWakeAt: now + WANDER_CYCLE_TICKS };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    const ctx = cap?.data["wander"] as WanderCtx | undefined;
    if (!cap || !ctx) return;
    if (this.runtime.record(session.botId) === undefined) return; // 记录已移除：停摆（管线收会话）
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    switch (cap.phase.name as WanderPhase) {
      case "IDLE":
        this.idle(ctx, session, now);
        break;
      case "PICK":
        this.pick(session, ctx, now);
        break;
      case "WALK":
        this.walk(session, ctx, now);
        break;
      case "REST":
        this.rest(ctx, session, now);
        break;
    }
  }

  stop(session: Session, _now: number): void {
    const ctx = session.capability?.data["wander"] as WanderCtx | undefined;
    if (!ctx) return;
    ctx.walk.token?.cancel();
    strollOps.cancelTurn(session.botId);
    mover.stop(session.botId);
  }

  // ─── IDLE：间隔等待（走停节律），静止时偶尔扭头 ──

  private idle(ctx: WanderCtx, session: Session, now: number): void {
    if (++ctx.lookTick % DEFAULT_WANDER_CONFIG.lookAroundInterval === 0) this.lookAround(session);
    ctx.wait -= WANDER_CYCLE_TICKS;
    if (ctx.wait <= 0) setPhase(session, 0, "PICK", now);
    else setPhase(session, WANDER_CYCLE_TICKS, "IDLE", now);
  }

  // ─── PICK：生成路线 + 发起单次路线协程（0 点即保持不动） ──

  private pick(session: Session, ctx: WanderCtx, now: number): void {
    const cfg = DEFAULT_WANDER_CONFIG;
    // IDLE/REST 末拍发起的扭头链（180°/20°×3t，最长约 54t）会跨入 PICK/WALK 相位：
    // 先中止它，行走期间不再叠加 teleport 扭头
    strollOps.cancelTurn(session.botId);
    const token = new CancelToken();
    ctx.walk = { inFlight: true, token, result: null };
    strollOps
      .runRoute(
        session.botId,
        {
          radius: cfg.radius,
          minDist: cfg.minDist,
          pointMin: cfg.routePointsMin,
          pointMax: cfg.routePointsMax,
          speed: cfg.speed,
        },
        token
      )
      .then((r) => {
        ctx.walk.result = r;
      })
      .catch(() => {
        ctx.walk.result = "error";
      });
    setPhase(session, WANDER_CYCLE_TICKS, "WALK", now);
  }

  // ─── WALK：轮询路线完成 ──

  private walk(session: Session, ctx: WanderCtx, now: number): void {
    const cfg = DEFAULT_WANDER_CONFIG;
    if (ctx.walk.result === null) {
      setPhase(session, WANDER_CYCLE_TICKS, "WALK", now); // 在途（心跳续租在 tick 头）
      return;
    }
    const r = ctx.walk.result;
    ctx.walk = { inFlight: false, token: null, result: null };
    if (r === "arrived") {
      // 到达（含 0 点保持不动）：短暂休息（走停节律）
      ctx.wait = randomBetween(cfg.restMin, cfg.restMax) * WANDER_CYCLE_TICKS;
      setPhase(session, WANDER_CYCLE_TICKS, "REST", now);
    } else {
      // 导航失败：快速重试——短等待回 IDLE 重选，不进长休息
      ctx.wait = cfg.failRetry * WANDER_CYCLE_TICKS;
      setPhase(session, WANDER_CYCLE_TICKS, "IDLE", now);
    }
  }

  // ─── REST：短暂停顿，偶尔扭头 ──

  private rest(ctx: WanderCtx, session: Session, now: number): void {
    const cfg = DEFAULT_WANDER_CONFIG;
    if (++ctx.lookTick % cfg.lookAroundInterval === 0) this.lookAround(session);
    ctx.wait -= WANDER_CYCLE_TICKS;
    if (ctx.wait <= 0) {
      ctx.wait = randomBetween(cfg.intervalMin, cfg.intervalMax) * WANDER_CYCLE_TICKS;
      setPhase(session, WANDER_CYCLE_TICKS, "IDLE", now);
    } else {
      setPhase(session, WANDER_CYCLE_TICKS, "REST", now);
    }
  }

  // ─── 扭头（分步平滑；读不到朝向按 0） ──

  private lookAround(session: Session): void {
    const cfg = DEFAULT_WANDER_CONFIG;
    const yaw = this.ops.readPose(session.botId)?.yaw ?? 0;
    const target = pickLookTargetYaw(yaw, cfg.lookSmallChance, cfg.lookSmallSpread);
    strollOps.turnSmoothly(session.botId, target, cfg.lookTurnStepDeg, cfg.lookTurnStepTicks);
  }
}

function setPhase(session: Session, wakeDelay: number, name: WanderPhase, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
}
