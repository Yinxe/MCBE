// ─── 机械挖掘能力 ──────────────────────────────────────────────────
// 定点掘进：假人永不移位，世界动作全部交给挖掘原子（常驻射线、6 格内第一命中块、块间零空挡）。
// 本层只做协程发起/自愈、心跳续租、逐格挖掘租约、逐格按方块选主手工具。
// 永不停机：射线协程无超时不自退，无候选或目标瞬态失效时停挥，隔几个 tick 再探；
// 每格开挥前按命中方块类型选优换工具，耐久告急另由 ToolGuard 事件守护同型兜底。
// 能力是全局单例、零实例字段，状态挂 session.capability.data["mine"]。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import type { Vec3 } from "../../domain/Coords";
import { blockKey, ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { CancelToken } from "../../domain/Cancellation";
import { IDLE_RECHECK_TICKS, MINE_SWING_TICKS, isMineCandidate, toolStrategyForBlock } from "../../domain/MineRules";
import { clock } from "../../engine/Clock";
import { breaker } from "../../engine/Breaker";
import { makeEnsureToolForBlock } from "../../engine/ToolKit";
import { ctxOf } from "./Common";

/** 射线最远端=挖掘距离 */
const REACH = 6;
/** 心跳醒距（租约续租 + 协程自愈重启；掘进节拍在常驻协程内，不等这个拍） */
const HEARTBEAT_POLL_TICKS = 20;

/** 按命中方块选主手工具（bore 每格开挥前调用；单例零字段，模块级常量） */
const ensureTool = makeEnsureToolForBlock(toolStrategyForBlock);

type MinePhase = "CHECK" | "DIG";

interface MineCtx {
  /** 常驻掘进协程取消令牌（null=需要发起——心跳自愈重启） */
  loopToken: CancelToken | null;
  /** 当前掘进格的 breaking 租约键（""=无；心跳按此续租） */
  activeKey: string;
}

/** 机械挖掘行为（record.workMode=mine） */
export class MineCap implements Capability {
  readonly id = "mine" as const;

  requires(): LeaseRequest[] {
    // 对准属掘进原子内聚语义（首格锚定后钉死射线），不走 gaze 租约/HOLD 任务表；
    // breaking 只逐格申领（见 hold），不预取类级租约——切换冲突由格级键判定，预检无对应占用者
    return [{ kind: "hands" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf(cap.data, "mine", () => ({
      loopToken: null as CancelToken | null,
      activeKey: "",
    }));
    cap.phase = { name: "CHECK", nextWakeAt: now };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    const ctx = cap?.data["mine"] as MineCtx | undefined;
    if (!cap || !ctx) return;
    // 常驻协程发起/自愈（异常尾不杀模式；stop 已销标，停后不会被误启）
    if (!ctx.loopToken) this.startLoop(session, ctx);
    // 心跳续租 hands 与当前格 breaking；本拍若触发自愈发起，bore 同步段已读射线并可能开挥（触世界），
    // 掘进节拍随后由常驻协程自持，tick 回调本身不等待、不自旋（F-18）
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    if (ctx.activeKey) session.leases.renew("breaking", this.id, now, ACTION_HOLD_TTL_TICKS, ctx.activeKey);
    setPhase(session, HEARTBEAT_POLL_TICKS, "DIG", now);
  }

  stop(session: Session, _now: number): void {
    // 幂等清场：取消常驻协程，bore finally 自扫 stopBreakingBlock 与末格租约；
    // 视角从未走 gaze 租约，无需中性化
    const ctx = session.capability?.data["mine"] as MineCtx | undefined;
    ctx?.loopToken?.cancel();
    if (ctx) ctx.loopToken = null;
  }

  // ─── 常驻掘进协程 ──

  private startLoop(session: Session, ctx: MineCtx): void {
    const token = new CancelToken();
    ctx.loopToken = token;
    // 仍属主才销标（绝不清新协程的标）；null → 下个心跳自愈重启（无 .finally，双路收敛）
    const retire = () => {
      if (ctx.loopToken === token) ctx.loopToken = null;
    };
    void breaker
      .bore(session.botId, {
        maxDistance: REACH,
        isCandidate: isMineCandidate,
        onTarget: (loc) => this.hold(session, ctx, loc),
        idleTicks: IDLE_RECHECK_TICKS,
        swingTicks: MINE_SWING_TICKS,
        ensureTool,
        token,
      })
      .then(retire)
      .catch((e: any) => {
        retire();
        console.warn(`[mockplayer3] 掘进协程异常 bot=${session.botId}: ${e?.message ?? e}`);
      });
  }

  /** breaking 逐格租约缝（bore 换格/开挥前调用）：还旧格、申领新格 */
  private hold(session: Session, ctx: MineCtx, loc: Vec3 | null): boolean {
    const key = loc ? blockKey(loc.x, loc.y, loc.z) : "";
    if (key !== ctx.activeKey) {
      if (ctx.activeKey) session.leases.release("breaking", this.id, ctx.activeKey);
      ctx.activeKey = key;
    }
    if (!loc) return false;
    return session.leases.acquire("breaking", this.id, "HOLD", clock.now(), ACTION_HOLD_TTL_TICKS, key).ok;
  }
}

// ─── 模块内小件 ──

function setPhase(session: Session, wakeDelay: number, name: MinePhase, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
}
