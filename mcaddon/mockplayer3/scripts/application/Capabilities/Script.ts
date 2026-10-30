// ─── 长流程模式能力（按动作表顺序执行；常驻异步协程 + 看门狗续租） ──────
// 分工：动作表模型与文本规格在 domain/ActionRules，执行游标（循环/跳转/死循环护栏）在
// domain/ActionCursor，读写与版本在 application/ScriptLibrary；本类只把动作落到引擎原子。
// tick 不做业务裁决（动作表节拍全在协程的 await 里），只续 hands/motion 租约并做存活检查。
// 失败语义：按动作表的 onFail 停下（状态记 failed + 告知主人）或跳过该条继续；模式不自动切换。
// 动作表被编辑或请求重跑 → 版本号变 → 协程在下一个动作边界换用新动作表重开一轮。

import { CancelToken } from "../../domain/Cancellation";
import type { Capability, LeaseRequest } from "../../domain/Capability";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { toolStrategyForBlock } from "../../domain/MineRules";
import type { ActionProgram, ActionStep } from "../../domain/ActionRules";
import { ActionCursor } from "../../domain/ActionCursor";
import type { Session } from "../../domain/Session";
import { sleepTicks } from "../../engine/Atomic";
import { attacker } from "../../engine/Attacker";
import { breaker } from "../../engine/Breaker";
import { clock } from "../../engine/Clock";
import { gaze } from "../../engine/Gaze";
import { handler } from "../../engine/Handler";
import { stopSwing } from "../../engine/Hands";
import { mover } from "../../engine/Mover";
import { placer } from "../../engine/Placer";
import { makeEnsureToolForBlock } from "../../engine/ToolKit";
import type { NavOutcome } from "../../domain/NavRules";
import type { EntityOps } from "../../engine/EntityOps";
import type { PanelOps } from "../../engine/PanelOps";
import type { ScriptLibrary } from "../ScriptLibrary";
import type { Runtime } from "../Runtime";

/** 每条之间的最小间隔（tick，防刷） */
const STEP_PACE_TICKS = 1;
/** 空动作表/待命时的重查间隔（tick） */
const IDLE_RECHECK_TICKS = 20;
/** 看门狗节拍（tick）：续租 + 存活检查 */
const WATCHDOG_TICKS = 20;
/** 说话前的最小间隔（tick） */
const SAY_GAP_TICKS = 10;
/** 每次挥击间隔（tick） */
const ATTACK_SWING_TICKS = 4;
/** 转向后等一拍再动作（tick） */
const AIM_SETTLE_TICKS = 5;
/** 破坏/视线的轮询与作用距离 */
const MINE_POLL_TICKS = 5;
const ACTION_MAX_DISTANCE = 6;

/** 能力私有上下文（挂 session.capability.data） */
interface ActionCtx {
  token: CancelToken;
  /** 本轮已执行到的动作表版本（外层据此判断"跑过且没新指令"） */
  version: number;
  /** 日志前缀（含假人名） */
  prefix: string;
}

/** 单步结果 */
type ActionStepOutcome = { status: "ok" } | { status: "fail"; message: string } | { status: "cancelled" };

/** 整段结果 */
type ActionsOutcome = "done" | "failed" | "cancelled" | "restart";

export class ScriptCap implements Capability {
  readonly id = "script" as const;
  private readonly ensureTool = makeEnsureToolForBlock(toolStrategyForBlock);
  constructor(
    private readonly runtime: Runtime,
    /** 指令表数据源（长流程模式的指令表库） */
    private readonly library: ScriptLibrary,
    private readonly ops: EntityOps,
    private readonly panelOps: PanelOps
  ) {}

  /** 模式中文名（日志与播报用） */
  private get label(): string {
    return "长流程模式";
  }

