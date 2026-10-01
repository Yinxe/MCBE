// ─── 模式切换编排 ──────────────────────────────────────────────────
// 切换序列：停旧 → 前置预检 → 租约预取（冲突即拒）→ start → 状态迁移 → 写穿记录 → 通知。
// 能力注册表归本类；未注册的模式拒绝启动，不静默落空。
// 停旧之后的失败分支（未注册/预取冲突/start 拒绝或异常）一律落空闲并广播，不留 WORKING。

import type { Capability } from "../domain/Capability";
import { isExperimentalMode } from "../domain/Catalog";
import type { BotRecord, WorkMode } from "../domain/Record";
import type { Session } from "../domain/Session";
import { ACTION_HOLD_TTL_TICKS, GAZE_HOLD_TTL_TICKS } from "../domain/Leases";
import { gaze } from "../engine/Gaze";
import type { SaveGate } from "../engine/SaveGate";
import type { BotEventBus } from "./Events";
import type { Runtime } from "./Runtime";

export type ChangeResult = { ok: true } | { ok: false; reason: string };

export class Modes {
  private readonly caps = new Map<WorkMode, Capability>();

  constructor(
    private readonly runtime: Runtime,
    private readonly saveGate: SaveGate,
    private readonly events: BotEventBus
  ) {}

  /** 能力注册（装配期逐个注入；id 即 WorkMode） */
  register(cap: Capability): void {
    this.caps.set(cap.id, cap);
  }

  capabilityOf(mode: WorkMode): Capability | undefined {
    return this.caps.get(mode);
  }

  /**
   * 切换工作模式；同模式重投按幂等成功。
   * 无会话走持久化支：只写穿记录 workMode，下次上线/复活流程末尾由
   * attachAfterRestore 重新挂载能力生效。
   * @param botId - 目标假人
   * @param to - 目标模式
   * @param now - 时钟 tick（由调用方取）
   * @returns 成功，或带中文原因的拒绝
   */
  change(botId: number, to: WorkMode, now: number): ChangeResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (!this.runtime.config.workModeEnabled[to]) return this.refuse(record, to, "该模式已被管理员禁用");
    if (isExperimentalMode(to) && !this.runtime.config.experimentalEnabled)
      return this.refuse(record, to, "该功能尚在实现中（管理员未开启「实现性功能」总闸）");
    const session = this.runtime.session(botId);
    if (!session) {
      if (to !== "none" && !this.caps.get(to)) return this.refuse(record, to, "该模式能力尚未注册");
      if (record.workMode === to) return { ok: true }; // 幂等重投
      const fromOffline = record.workMode;
      record.workMode = to;
      this.saveGate.saveRecord(record);
      console.warn(`[mockplayer3] 模式预置 ${record.name}: ${fromOffline} → ${to}（离线，下次上线生效）`);
      this.events.emit("botWorkModeChanged", { botId, name: record.name, from: fromOffline, to });
      return { ok: true };
    }
    if (session.state !== "ACTIVE" && session.state !== "WORKING" && !(to === "none" && session.state === "DYING")) {
      return this.refuse(record, to, "当前状态不可切换模式");
    }

    const from = record.workMode;
    if (from === to && (to === "none" ? session.capability === null : session.capability?.mode === to)) {
      return { ok: true }; // 幂等重投
    }

    this.stopCurrent(session, now);
    if (to === "none") {
      console.warn(`[mockplayer3] 模式切换 ${record.name}: ${from} → none`);
      this.settleIdle(session, record, from);
      return { ok: true };
    }

    const cap = this.caps.get(to);
    if (!cap) {
      // 旧能力已卸：状态与 workMode 同步落定并广播，不留 WORKING
      this.dropToIdle(session, record, from, to);
      return this.refuse(record, to, "该模式能力尚未注册");
    }

    // 租约预取（冲突即拒）
    for (const req of cap.requires(session)) {
      const ttl = req.kind === "gaze" ? GAZE_HOLD_TTL_TICKS : ACTION_HOLD_TTL_TICKS;
      const got = session.leases.acquire(req.kind, cap.id, req.mode ?? "HOLD", now, ttl);
      if (!got.ok) {
        // 旧能力已卸：预取失败同样落空闲，避免 WORKING + capability null + workMode 旧值
        this.dropToIdle(session, record, from, cap.id);
        return this.refuse(record, to, `所需资源被占用（持有者：${got.holder.owner}）`);
      }
    }

