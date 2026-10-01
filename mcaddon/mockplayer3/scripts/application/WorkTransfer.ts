// ─── 工作箱搬运巡检（Scheduler 驱动；吸取/经验仍由各能力自理，互不相关） ──
// 每 SWEEP_TICKS 对已绑箱的在线假人巡检一次：背包中"本模式工作产物 + 非保护
// 名单"的物品按格走 ContainerOps 组件路径搬入绑定箱（F-12，不发右键）。
// 在途每 BEAM_PULSE_TICKS 重画一次假人→箱粒子线；搬成点亮箱子输入光效+音效。
// 搬运失败不吞物品：transferItem 失败源槽不动、回读不符计入 failed 留在背包；
// "箱丢失/箱满"两种故障按状态迁移各告警主人一次（同状态不重复轰炸）；主人
// 离线未送达按 ALERT_RETRY_TICKS 重试直到送达或被个人设置明确屏蔽，
// 世界恢复后巡检自动续搬并发一次恢复通知。

import type { BotRecord } from "../domain/Record";
import type { Session } from "../domain/Session";
import type { WorkChestInfo } from "../domain/WorkChest";
import { planWorkTransfer, workProductMatcher } from "../domain/WorkChest";
import type { HarvestDropRule } from "../domain/WorkChest";
import { CancelToken } from "../domain/Cancellation";
import { parseHarvestKind, specOf } from "../domain/HarvestRules";
import { containerOps } from "../engine/ContainerOps";
import type { MoveReport } from "../engine/ContainerOps";
import { probeWorkChest, workChests } from "../engine/WorkChests";
import { chestInputFlash, transferBeam } from "../engine/WorkChestFx";
import { mover } from "../engine/Mover";
import type { EntityOps } from "../engine/EntityOps";
import type { Runtime } from "./Runtime";

/** 巡检节拍（tick）：绑箱假人每此间隔最多发起一次搬运 */
const SWEEP_TICKS = 40;
/** 在途连线重画间隔（tick）：粒子寿命 ~1.2s，10t 一画形成连续线 */
const BEAM_PULSE_TICKS = 10;
/** 满箱退避（tick）：整批全失败后压此间隔再试，防空转刷屏 */
const FULL_BACKOFF_TICKS = 200;
/** 区块读不到重试（tick）：瞬态不告警，短退避再看 */
const UNREADABLE_RETRY_TICKS = 100;
/** 告警未送达（主人离线）重试（tick）：送达确认或玩家个人设置屏蔽前压间隔重发 */
const ALERT_RETRY_TICKS = 200;

/** 故障态（状态迁移才告警；null/缺省=正常） */
type FailKind = "lost" | "full";

export class WorkTransfer {
  private readonly lastSweep = new Map<number, number>();
  private readonly lastBeam = new Map<number, number>();
  private readonly backoffUntil = new Map<number, number>();
  private readonly inFlight = new Set<number>();
  private readonly failState = new Map<number, FailKind>();
  /** 告警重试门（botId→下次可发 tick）：主人离线未确认时按间隔重发 */
  private readonly alertRetryAt = new Map<number, number>();
  /** 在途搬运的取消令牌（suspend/forget 撤销——阻断重试轮） */
  private readonly tokens = new Map<number, CancelToken>();
  /** 下线管线冻结标（物品导出前置位；botOffline 的 forget 清除） */
  private readonly suspended = new Set<number>();

  constructor(
    private readonly runtime: Runtime,
    private readonly ops: EntityOps
  ) {}

  /** 下线/删除清态（botId 会被复用，不得继承旧巡检/告警态） */
  forget(botId: number): void {
    this.lastSweep.delete(botId);
    this.lastBeam.delete(botId);
    this.backoffUntil.delete(botId);
    this.inFlight.delete(botId);
    this.failState.delete(botId);
    this.alertRetryAt.delete(botId);
    this.suspended.delete(botId);
    this.tokens.get(botId)?.cancel();
    this.tokens.delete(botId);
  }

  /**
   * 下线管线开头冻结（Lifecycle 在导出物品前调用）：不再发起新搬运，
   * 在途批次的重试轮经令牌阻断——封堵"已导出入库又被搬进箱"的双份窗口。
   */
  suspend(botId: number): void {
    this.suspended.add(botId);
    this.tokens.get(botId)?.cancel();
  }

  /** 每拍入口（Scheduler 对 ACTIVE/WORKING 会话调用；本方法自行节拍，同步短小 F-18） */
  tick(session: Session, record: BotRecord, now: number): void {
    const botId = session.botId;
    if (this.suspended.has(botId)) return;
    const chestId = record.workChestId;
    if (!chestId) return;
    const chest = workChests.get(chestId);
    if (!chest) {
      this.alert(botId, record, "lost", null, now);
      return;
    }
    if (this.inFlight.has(botId)) {
      this.beamIfDue(botId, chest, now);
      return;
    }
    if (now < (this.backoffUntil.get(botId) ?? 0)) return;
    if (now - (this.lastSweep.get(botId) ?? 0) < SWEEP_TICKS) return;
    this.lastSweep.set(botId, now);

    const probe = probeWorkChest(chest.dimId, chest.origin);
    if (probe.status !== "ok") {
      if (probe.status === "not-chest") this.alert(botId, record, "lost", chest, now);
      else this.backoffUntil.set(botId, now + UNREADABLE_RETRY_TICKS); // 区块未加载属瞬态：不告警不判丢
      return;
    }
    const self = mover.snapshotOf(botId);
    if (!self) return;
    const plan = planWorkTransfer(this.ops.inventoryProbes(botId), this.matcherFor(record), this.protectedIds(record));
    if (plan.length === 0) return;
    this.inFlight.add(botId);
    this.beam(botId, self.location, chest, now);
    const token = new CancelToken();
    this.tokens.set(botId, token);
    const settle = () => {
      this.inFlight.delete(botId);
      if (this.tokens.get(botId) === token) this.tokens.delete(botId);
    };
    void containerOps
      .deposit(
        botId,
        chest.dimId,
        chest.origin,
        plan.map((e) => e.slot),
        token
      )
      .then(
        (r) => {
          settle();
          this.onDone(botId, record, chest, r, now);
        },
        (e: any) => {
          settle();
          console.warn(`[mockplayer3] 工作箱搬运异常 bot=${botId}: ${e?.message ?? e}`);
        }
      );
  }

