// ─── 定点放置能力 ──────────────────────────────────────────────────
// 定点作业：常驻节拍把主手方块放到正前方，靶面完全由玩家预设准星决定（与攻击同口径）。
// 视角绝不变化，每拍不发注视。
// 能力常驻永不落空闲：启用后无限循环放置，主手空手/非方块、准星无目标、实体瞬态
// 一律低频重探、补货即恢复；只有显式切模式/下线/死亡才卸载（与挖掘同口径）。
// 放置双拍发起—收口：一拍 beginPlace 进建造态，次拍 endPlace 停建造态并回读
// （引擎需至少一拍建造态才落块，见 Placer 头注）；回读只决定节拍快慢，
// 扣料与不覆盖既有方块的保证在放置原子内实现。
// 停滞诊断：连续多拍零落块时按节流补一行控制台日志（含主手/支撑面真值 id），
// 使"启用后无动作"在现场可定位到具体分支。
// 能力是全局单例、零实例字段；相位与在途支撑面挂 session.capability.data["place"]。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import type { Vec3 } from "../../domain/Coords";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { IDLE_RECHECK_TICKS, PLACE_INTERVAL_TICKS } from "../../domain/MineRules";
import { placer } from "../../engine/Placer";
import { ctxOf } from "./Common";

/** 启动后首拍醒距（tick）：生成窗引擎逐 tick 锁回旋转，先缓冲再按视角放置（F-01） */
const PLACE_SETTLE_TICKS = 8;

/** 停滞成行阈值（落块次数）：连续此次数未落一块才考虑报日志 */
const STALL_LANDS = 20;

/** 停滞日志节流（tick）：同假人两次日志的最小间隔 */
const STALL_LOG_TICKS = 200;

/** 放置相位：LAY=发起拍，STOP=收口拍（次拍必醒） */
type PlacePhase = "LAY" | "STOP";

/** 放置私有上下文 */
interface PlaceCtx {
  /** 常规通道在途支撑格（null=无在途收口） */
  building: Vec3 | null;
  /** 连续未落块次数（落一块即清零） */
  stall: number;
  /** 最近一次未落块原因标记（诊断日志用） */
  reason: string;
  /** 上次停滞日志时刻（tick，节流用） */
  lastLogAt: number;
}

/** 定点放置相位机（LAY 发起 → STOP 收口 两相位节拍循环） */
export class PlaceCap implements Capability {
  readonly id = "place" as const;

  requires(): LeaseRequest[] {
    // 不发任何注视（视角由玩家预设且恒定），只占双手
    return [{ kind: "hands" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    // 一律受理启动：空手/非方块/瞬态都不拒绝——落空闲会把用户持久设置清掉，
    // 交 tick 低频重探，补货即自然恢复
    ctxOf<PlaceCtx>(cap.data, "place", seedCtx);
    cap.phase = { name: "LAY", nextWakeAt: now + PLACE_SETTLE_TICKS };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap || (cap.phase.name !== "LAY" && cap.phase.name !== "STOP")) return;
    const ctx = ctxOf<PlaceCtx>(cap.data, "place", seedCtx);
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    const botId = session.botId;
    if (cap.phase.name === "STOP") {
      const result = placer.endPlace(botId, ctx.building);
      ctx.building = null;
      track(ctx, result === "placed", `endPlace=${result}`, botId, now);
      setPhase(session, result === "offline" ? IDLE_RECHECK_TICKS : PLACE_INTERVAL_TICKS, "LAY", now);
      return;
    }
    // LAY 发起拍：视角零改动；非方块主手不发起（无可写目标，直写会把非方块 typeId 当方块）
    const kind = placer.mainhandKind(botId);
    if (kind !== "block") {
      track(ctx, false, `mainhand=${kind}`, botId, now);
      setPhase(session, IDLE_RECHECK_TICKS, "LAY", now);
      return;
    }
    const begun = placer.beginPlace(botId);
    switch (begun.state) {
      case "started":
        // 进建造态，次拍醒收口
        ctx.building = begun.support;
        setPhase(session, 1, "STOP", now);
        break;
      case "special-placed":
        track(ctx, true, "-", botId, now);
        setPhase(session, PLACE_INTERVAL_TICKS, "LAY", now);
        break;
      case "unchanged":
        // 支撑面相邻格被占（特殊通道）或发起未落地——照连放节拍重试
        track(ctx, false, begun.state, botId, now);
        setPhase(session, PLACE_INTERVAL_TICKS, "LAY", now);
        break;
      default:
        // no-target/not-block/offline → 低频重探
        track(ctx, false, begun.state, botId, now);
        setPhase(session, IDLE_RECHECK_TICKS, "LAY", now);
    }
  }

  stop(session: Session, _now: number): void {
    // 幂等清场：在途建造态必收口（stopBuild 甩掉"持续放置"意图，防卸载后仍连放）
    const ctx = session.capability?.data["place"] as PlaceCtx | undefined;
    placer.endPlace(session.botId, ctx?.building ?? null);
    if (ctx) ctx.building = null;
  }
}

// ─── 模块内小件 ──

function seedCtx(): PlaceCtx {
  return { building: null, stall: 0, reason: "-", lastLogAt: 0 };
}

function setPhase(session: Session, wakeDelay: number, name: PlacePhase, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
}

/** 记一次落块判定：落块清零停滞计数；未落累计过阈值按节流补控制台诊断日志 */
function track(ctx: PlaceCtx, landed: boolean, reason: string, botId: number, now: number): void {
  if (landed) {
    ctx.stall = 0;
    ctx.reason = "-";
    return;
  }
  ctx.reason = reason;
  ctx.stall += 1;
  if (ctx.stall >= STALL_LANDS && now - ctx.lastLogAt >= STALL_LOG_TICKS) {
    ctx.lastLogAt = now;
    const probe = placer.diagnose(botId);
    console.warn(
      `[mockplayer3] place stalled bot=${botId} reason=${reason} streak=${ctx.stall} held=${probe.held} support=${probe.support}@${probe.dist.toFixed(1)}`
    );
  }
}