  /** 动作表会走路也用手：预取 hands/motion（破坏逐格另领，与定点挖掘同口径） */
  requires(): LeaseRequest[] {
    return [{ kind: "hands" }, { kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const record = this.runtime.record(session.botId);
    if (!record) return "记录缺失";
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    const ctx: ActionCtx = {
      token: new CancelToken(),
      version: -1,
      prefix: `[mockplayer3] ${this.label} ${record.name}`,
    };
    cap.data[this.id] = ctx;
    // ‼️ 每次挂载（含重启后自动上线、死亡复活、重新上线）都请求重跑一轮：
    // 否则协程会拿"上次已跑过的版本号"判定成"跑过且没有新指令"而停在待命，
    // 症状就是"上线后模式还在长流程模式、脚本却不继续做"（用户实测）。
    this.library.requestRerun(session.botId);
    cap.phase = { name: "RUN", nextWakeAt: now + WATCHDOG_TICKS };
    // 常驻协程：永不 reject（内部逐段 catch），停机靠令牌
    void this.runLoop(session, ctx).catch((e: any) => {
      console.warn(`${ctx.prefix} 协程异常: ${e?.message ?? e}`);
      this.library.status.patch(session.botId, {
        phase: "failed",
        message: `协程异常：${e?.message ?? e}`,
        updatedAt: clock.now(),
      });
    });
    return undefined;
  }

  /** 看门狗：续租 + 存活检查（动作表节拍不在这里） */
  tick(session: Session, now: number): void {
    const ctx = this.ctxOf(session);
    if (!ctx) return;
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    const cap = session.capability;
    if (cap) cap.phase = { name: "RUN", nextWakeAt: now + WATCHDOG_TICKS };
  }

  stop(session: Session, _now: number): void {
    const ctx = this.ctxOf(session);
    if (ctx) ctx.token.cancel();
    // 急停现场：走位作废、停止挥拍、视角中性化（注视走 gaze 原子）
    mover.stop(session.botId);
    stopSwing(session.botId);
    gaze.stopHold(session.botId);
    this.library.markIdle(session.botId, "已停止", clock.now());
  }

  // ─── 私有：常驻协程 ───

  private ctxOf(session: Session): ActionCtx | undefined {
    return session.capability?.data[this.id] as ActionCtx | undefined;
  }

  private async runLoop(session: Session, ctx: ActionCtx): Promise<void> {
    const botId = session.botId;
    while (!ctx.token.cancelled) {
      // 停止请求：收工待命。**不动工作模式**——模式是玩家选的，停脚本 != 退出长流程模式
      //（旧做法切模式回空闲，实测症状就是"跑完/失败后假人变回空闲模式"）。
      if (this.library.stopRequested(botId)) {
        ctx.version = this.library.versionOf(botId);
        await sleepTicks(IDLE_RECHECK_TICKS, ctx.token);
        continue;
      }
      const program = this.library.programOf(botId);
      const version = this.library.versionOf(botId);
      if (program.steps.length === 0) {
        this.library.status.patch(botId, {
          phase: "empty",
          stepIndex: 0,
          total: 0,
          cycle: 0,
          message: `还没有${this.label}`,
          updatedAt: clock.now(),
        });
        await sleepTicks(IDLE_RECHECK_TICKS, ctx.token);
        continue;
      }
      // 跑过且没有新的写入/重跑请求 → 待命（不空转世界）
      if (version === ctx.version) {
        await sleepTicks(IDLE_RECHECK_TICKS, ctx.token);
        continue;
      }
      ctx.version = version;
      const outcome = await this.executeProgram(session, ctx, program, version);
      if (ctx.token.cancelled) return;
      if (outcome === "restart") continue;
      await sleepTicks(IDLE_RECHECK_TICKS, ctx.token);
    }
  }

  private async executeProgram(
    session: Session,
    ctx: ActionCtx,
    program: ActionProgram,
    startedVersion: number
  ): Promise<ActionsOutcome> {
    const botId = session.botId;
    const cursor = new ActionCursor(program);
    let lastCycle = 0;
    for (;;) {
      if (ctx.token.cancelled) return "cancelled";
      // 动作表被编辑或请求重跑：立刻回外层用新动作表重开（不必等整轮跑完）
      if (this.library.versionOf(botId) !== startedVersion) return "restart";
      const stop = cursor.peek();
      if (stop.kind === "error") {
        this.failProgram(session, cursor.index + 1, cursor.total, cursor.cycle, stop.message);
        return "failed";
      }
      if (stop.kind === "cycle-end") {
        this.library.status.patch(botId, {
          phase: "completed",
          stepIndex: 0,
          total: cursor.total,
          cycle: stop.cycle,
          message: "已完成",
          updatedAt: clock.now(),
        });
        console.warn(`${ctx.prefix} 完成：${cursor.total} 条 × ${stop.cycle} 轮`);
        this.notifyOwner(session, `动作表已完成（${cursor.total} 条 × ${stop.cycle} 轮）`, "info");
        // 跑完即收工：只把状态板置为「已完成」，面板按钮自然会变回「▶ 启动脚本」。
        // ⚠️ 不要动工作模式——长流程模式是玩家选的，跑完一遍不该被踢回空闲模式。
        return "done";
      }
      if (stop.cycle !== lastCycle) {
        lastCycle = stop.cycle;
        if (stop.cycle > 1) console.warn(`${ctx.prefix} 第 ${stop.cycle} 轮开始`);
      }
      this.library.status.patch(botId, {
        phase: "running",
        stepIndex: stop.index + 1,
        total: cursor.total,
        cycle: stop.cycle,
        message: "",
        updatedAt: clock.now(),
      });
      const outcome = await this.executeStep(session, ctx, stop.step);
      if (outcome.status === "cancelled") {
        if (ctx.token.cancelled) return "cancelled";
      } else if (outcome.status === "fail") {
        if (program.onFail === "skip") {
          console.warn(`${ctx.prefix} 第 ${stop.index + 1} 条失败已跳过：${outcome.message}`);
          cursor.skip();
        } else {
          this.failProgram(session, stop.index + 1, cursor.total, stop.cycle, outcome.message);
          return "failed";
        }
      } else {
        cursor.commit();
      }
      await sleepTicks(STEP_PACE_TICKS, ctx.token);
    }
  }

  // ─── 私有：单步落地 ───

  private async executeStep(session: Session, ctx: ActionCtx, step: ActionStep): Promise<ActionStepOutcome> {
    const botId = session.botId;
    /** 转向可选坐标（带就转，等一拍让引擎生效） */
    const aimIfAny = async (look: { x: number; y: number; z: number } | undefined): Promise<void> => {
      if (!look) return;
      gaze.forceLook(botId, { x: look.x + 0.5, y: look.y + 0.5, z: look.z + 0.5 });
      await sleepTicks(AIM_SETTLE_TICKS, ctx.token);
    };

    switch (step.type) {
      // moveHere 与 moveTo 执行路径完全相同——区别只在"坐标从哪来"：moveHere 取的是
      // 添加指令那一刻玩家的站位（静态快照），moveTo 是手填/解析得到的坐标。
      case "moveTo":
      case "moveHere": {
        const result = await mover.navigateFar(botId, { x: step.x, y: step.y, z: step.z }, { token: ctx.token });
        if (ctx.token.cancelled) return { status: "cancelled" };
        return result === "arrived"
          ? { status: "ok" }
          : { status: "fail", message: `寻路失败（${navReason(result)}）` };
      }
      case "wait": {
        await sleepTicks(Math.max(1, step.ticks), ctx.token);
        return ctx.token.cancelled ? { status: "cancelled" } : { status: "ok" };
      }
      case "mine": {
        const cell = { x: step.x, y: step.y, z: step.z };
        const result = await breaker.breakAt(botId, cell, {
          token: ctx.token,
          pollTicks: MINE_POLL_TICKS,
          maxDistance: ACTION_MAX_DISTANCE,
          ensureTool: this.ensureTool,
        });
        if (ctx.token.cancelled) return { status: "cancelled" };
        return result === "broken"
          ? { status: "ok" }
          : { status: "fail", message: `挖掘失败（${breakReason(result)}）` };
      }
      case "mineLook": {
        await aimIfAny(step.look);
        if (ctx.token.cancelled) return { status: "cancelled" };
        const hit = breaker.viewBlock(botId, ACTION_MAX_DISTANCE);
        if (!hit) return { status: "fail", message: "视线内没有可挖掘的方块" };
        const result = await breaker.breakAt(botId, hit.location, {
          token: ctx.token,
          pollTicks: MINE_POLL_TICKS,
          maxDistance: ACTION_MAX_DISTANCE,
          requireLineOfSight: true,
          ensureTool: this.ensureTool,
        });
        if (ctx.token.cancelled) return { status: "cancelled" };
        return result === "broken"
          ? { status: "ok" }
          : { status: "fail", message: `挖掘失败（${breakReason(result)}）` };
      }
      case "place": {
        const result = placer.placeAt(botId, { x: step.x, y: step.y, z: step.z });
        return result === "placed"
          ? { status: "ok" }
          : { status: "fail", message: `放置失败（${placeAtReason(result)}）` };
      }
      case "useItem": {
        await aimIfAny(step.look);
        if (ctx.token.cancelled) return { status: "cancelled" };
        const result = await this.panelOps.useItemOnce(botId);
        if (ctx.token.cancelled) return { status: "cancelled" };
        if (result === "used") return { status: "ok" };
        if (result === "fully-fed") return { status: "fail", message: "饱食度已满，无法进食" };
        if (result === "unusable") return { status: "fail", message: "主手物品当前不可用（空手或不能使用）" };
        return { status: "fail", message: "假人不可用（离线/失效）" };
      }
      case "attack": {
        for (let i = 0; i < step.count; i++) {
          if (ctx.token.cancelled) return { status: "cancelled" };
          const result = attacker.swing(botId);
          if (result === "offline") return { status: "fail", message: "假人不可用（离线/失效）" };
          await sleepTicks(ATTACK_SWING_TICKS, ctx.token);
        }
        return ctx.token.cancelled ? { status: "cancelled" } : { status: "ok" };
      }
      case "say": {
        await sleepTicks(SAY_GAP_TICKS, ctx.token);
        if (ctx.token.cancelled) return { status: "cancelled" };
        return this.ops.say(botId, step.text)
          ? { status: "ok" }
          : { status: "fail", message: "假人不在场，话没发出去" };
      }
      case "look": {
        gaze.forceLook(botId, { x: step.x + 0.5, y: step.y + 0.5, z: step.z + 0.5 });
        return { status: "ok" };
      }
      case "sneak": {
        await aimIfAny(step.look);
        // 运行期姿态：只改实体，不写记录开关（重连由记录开关恢复，避免动作表改写玩家设置）
        this.ops.setSneaking(botId, step.on);
        return { status: "ok" };
      }
      case "hop": {
        await aimIfAny(step.look);
        if (ctx.token.cancelled) return { status: "cancelled" };
        return this.ops.jump(botId) ? { status: "ok" } : { status: "fail", message: "假人不在场，跳不起来" };
      }
      case "face": {
        // 面向（合并自 mock-player 3.1.7）：把记录下来的镜头朝向直接套到假人身上
        // （身体方向一次到位，朝向由 gaze 保持，不会被其它逻辑随手拉回）
        gaze.setBodyPose(botId, step.yaw, step.pitch);
        return { status: "ok" };
      }
      case "interact": {
        // 交互（合并自 mock-player 3.1.7）：与准星射线命中的方块/实体交互一次
        const r = handler.interactSight(botId);
        if (r === "interacted" || r === "container") return { status: "ok" };
        if (r === "busy") return { status: "fail", message: "交互过于频繁（两次间隔需 ≥4 tick）" };
        if (r === "offline") return { status: "fail", message: "假人不可用（离线/失效）" };
        if (r === "no-target") return { status: "fail", message: "视线 6 格内没有可交互的方块或实体" };
        return { status: "fail", message: "交互失败" };
      }
      case "jump":
        // 跳转由游标消化，不会作为待执行动作出现
        return { status: "ok" };
    }
  }

  // ─── 私有：失败与播报 ───

  private failProgram(session: Session, stepNo: number, total: number, cycle: number, reason: string): void {
    const botId = session.botId;
    console.warn(`${this.ctxPrefix(session)} 第 ${stepNo}/${total} 条失败：${reason}`);
    this.library.status.patch(botId, {
      phase: "failed",
      stepIndex: stepNo,
      total,
      cycle,
      message: reason,
      updatedAt: clock.now(),
    });
    this.notifyOwner(session, `第 ${stepNo}/${total} 条失败：${reason}（已停下，改好后再运行）`, "warn");
    // 失败也自动收工：状态板已置为 failed，面板按钮自然变回「▶ 启动脚本」。
    // ⚠️ 同样不动工作模式——失败后玩家常要改指令重跑，把他踢回空闲模式是反效果。
  }

  private notifyOwner(session: Session, text: string, level: "info" | "warn" | "error"): void {
    const record = this.runtime.record(session.botId);
    if (!record?.ownerKey) return;
    this.ops.notifyPlayer(record.ownerKey, `假人 ${record.name}：${text}`, level);
  }

  private ctxPrefix(session: Session): string {
    return this.ctxOf(session)?.prefix ?? `[mockplayer3] ${this.label}`;
  }
}

// ─── 私有小件：结果 → 中文原因 ────────────────────────────────────

function navReason(result: NavOutcome): string {
  switch (result) {
    case "arrived":
      return "已到达";
    case "too_far":
      return "超出最远走位距离";
    case "no_path":
      return "无路径可达";
    case "still_timeout":
      return "移动卡住";
    case "timeout":
      return "移动超时";
    case "unavailable":
      return "假人不可用（离线/死亡）";
    case "entity_invalid":
      return "移动中实体失效";
    case "error":
      return "被取消或异常";
  }
}

function breakReason(result: string): string {
  switch (result) {
    case "far":
      return `目标太远（>${ACTION_MAX_DISTANCE} 格）`;
    case "offline":
      return "假人不可用（离线/死亡）";
    case "busy":
      return "已有进行中的破坏动作";
    case "blocked":
      return "视线被遮挡";
    case "aborted":
      return "挖掘被中止";
    default:
      return `未完成（${result}）`;
  }
}

function placeAtReason(result: string): string {
  switch (result) {
    case "unchanged":
      return "引擎没放下（目标被占或落点不合法）";
    case "not-block":
      return "主手不是可放置方块";
    case "no-target":
      return "目标格六邻没有实心支撑";
    case "far":
      return `距离过远（放置需 ≤${ACTION_MAX_DISTANCE} 格）`;
    case "offline":
      return "假人不可用（离线/死亡）";
    default:
      return `未完成（${result}）`;
  }
}
