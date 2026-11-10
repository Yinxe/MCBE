// ─── 采集能力（一类采集对象的执行壳：心跳租约 + 工作区保活 + 大脑指令落地） ───
// "该挖哪格/下一步做什么"全部在 domain/HarvestAI，本类只做机械执行与资源把守：
// 指令 → mover/hands/suction/toolKit 一次原子调用；注视不走 gaze 租约（逐格重瞄属
// chain 内聚语义，纯视觉不占资源）。一种采集对象一实例（id=harvest_<kind>）。

import type { Session } from "../../domain/Session";
import type { Capability } from "../../domain/Capability";
import type { LeaseRequest } from "../../domain/Capability";
import type { HarvestMode } from "../../domain/Record";
import type { Vec3 } from "../../domain/Coords";
import type { HarvestKindId } from "../../domain/HarvestRules";
import {
  HARVEST_INIT_TICKS,
  HARVEST_NAV_SPEED,
  HARVEST_NAV_WALK_BUDGET_TICKS,
  HARVEST_RECHECK_TICKS,
  harvestRecipe,
} from "../../domain/HarvestRules";
import type { HarvestPoint, HarvestRecipe } from "../../domain/HarvestRules";
import type { WalkOutcome } from "../../domain/NavRules";
import type { SharedPool } from "../../domain/Pool";
import { ACTION_HOLD_TTL_TICKS, blockKey } from "../../domain/Leases";
import { ownerBotId } from "../../domain/Session";
import { HarvestBrain } from "../../domain/HarvestAI";
import type { HarvestCommand, HarvestScanJob, HarvestSenses } from "../../domain/HarvestAI";
import { readBlock } from "../../engine/Atomic";
import { mover } from "../../engine/Mover";
import { aimCell, stopSwing, swingCell } from "../../engine/Hands";
import { suction } from "../../engine/DropSuction";
import { makeEnsureTool } from "../../engine/ToolKit";
import { RegionScanner } from "../../engine/Scanner";
import {
  KEEPALIVE_FORCE_RELEASE_TICKS,
  WORK_RECENTER_CHUNKS,
  tickingAreas,
  workAreaName,
} from "../../engine/TickingAreas";
import type { Runtime } from "../Runtime";
import type { CapabilityHost } from "./Common";
import { ctxOf } from "./Common";

/** 能力私有上下文（挂 session.capability.data，会话亡即亡） */
interface HarvestCtx {
  brain: HarvestBrain | null;
  /** 大脑绑定的维度（换维重建大脑——点池/扫描都按域寻址） */
  brainDim: string | null;
  /** 当前持有的 breaking 逐格位租约键（""=未持） */
  breakingKey: string;
  workCenterChunk: { cx: number; cz: number } | null;
  workCenterDim: string | null;
  /** 在途走位结论缓冲（协程回写只碰这一格；下一拍 tick 起头喂给大脑后清空） */
  walkResult: WalkOutcome | null;
  /** 在途走位代数：每次发起/停机自增，迟到结论按代数丢弃 */
  walkGen: number;
}

function seedCtx(): HarvestCtx {
  return {
    brain: null,
    brainDim: null,
    breakingKey: "",
    workCenterChunk: null,
    workCenterDim: null,
    walkResult: null,
    walkGen: 0,
  };
}

export class HarvestCap implements Capability {
  readonly id: HarvestMode;
  private readonly recipe: HarvestRecipe;
  private readonly ensureTool: (botId: number, blockTypeId: string) => void;

  constructor(
    private readonly runtime: Runtime,
    private readonly host: CapabilityHost,
    private readonly kind: HarvestKindId
  ) {
    this.id = `harvest_${kind}` as HarvestMode;
    this.recipe = harvestRecipe(kind);
    this.ensureTool = makeEnsureTool(this.recipe.toolStrategy);
  }

