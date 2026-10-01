// ─── 唯一写入口 SaveGate ─────────────────────────────────────────────
// 一切记录/配置持久化收敛到本类：其余模块只持读视图。
// 代次守卫位于写入口内部（判定纯函数在 domain/SavePolicy），调用方无法绕过——
// F-26：假人生成自带空背包，恢复（epoch 提交）完成前的保存会覆盖真存档=永久丢数据。
// 拒写不抛错：计数 + debug 门控告警，巡检读 blocked 统计定位坏调用方。

import type { BotRecord } from "../domain/Record";
import { validateRecord } from "../domain/Record";
import type { DirtyField, Session } from "../domain/Session";
import type { WriteVerdict } from "../domain/SavePolicy";
import { permitCheckpoint, permitIncremental, shouldFlush, touchesItems } from "../domain/SavePolicy";
import type { GlobalConfig } from "../domain/Config";
import { clock } from "./Clock";
import type { RecordStore } from "./RecordStore";

/** 拒写计数（按守卫原因分类；巡检/冒烟断言用） */
export interface BlockedStats {
  epoch: number;
  frozen: number;
  noSession: number;
}

export interface SaveGateOptions {
  /** debug 门控（默认零日志；配置 debugLog 接线） */
  isDebug?: () => boolean;
}

export class SaveGate {
  /** 各会话上次增量冲刷时刻（tick） */
  private readonly lastFlushAt = new Map<number, number>();
  readonly blocked: BlockedStats = { epoch: 0, frozen: 0, noSession: 0 };
  private readonly isDebug: () => boolean;

  constructor(
    private readonly store: RecordStore,
    opts: SaveGateOptions = {}
  ) {
    this.isDebug = opts.isDebug ?? (() => false);
  }

  // ─── 增量通道 ──

  /**
   * 报脏（谁改的谁报脏）。许可判定此刻做：被拒的 mark 不落脏集——
   * epoch<1 会话改脏属恢复流程 bug，计数暴露而非静默积累。
   * @returns 是否已受理
   */
  mark(session: Session | null, fields: DirtyField[]): boolean {
    if (fields.length === 0) return false;
    const verdict = permitIncremental(session?.state ?? "OFFLINE", session?.epoch ?? 0, fields);
    if (!verdict.allow) {
      this.countBlocked(verdict, session, fields);
      return false;
    }
    session!.mark(fields);
    return true;
  }

  /**
   * debounce 冲刷（Scheduler 每 tick 对 ACTIVE/WORKING 会话调用；200t 合并写）。
   * 被守卫挡下时脏集放回，恢复完成后可冲。
   * @returns 是否执行了写入
   */
  flushDue(session: Session, record: BotRecord): boolean {
    if (
      !shouldFlush(clock.now(), this.lastFlushAt.get(session.botId) ?? Number.NEGATIVE_INFINITY, session.dirty.size)
    ) {
      return false;
    }
    const fields = session.takeDirty();
    if (fields.length === 0) return false;
    const verdict = permitIncremental(session.state, session.epoch, fields);
    if (!verdict.allow) {
      session.mark(fields); // 脏集放回，待状态/代次放行
      this.countBlocked(verdict, session, fields);
      return false;
    }
    this.lastFlushAt.set(session.botId, clock.now());
    return this.writeRecord(record);
  }

  /** 会话销毁时清冲刷簿记 */
  forgetSession(botId: number): void {
    this.lastFlushAt.delete(botId);
  }

  // ─── 关键点通道 ──

  /**
   * 关键点全量写（下线前/删除前/死亡快照）：同步直写不等 debounce。
   * 死亡快照语义"此刻有什么存什么"（F-27），epoch<1 亦放行。
   * @returns 是否执行了写入
   */
  checkpoint(session: Session | null, record: BotRecord, kind: "offline" | "death" | "delete"): boolean {
    const verdict = permitCheckpoint(session?.state ?? "OFFLINE", session?.epoch ?? 0, kind);
    if (!verdict.allow) {
      this.countBlocked(verdict, session, ["inventory", "equipment"]);
      return false;
    }
    if (kind === "death" || kind === "offline") this.lastFlushAt.delete(record.botId);
    return this.writeRecord(record);
  }

  // ─── 结构直写通道 ──

  /**
   * 记录结构直写（改配置/换模式/移主/启动对账归一离线——非实体镜像字段，
   * 任何状态放行；permitStructural 语义）。
   * @returns 是否执行了写入
   */
  saveRecord(record: BotRecord): boolean {
    return this.writeRecord(record);
  }

  /** 配置直写（管理员改动即时落） */
  saveConfig(config: GlobalConfig): void {
    this.store.writeConfig(config);
  }

  // ─── 结构旁路键透传（身份计数/名字票据/删除/绑定枚举——无实体镜像字段，
  // 不入记录/配置守卫范围，但仍收敛于本门面：持久化只有 SaveGate 一张面孔） ──

  allocateBotId(): number {
    return this.store.allocateBotId();
  }

  claimName(name: string, botId: number): void {
    this.store.claimName(name, botId);
  }

  releaseName(name: string): void {
    this.store.releaseName(name);
  }

  lookupBotId(name: string): number | undefined {
    return this.store.lookupBotId(name);
  }

  loadNameIndex(): Map<string, number> {
    return this.store.loadNameIndex();
  }

  deleteRecord(botId: number): void {
    this.store.deleteRecord(botId);
  }

  listBindingBotIds(): number[] {
    return this.store.listBindingBotIds();
  }

  deleteBinding(botId: number): void {
    this.store.deleteBinding(botId);
  }

  // ─── 读视图 ──

  loadRecord(botId: number): BotRecord | undefined {
    return this.store.loadRecord(botId);
  }

  loadAll(): BotRecord[] {
    return this.store.loadAll();
  }

  loadConfig(): GlobalConfig {
    return this.store.loadConfig();
  }

  // ─── 私有 ──

  /** 落库前统一动作：不变量校验 + updatedAt 盖章；校验失败拒写告警 */
  private writeRecord(record: BotRecord): boolean {
    const error = validateRecord(record);
    if (error) {
      console.error(`[mockplayer3] 保存被拒 bot=${record.botId}: ${error}`);
      return false;
    }
    record.updatedAt = Date.now();
    // DP 超限抛编程错误不拦截（F-24：说明负载放错通道，必须炸给开发者）
    this.store.writeRecord(record);
    return true;
  }

  private countBlocked(verdict: WriteVerdict, session: Session | null, fields: DirtyField[]): void {
    if (verdict.blockedBy) this.blocked[verdict.blockedBy]++;
    if (this.isDebug()) {
      const itemFlag = touchesItems(fields) ? " [含物品字段]" : "";
      console.warn(
        `[mockplayer3] SaveGate 拒写 bot=${session?.botId ?? "?"} 原因=${verdict.blockedBy ?? "?"}${itemFlag}（计数 epoch=${this.blocked.epoch} frozen=${this.blocked.frozen} noSession=${this.blocked.noSession}）`
      );
    }
  }
}