  // ─── 私有 ──

  /** 本模式工作产物判据（fishing/harvest/mine 有表；其余模式不产搬运） */
  private matcherFor(record: BotRecord): (typeId: string) => boolean {
    const mode = record.workMode;
    let rule: HarvestDropRule | null = null;
    if (mode.startsWith("harvest_")) {
      const kind = parseHarvestKind(mode.slice("harvest_".length));
      rule = kind ? specOf(kind).dropAccept : null;
    }
    return workProductMatcher(mode, this.runtime.minedOf(record.botId), rule);
  }

  /** 永不搬运名单：主手/穿戴件 typeId + 启用的信物物品 */
  private protectedIds(record: BotRecord): Set<string> {
    const out = this.ops.protectedItemTypeIds(record.botId);
    const token = this.runtime.config.tokenItem;
    if (token.enabled) out.add(token.typeId);
    return out;
  }

  /** 在途连线（同维度才画；跨维搬运照常、只是看不见线） */
  private beam(botId: number, from: { x: number; y: number; z: number }, chest: WorkChestInfo, now: number): void {
    const self = mover.snapshotOf(botId);
    if (!self || self.dimensionId !== chest.dimId) return;
    this.lastBeam.set(botId, now);
    transferBeam(
      chest.dimId,
      { x: from.x, y: from.y + 1.2, z: from.z },
      {
        x: chest.origin.x + 0.5,
        y: chest.origin.y + 0.55,
        z: chest.origin.z + 0.5,
      }
    );
  }

  /** 在途期间的按节拍重画 */
  private beamIfDue(botId: number, chest: WorkChestInfo, now: number): void {
    if (now - (this.lastBeam.get(botId) ?? 0) < BEAM_PULSE_TICKS) return;
    const inflight = mover.snapshotOf(botId);
    if (inflight) this.beam(botId, inflight.location, chest, now);
  }

  /** 搬运回执分流：搬成亮箱；有失败格按满箱告警退避；整批干净才解除故障态并发恢复通知 */
  private onDone(botId: number, record: BotRecord, chest: WorkChestInfo, r: MoveReport, now: number): void {
    if (r.moved.length > 0) {
      const cells = [chest.origin];
      const probe = probeWorkChest(chest.dimId, chest.origin);
      if (probe.status === "ok" && probe.partner) cells.push(probe.partner);
      chestInputFlash(chest.dimId, cells);
    }
    if (r.aborted || (r.moved.length === 0 && r.failed.length === 0)) return; // 瞬态中断/无结论：下拍自然重试
    if (r.failed.length > 0) {
      // 含部分搬成——箱子余量只吃得下部分批次同样按满箱口径告警（同状态去重）
      this.alert(botId, record, "full", chest, now);
      this.backoffUntil.set(botId, now + FULL_BACKOFF_TICKS);
      return;
    }
    if (this.failState.delete(botId) && record.ownerKey) {
      this.ops.notifyPlayer(record.ownerKey, `假人 ${record.name}：工作箱已恢复正常，继续搬运`);
    }
  }

  /**
   * 故障告警（状态迁移才发；同状态不重复轰炸）：送达或被个人设置明确屏蔽=状态
   * 消费；主人离线（unreachable）按 ALERT_RETRY_TICKS 重试直到确认，防止上线后查无此警。
   */
  private alert(botId: number, record: BotRecord, kind: FailKind, chest: WorkChestInfo | null, now: number): void {
    if (this.failState.get(botId) === kind) return;
    if (now < (this.alertRetryAt.get(botId) ?? 0)) return;
    const label = chest
      ? `工作箱「${chest.name || "未命名"}」(${chest.id})`
      : `绑定的工作箱(${record.workChestId ?? "?"})`;
    const text =
      kind === "lost"
        ? `${label} 已丢失（被破坏/不是普通箱子），物品将留在背包，请恢复箱子或重新绑定`
        : `${label} 已满或不可达，未搬物品留在背包`;
    const outcome = record.ownerKey
      ? this.ops.notifyPlayer(record.ownerKey, `假人 ${record.name}：${text}`, "warn")
      : ("suppressed" as const);
    // 日志只记状态迁移首试；离线重试期间静默（主人事后可见与否以私信为准）
    if (!this.alertRetryAt.has(botId))
      console.warn(`[mockplayer3] 工作箱告警 bot=${record.name}: ${text}（回执=${outcome}）`);
    if (outcome === "unreachable") this.alertRetryAt.set(botId, now + ALERT_RETRY_TICKS);
    else {
      this.failState.set(botId, kind);
      this.alertRetryAt.delete(botId);
    }
  }
}