  requires(): LeaseRequest[] {
    return [{ kind: "hands" }, { kind: "breaking" }, { kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    if (!this.runtime.record(session.botId)) return "记录缺失";
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf(cap.data, this.id, seedCtx);
    cap.phase = { name: "INIT", nextWakeAt: now + HARVEST_INIT_TICKS };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap) return;
    const ctx = ctxOf(cap.data, this.id, seedCtx);
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    if (ctx.breakingKey) session.leases.renew("breaking", this.id, now, ACTION_HOLD_TTL_TICKS, ctx.breakingKey);
    const self = mover.snapshotOf(session.botId);
    if (!self) {
      cap.phase = { name: "PLAN", nextWakeAt: now + HARVEST_RECHECK_TICKS };
      return;
    }
    this.keepWorkArea(session, ctx, self);
    const grounds = this.runtime.harvestGrounds;
    const dimId = self.dimensionId;
    if (ctx.brain && ctx.brainDim !== dimId) this.forfeitBrain(session, ctx); // 换维：旧域持点先归还
    const brain = this.ensureBrain(session, ctx, dimId, grounds.pool(dimId, this.kind));
    if (ctx.walkResult) {
      brain.standDone(ctx.walkResult);
      ctx.walkResult = null;
    }
    const result = brain.tick(now, self.location);
    for (const cmd of result.commands) {
      const stop = this.execute(session, ctx, now, dimId, cmd);
      if (stop) return; // autoStop 已触发模式切换（stop 已跑完），不再回写相位
    }
    cap.phase = { name: brain.phaseName, nextWakeAt: now + result.wakeIn };
  }

  stop(session: Session, _now: number): void {
    const cap = session.capability;
    const ctx = cap?.data[this.id] as HarvestCtx | undefined;
    if (!ctx) return;
    ctx.walkGen++; // 在途走位结论作废（停机后重启不得消费上一轮的迟到结论）
    ctx.walkResult = null;
    this.forfeitBrain(session, ctx);
    mover.stop(session.botId);
    stopSwing(session.botId);
    suction.releaseBot(session.botId);
    if (ctx.workCenterChunk !== null && ctx.workCenterDim !== null) {
      // 停机卸载工作保活：宽限 + 强制兜底两道
      const wa = workAreaName(session.botId);
      tickingAreas.scheduleRelease(wa, ctx.workCenterDim);
      tickingAreas.scheduleRelease(wa, ctx.workCenterDim, KEEPALIVE_FORCE_RELEASE_TICKS);
    }
    ctx.workCenterChunk = null;
    ctx.workCenterDim = null;
    // breaking/hands/motion 全表由 Modes.stopCurrent releaseBy 统一撤；
    // 视角无需中性化——lookAt 属 chain 内聚语义，从未走 gaze 租约
  }

  // ─── 私有：大脑装配 ──

  private ensureBrain(session: Session, ctx: HarvestCtx, dimId: string, pool: SharedPool<HarvestPoint>): HarvestBrain {
    if (ctx.brain && ctx.brainDim === dimId) return ctx.brain;
    const grounds = this.runtime.harvestGrounds;
    const senses: HarvestSenses = {
      read: (cell) => readBlock(dimId, cell)?.id,
      startScan: (rect, types) => this.startScan(dimId, rect, types),
      log: (msg) => this.dbg(session, msg),
    };
    ctx.brain = new HarvestBrain({
      recipe: this.recipe,
      pool,
      owner: session.sessionId,
      senses,
      scanDue: (now) => grounds.scanDue(dimId, this.kind, now),
      markScanned: (now) => grounds.markScanned(dimId, this.kind, now),
      claimLive: (holder) => {
        const botId = ownerBotId(holder);
        return botId !== undefined && this.runtime.session(botId)?.sessionId === holder;
      },
    });
    ctx.brainDim = dimId;
    return ctx.brain;
  }

  private forfeitBrain(session: Session, ctx: HarvestCtx): void {
    if (!ctx.brain) return;
    ctx.walkGen++; // 在途走位结论随会话/域切换作废
    ctx.walkResult = null;
    const cmds = ctx.brain.forfeit();
    for (const cmd of cmds) this.executeCommandOnly(session, ctx, cmd);
    ctx.brain = null;
    ctx.brainDim = null;
  }

  private startScan(dimId: string, rect: { min: Vec3; max: Vec3 }, types: readonly string[]): HarvestScanJob {
    const scanner = new RegionScanner(dimId, rect, types, { requireAirAbove: false, allowUnloaded: true });
    return {
      step: (budget) => scanner.step(budget),
      get done() {
        return scanner.done;
      },
      get ok() {
        return scanner.ok;
      },
    };
  }

  // ─── 私有：指令落地 ──

  /** @returns true=本拍终止（autoStop 已切模式） */
  private execute(session: Session, ctx: HarvestCtx, now: number, dimId: string, cmd: HarvestCommand): boolean {
    const botId = session.botId;
    switch (cmd.op) {
      case "navigate": {
        // 走位结论一律由 engine 的位置观测得出（Mover.walkTo）；结论缓冲，下一拍回灌大脑
        const gen = ++ctx.walkGen;
        mover
          .walkTo(botId, cmd.to, { speed: HARVEST_NAV_SPEED, timeoutTicks: HARVEST_NAV_WALK_BUDGET_TICKS })
          .then((outcome) => {
            if (gen !== ctx.walkGen) return; // 已被新走位/停机取代——迟到结论丢弃
            ctx.walkResult = outcome;
          });
        return false;
      }
      case "stopMove":
        mover.stop(botId);
        return false;
      case "aim":
        aimCell(botId, cmd.cell);
        return false;
      case "tool": {
        const info = readBlock(dimId, cmd.cell);
        if (info && !info.air) this.ensureTool(botId, info.id);
        return false;
      }
      case "swing": {
        if (!this.holdBreaking(session, ctx, now, cmd.cell)) return false; // 同格被他假人占：本拍空过，大脑按无进展裁决
        if (!swingCell(botId, cmd.cell)) this.dbg(session, `挥拍未被受理 (${cmd.cell.x},${cmd.cell.y},${cmd.cell.z})`);
        return false;
      }
      case "stopSwing":
        stopSwing(botId);
        if (ctx.breakingKey) {
          session.leases.release("breaking", this.id, ctx.breakingKey);
          ctx.breakingKey = "";
        }
        return false;
      case "suck":
        suction.suck(dimId, cmd.center, (typeId) => this.recipe.acceptsDrop(typeId), botId);
        return false;
      case "autoStop":
        this.host.autoStop(botId, cmd.reason);
        return true;
    }
  }

  /** forfeit 路径只落急停两类指令（租约可能已随模式切换撤走，不再触池） */
  private executeCommandOnly(session: Session, ctx: HarvestCtx, cmd: HarvestCommand): void {
    if (cmd.op === "stopSwing") {
      stopSwing(session.botId);
      if (ctx.breakingKey) {
        session.leases.release("breaking", this.id, ctx.breakingKey);
        ctx.breakingKey = "";
      }
    } else if (cmd.op === "stopMove") mover.stop(session.botId);
  }

  /** 逐格位破坏租约：换格先撤旧键再取新键；被占 false（本拍不挥） */
  private holdBreaking(
    session: Session,
    ctx: HarvestCtx,
    now: number,
    cell: { x: number; y: number; z: number }
  ): boolean {
    const key = blockKey(cell.x, cell.y, cell.z);
    if (ctx.breakingKey === key) return true;
    if (ctx.breakingKey) session.leases.release("breaking", this.id, ctx.breakingKey);
    if (!session.leases.acquire("breaking", this.id, "HOLD", now, ACTION_HOLD_TTL_TICKS, key).ok) {
      ctx.breakingKey = "";
      return false;
    }
    ctx.breakingKey = key;
    return true;
  }

  // ─── 私有：工作区保活 ──

  /**
   * 以脚位所在区块为心维护圆 r=4 常载区（tickingarea add circle，F-20），使 ±16 格扫描盒
   * 落在已加载块内——否则 getBlocks 命中未加载块抛 UnloadedChunksError，
   * 整轮扫描判失败、树位取不到。脚位区块距中心 ≥ WORK_RECENTER_CHUNKS 即重划；
   * 创建失败（含容量上限）只警告留痕，同一中心不重试，待脚位漂移再划。
   */
  private keepWorkArea(session: Session, ctx: HarvestCtx, self: { location: Vec3; dimensionId: string }): void {
    const cx = Math.floor(self.location.x / 16);
    const cz = Math.floor(self.location.z / 16);
    const drift =
      ctx.workCenterChunk === null ||
      ctx.workCenterDim !== self.dimensionId ||
      Math.abs(cx - ctx.workCenterChunk.cx) >= WORK_RECENTER_CHUNKS ||
      Math.abs(cz - ctx.workCenterChunk.cz) >= WORK_RECENTER_CHUNKS;
    if (!drift) return;
    ctx.workCenterChunk = { cx, cz };
    ctx.workCenterDim = self.dimensionId;
    const center = { x: cx * 16 + 8, y: Math.floor(self.location.y), z: cz * 16 + 8 };
    const r = tickingAreas.ensureWorkArea(session.botId, self.dimensionId, center);
    if (!r.ok) {
      this.dbg(session, `工作保活失败（${r.reason}）`);
      return;
    }
    this.dbg(session, `工作保活 区块(${cx},${cz}) 圆r=4`);
  }

  private dbg(session: Session, detail: string): void {
    console.warn(
      `[mockplayer3] ${this.recipe.label} ${this.runtime.record(session.botId)?.name ?? session.botId} ${detail}`
    );
  }
}