    // 能力上下文先建后交；能力无实例态，私有数据全挂 capability.data
    session.capability = { mode: to, phase: { name: "INIT", nextWakeAt: now }, data: {} };
    // start 抛穿与拒绝同口径落空闲，拒绝原因回显；调用链不中断
    let startError: string | undefined;
    try {
      startError = cap.start(session, now);
    } catch (e: any) {
      this.dropToIdle(session, record, from, cap.id);
      return this.refuse(record, to, `能力启动异常: ${e?.message ?? e}`);
    }
    if (startError) {
      this.dropToIdle(session, record, from, cap.id);
      return this.refuse(record, to, startError);
    }

    this.runtime.transitTo(botId, "startWork");
    record.workMode = to;
    this.saveGate.saveRecord(record);
    console.warn(`[mockplayer3] 模式切换 ${record.name}: ${from} → ${to}`);
    this.events.emit("botWorkModeChanged", { botId, name: record.name, from, to });
    return { ok: true };
  }

  /**
   * 强制落空闲：卸载在位能力后走与切换落空闲相同的收尾口径（状态迁移、写穿、广播）。
   * 供调度器能力 tick 抛穿分支使用。
   * @param session - 目标会话
   * @param now - 时钟 tick（由调用方取）
   */
  forceIdle(session: Session, now: number): void {
    const record = this.runtime.record(session.botId);
    this.stopCurrent(session, now);
    if (!record) return;
    const from = record.workMode;
    console.warn(`[mockplayer3] 模式切换 ${record.name}: ${from} → none`);
    this.settleIdle(session, record, from);
  }

  /** 切换被拒的统一播报口（命令/面板回执之外留一条游戏日志） */
  private refuse(record: { name: string }, to: WorkMode, reason: string): ChangeResult {
    console.warn(`[mockplayer3] 模式切换被拒 ${record.name} → ${to}: ${reason}`);
    return { ok: false, reason };
  }

  /** 落空闲收尾口径：状态迁移 stopWork、workMode 写穿 none、广播模式变化（SaveGate 通道） */
  private settleIdle(session: Session, record: BotRecord, from: WorkMode): void {
    this.runtime.transitTo(session.botId, "stopWork");
    record.workMode = "none";
    this.saveGate.saveRecord(record);
    this.events.emit("botWorkModeChanged", { botId: session.botId, name: record.name, from, to: "none" });
  }

  /** 启动失败清场：撤目标能力已取租约、卸上下文，再落空闲；未注册/预取冲突/start 拒绝或异常共用 */
  private dropToIdle(session: Session, record: BotRecord, from: WorkMode, capId: WorkMode): void {
    session.leases.releaseBy(capId);
    session.capability = null;
    this.settleIdle(session, record, from);
  }

  /** 上线/复活流程末尾重新挂载能力：workMode 非 none 时按切换序列重建；失败原因回传由管线决定 */
  attachAfterRestore(botId: number, now: number): ChangeResult {
    const record = this.runtime.record(botId);
    if (!record) return { ok: false, reason: "假人不存在" };
    if (record.workMode === "none") return { ok: true };
    return this.change(botId, record.workMode, now);
  }

  /** 卸载当前能力（幂等）：stop 抛穿只留日志，租约必撤；下线/切换/死亡三管线共用 */
  stopCurrent(session: Session, now: number): void {
    const mode = session.capability?.mode;
    if (mode === undefined || mode === "none") {
      session.capability = null;
      return;
    }
    const cap = this.caps.get(mode);
    try {
      // 卸载顺序不变量：stop 必须在 capability 仍挂位时执行——
      // 能力清场经 data 取 ctx 归还占用，先摘后调会泄漏
      cap?.stop(session, now);
    } catch (e: any) {
      console.error(`[mockplayer3] 能力卸载异常 bot=${session.botId} mode=${mode}: ${e?.message ?? e}`);
    }
    session.capability = null;
    const removed = session.leases.releaseBy(mode);
    // gaze HOLD 的 release 即视角中性化（F-06）：stop 抛穿也要兑现；AIM_ONCE 无引擎侧任务不在此列
    if (removed.some((l) => l.kind === "gaze" && l.mode === "HOLD")) gaze.stopHold(session.botId);
  }
}
