// ─── 注视/姿态原子（注视一律租约化，本层无常驻注视 API） ────────────
// F-06：Instant 约 2s 自回中，维持朝向必须持续重发 Continuous（HOLD 即周期重发），
// 租约 TTL 由上层 gaze 服务管控；中性化=把注视甩向身体朝向延长线（等效松手）。
// viewSettle 为生成类节点的一次性有界校正：4t 重发 / 200t 时限 / 12° 容差 / 64 格推点回退。

import { LookDuration } from "@minecraft/server-gametest";
import type { Vec2, Vec3 } from "../domain/Coords";
import {
  farLookPoint,
  isHeadFacing,
  rotationToward,
  VIEW_SETTLE_FALLBACK_DISTANCE,
  VIEW_SETTLE_INTERVAL,
  VIEW_SETTLE_TIMEOUT,
} from "../domain/Angle";
import { clock } from "./Clock";
import { botOf, botValid } from "./Atomic";

/** HOLD 任务：持续注视一个点（周期重发），或跟随身体朝向自旋（中性化前置态） */
interface HoldTask {
  target: Vec3;
}

/** 有界校正任务（生成类节点一次性发起，达标/超时/接管即撤） */
interface SettleTask {
  target: Vec3;
  want: Vec2;
  nextTick: number;
  expireTick: number;
  issued: boolean;
}

export class Gaze {
  private readonly holds = new Map<number, HoldTask>();
  private readonly settles = new Map<number, SettleTask>();
  /** 复活保护名册：保护的是记录侧姿态落库（调用方写记录前查询），不锁实体 */
  private readonly protectedPose = new Set<number>();
  private running = false;

  // ─── 身体/注视原子 ──

  /** 只改身体俯仰偏航（teleport 原位带 rotation——绝不用注视改身体） */
  setBodyPose(botId: number, yaw: number, pitch: number): void {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    try {
      bot.teleport(bot.location, { rotation: { x: pitch, y: yaw } });
    } catch {
      /* 瞬态失效 */
    }
  }

  /**
   * 发起 HOLD 注视（gaze 租约的持有方经此表达意图；重复调用=换目标）。
   * @returns 是否发起成功（实体不可达 false——调用方按失败处理）
   */
  startHold(botId: number, target: Vec3): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    this.holds.set(botId, { target });
    this.ensureRunning();
    this.issueLook(botId, target);
    return true;
  }

  /** 停止 HOLD 并中性化（注视甩向当前身体朝向远处——松手不残留旧目标） */
  stopHold(botId: number): void {
    this.holds.delete(botId);
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    try {
      const aim = farLookPoint(bot.getHeadLocation(), toRot(bot.getRotation()), VIEW_SETTLE_FALLBACK_DISTANCE);
      this.issueLook(botId, aim);
    } catch {
      /* 瞬态失效：注视随实体消亡 */
    }
  }

  /** 一次性瞄准（AIM_ONCE 执行体；F-06：Instant 的 2s 自回中即"执行后中性化"） */
  aimOnce(botId: number, target: Vec3): void {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    try {
      bot.lookAtLocation(target, LookDuration.Instant);
    } catch {
      /* lookAt 失败不致命，不影响移动 */
    }
  }

  /** 一次性 Continuous 注视；调用方自持重发节奏，不进 HOLD 任务表、不与租约互抢单槽 */
  forceLook(botId: number, target: Vec3): void {
    this.issueLook(botId, target);
  }

  /** 头部是否已对准目标（能力下一步回读） */
  isAimedAt(botId: number, target: Vec3, toleranceDeg?: number): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    try {
      const want = rotationToward(bot.getHeadLocation(), target);
      const head = bot.headRotation;
      return isHeadFacing({ x: head.x, y: head.y }, want, toleranceDeg);
    } catch {
      return false; // 读取失败按未对准保守处理
    }
  }

  // ─── 生成类节点的有界校正 ──

  /**
   * 发起一次性视线校正（复活尾巴/上线/显式同步后调用）；重复调用重置窗口。
   * @param botId 假人句柄
   * @param target 注视目标；缺省由当下身体朝向推 64 格远点
   */
  startSettle(botId: number, target?: Vec3): void {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    let tgt = target;
    let want: Vec2;
    try {
      if (!tgt) {
        const rot = toRot(bot.getRotation());
        tgt = farLookPoint(bot.getHeadLocation(), rot, VIEW_SETTLE_FALLBACK_DISTANCE);
        want = rot;
      } else {
        want = rotationToward(bot.getHeadLocation(), tgt);
      }
    } catch {
      return;
    }
    const now = clock.now();
    this.settles.set(botId, { target: tgt, want, nextTick: now, expireTick: now + VIEW_SETTLE_TIMEOUT, issued: false });
    this.ensureRunning();
  }

  /** 撤销校正（幂等——重复发起由 startSettle 重置窗口） */
  cancelSettle(botId: number): void {
    this.settles.delete(botId);
  }

  // ─── 复活姿态保护（记录侧，非实体侧） ──

  /** 自动复活期间挂保护：引擎可能重置实体姿态，此窗口拒绝记录姿态回写 */
  protectPose(botId: number): void {
    this.protectedPose.add(botId);
  }

  /**
   * 解除保护；显式姿态同步必须先解除再落库，否则保护标志挡住新朝向。
   */
  releasePose(botId: number): void {
    this.protectedPose.delete(botId);
    this.cancelSettle(botId);
  }

  /** 记录侧姿态落库前查询（SaveGate 调用方据此跳过 rotation/lookTarget 字段） */
  isPoseProtected(botId: number): boolean {
    return this.protectedPose.has(botId);
  }

  /** 会话销毁清场 */
  forget(botId: number): void {
    this.holds.delete(botId);
    this.settles.delete(botId);
    this.protectedPose.delete(botId);
  }

  // ─── 私有：驱动 ──

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    clock.onTick((now) => this.tick(now));
  }

  private tick(now: number): void {
    // HOLD：每 VIEW_SETTLE_INTERVAL 重发（周期重发即"续注"，Instant 回正被压制）
    if (now % VIEW_SETTLE_INTERVAL === 0) {
      for (const [botId, task] of this.holds) {
        if (!this.issueLook(botId, task.target)) this.holds.delete(botId);
      }
    }
    for (const [botId, task] of [...this.settles]) {
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) {
        this.settles.delete(botId);
        continue;
      }
      if (now < task.nextTick) continue;
      if (task.issued && this.isAimedAt(botId, task.target)) {
        // 已对准：注视保留（不回拉），任务终结
        this.settles.delete(botId);
        continue;
      }
      if (now >= task.expireTick) {
        this.settles.delete(botId); // 超时放弃（防极端情况无限重发）
        continue;
      }
      this.setBodyPose(botId, task.want.y, task.want.x);
      this.issueLook(botId, task.target);
      task.issued = true;
      task.nextTick = now + VIEW_SETTLE_INTERVAL;
    }
    if (this.holds.size === 0 && this.settles.size === 0) this.running = false;
  }

  /** 重发 Continuous 注视；实体失效返回 false（调用方清任务） */
  private issueLook(botId: number, target: Vec3): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    try {
      bot.lookAtLocation(target, LookDuration.Continuous);
      return true;
    } catch {
      return false;
    }
  }
}

/** 引擎 getRotation（x=pitch,y=yaw）→ domain Vec2 约定同形直传 */
function toRot(v: { x: number; y: number }): Vec2 {
  return { x: v.x, y: v.y };
}

/** 进程级单例 */
export const gaze = new Gaze();
