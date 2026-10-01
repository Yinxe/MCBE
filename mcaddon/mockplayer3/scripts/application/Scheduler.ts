// ─── 调度器（主循环唯一驱动者） ────────────────────────────────────
// 订阅 Clock 单例，每 tick：租约过期清理 → WORKING 能力按 nextWakeAt 唤起 →
// 经验周期回写 → debounce 增量冲刷（SaveGate 通道）。
// tick 回调同步、短、无 await、无自旋（F-18）；逐会话异常隔离，
// 任一假人报错不牵连同 tick 其余假人，能力 tick 抛穿只停该能力并落空闲。

import type { BotRecord } from "../domain/Record";
import type { Session } from "../domain/Session";
import { clock } from "../engine/Clock";
import { gaze } from "../engine/Gaze";
import type { EntityOps } from "../engine/EntityOps";
import type { SaveGate } from "../engine/SaveGate";
import type { Modes } from "./Modes";
import type { Runtime } from "./Runtime";
import type { WorkTransfer } from "./WorkTransfer";

/** 经验回写周期：挖掘经验挂在实体上，不回写则面板显示上线前快照 */
const XP_SYNC_TICKS = 100;
/** 滞留物品补写重试周期：仓区块未加载时导出压内存，定期探块落仓 */
const PENDING_EXPORT_RETRY_TICKS = 20;

export class Scheduler {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly runtime: Runtime,
    private readonly saveGate: SaveGate,
    private readonly modes: Modes,
    private readonly ops: EntityOps,
    private readonly transfer: WorkTransfer
  ) {}

  /** 启动主循环（幂等；main.ts 装配末尾 clock.start() 之后调用） */
  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = clock.onTick((now) => this.tick(now));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private tick(now: number): void {
    // 滞留导出补写：仅在有滞留时探一次区块，正常态零世界读写（F-18）
    if (now % PENDING_EXPORT_RETRY_TICKS === 0 && this.ops.pendingExportCount() > 0) {
      try {
        this.ops.drainPendingExports();
      } catch (e: any) {
        console.error(`[mockplayer3] 滞留物品补写异常: ${e?.message ?? e}`);
      }
    }
    for (const session of [...this.runtime.sessions.values()]) {
      // 逐会话隔离：任一步抛穿只停本会话当轮，其余会话照常调度
      try {
        this.runSession(session, now);
      } catch (e: any) {
        console.error(`[mockplayer3] 会话调度异常 bot=${session.botId}: ${e?.message ?? e}`);
      }
    }
  }

  private runSession(session: Session, now: number): void {
    const record = this.runtime.record(session.botId);
    if (!record) return;
    // 租约 TTL 过期撤销；gaze HOLD 过期兑现中性化，忘续租不会把视角焊死（F-06）
    const expired = session.leases.expire(now);
    if (expired.some((l) => l.kind === "gaze" && l.mode === "HOLD")) gaze.stopHold(session.botId);
    const ctx = session.capability;
    if (session.state === "WORKING" && ctx && now >= ctx.phase.nextWakeAt) {
      const cap = this.modes.capabilityOf(ctx.mode);
      if (cap) {
        try {
          cap.tick(session, now);
        } catch (e: any) {
          console.error(`[mockplayer3] 能力 tick 异常 bot=${session.botId} mode=${ctx.mode}: ${e?.message ?? e}`);
          // 落空闲走 Modes 统一口径：卸能力、状态迁移、workMode 写穿并广播，不留 WORKING
          this.modes.forceIdle(session, now);
        }
      }
    }
    if (session.state === "ACTIVE" || session.state === "WORKING") {
      // 经验周期回写：RESTORING 冻结窗由 SaveGate mark/epoch 双挡，不会用新生成体的 0 级覆盖存档值；
      // 仅变化时报脏
      if (now % XP_SYNC_TICKS === 0) this.syncExperience(session, record);
      this.transfer.tick(session, record, now);
      this.saveGate.flushDue(session, record);
    }
  }

  private syncExperience(session: Session, record: BotRecord): void {
    const exp = this.ops.captureExperience(session.botId);
    if (exp && (exp.level !== record.experience.level || exp.totalXp !== record.experience.totalXp)) {
      record.experience = exp;
      this.saveGate.mark(session, ["experience"]);
    }
  }
}
