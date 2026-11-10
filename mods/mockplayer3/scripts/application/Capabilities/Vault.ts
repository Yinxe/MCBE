// ─── 自动宝库能力 ──────────────────────────────────────────────────
// 派发→感知选目标→寻路→开箱循环：优先不详宝库，跳过封锁位。
// 开箱成功即系统重连，目标跨会话保留，上线自动续开同一宝库。
// 点击返回成功但钥匙没消耗时，先重新寻路换正面站位，仍连败才封锁该位换目标；
// 寻路失败封锁该位换点，不对同一点死磕。
// 能力是全局单例、零实例字段：会话级状态挂 data["vault"]，
// 跨会话状态挂 Runtime.vaultState（仅删假人时清除）。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import { GAZE_HOLD_TTL_TICKS, ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { CancelToken } from "../../domain/Cancellation";
import { distance3d } from "../../domain/Coords";
import type { VaultFlowState } from "../../domain/VaultRules";
import {
  OMINOUS_TRIAL_KEY,
  TRIAL_KEY,
  diagnoseVaultIdle,
  selectVaultTarget,
  vaultBlockKey,
  withinVaultSightDistance,
} from "../../domain/VaultRules";
import { blockCenter } from "../../engine/Atomic";
import { vaultInSight, vaultInteract, vaultNavigate, vaultSense } from "../../engine/TrialVaultOps";
import { gaze } from "../../engine/Gaze";
import { mover } from "../../engine/Mover";
import type { EntityOps } from "../../engine/EntityOps";
import type { Runtime } from "../Runtime";
import { ctxOf } from "./Common";

type VaultPhase = "INIT" | "DISPATCH" | "SCAN" | "NAVIGATE" | "INTERACT" | "RECONNECT";

/** 感知失败/无目标重扫冷却 */
const VAULT_SCAN_COOLDOWN_TICKS = 40;
/** 交互尝试冷却 */
const VAULT_INTERACT_COOLDOWN_TICKS = 20;
/** 到达判定（格；三维直线距，垂直落差计入，与可视直交判定同口径） */
const VAULT_ARRIVE_DISTANCE = 2;
/** 点击未消耗的升级阈值：连续 3 次重新寻路换站位，6 次封锁该位换目标 */
const VAULT_MISS_ESCALATE = 3;
/** 节流通知窗（全消息共窗） */
const VAULT_NOTIFY_COOLDOWN_TICKS = 200;
/** 实体不可读重探 */
const VAULT_UNREAD_TICKS = 20;
/** RECONNECT 心跳（< ACTION_HOLD_TTL 保证租约不断） */
const VAULT_RECONNECT_POLL_TICKS = 50;
/** 系统重连预算（下线+20t+上线 ≈40t；超时说明重连半途失败 → 回 INTERACT 继续点） */
const VAULT_RECONNECT_BUDGET_TICKS = 120;
/** NAVIGATE 在途轮询醒距（心跳续租 + 结果收割） */
const VAULT_NAV_POLL_TICKS = 20;

/** 钥匙中文名（缺钥匙通知用） */
const KEY_LABELS: Record<string, string> = {
  [TRIAL_KEY]: "普通钥匙",
  [OMINOUS_TRIAL_KEY]: "不详钥匙",
};

interface VaultCtx {
  /** 寻路协程槽位（F-18：协程只写纯结果回 result） */
  nav: { token: CancelToken | null; result: boolean | null };
}

/** 自动宝库行为（record.workMode=vault） */
export class VaultCap implements Capability {
  readonly id = "vault" as const;

  constructor(
    private readonly runtime: Runtime,
    private readonly ops: EntityOps,
    /** 开箱成功后的系统重连出口（装配层接 Lifecycle.systemReconnect） */
    private readonly reconnect: (botId: number) => void
  ) {}

  requires(): LeaseRequest[] {
    return [{ kind: "gaze", mode: "HOLD" }, { kind: "hands" }, { kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    ctxOf(cap.data, "vault", () => ({ nav: { token: null, result: null } }) as VaultCtx);
    // 重连落地（新会话起点）：等待标记与发起标记归零；目标存在 Runtime，不随会话销毁
    const st = this.runtime.vaultState(session.botId);
    st.reconnectAt = 0;
    st.reconnectIssued = false;
    cap.phase = { name: "INIT", nextWakeAt: now };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    const ctx = cap?.data["vault"] as VaultCtx | undefined;
    if (!cap || !ctx) return;
    if (this.runtime.record(session.botId) === undefined) return; // 记录已移除：停摆（管线收会话）
    session.leases.renew("gaze", this.id, now, GAZE_HOLD_TTL_TICKS);
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    const st = this.runtime.vaultState(session.botId);
    switch (cap.phase.name as VaultPhase) {
      case "INIT":
        setPhase(session, 0, "DISPATCH", now);
        break;
      case "DISPATCH":
        this.dispatch(session, st, ctx, now);
        break;
      case "SCAN":
        this.scan(session, st, ctx, now);
        break;
      case "NAVIGATE":
        this.harvestNav(session, st, ctx, now);
        break;
      case "INTERACT":
        this.interact(session, st, ctx, now);
        break;
      case "RECONNECT":
        if (now >= st.reconnectAt + VAULT_RECONNECT_BUDGET_TICKS) {
          // 重连半途失败（会话仍在）：先清发起标记再回开箱节拍；
          // 若该次重连实际仍排着队，稍后落地由新会话 start 再清一次（幂等）
          st.reconnectAt = 0;
          st.reconnectIssued = false;
          setPhase(session, 0, "INTERACT", now);
        } else {
          setPhase(session, VAULT_RECONNECT_POLL_TICKS, "RECONNECT", now);
        }
        break;
    }
  }

  stop(session: Session, _now: number): void {
    // 幂等清场：中断寻路协程 + 急停 + 注视中性化。跨会话目标不在此清——系统重连也走 stop，
    // 目标必须存活到重连上线；清目标只发生在 target-gone/寻路失败/删假人。
    const ctx = session.capability?.data["vault"] as VaultCtx | undefined;
    if (!ctx) return;
    ctx.nav.token?.cancel();
    ctx.nav = { token: null, result: null };
    mover.stop(session.botId);
    gaze.stopHold(session.botId);
  }

  // ─── DISPATCH：有目标就近/远分流，无目标进感知 ──

  private dispatch(session: Session, st: VaultFlowState, ctx: VaultCtx, now: number): void {
    const loc = mover.locationOf(session.botId);
    if (!loc) {
      setPhase(session, VAULT_UNREAD_TICKS, "DISPATCH", now); // 实体瞬态不可读：短等再探
      return;
    }
    if (!st.target) {
      setPhase(session, 0, "SCAN", now);
      return;
    }
    this.approach(session, st, ctx, now, loc);
  }

  /** 近 → INTERACT；远 → 零注视寻路（注视是开箱时动作，导航期撤销防干扰） */
  private approach(
    session: Session,
    st: VaultFlowState,
    ctx: VaultCtx,
    now: number,
    loc: { x: number; y: number; z: number }
  ): void {
    if (!st.target) return;
    if (distance3d(loc, st.target) <= VAULT_ARRIVE_DISTANCE) {
      setPhase(session, 0, "INTERACT", now);
      return;
    }
    // 已在 sight 距离内且射线命中宝库格则免寻路直接交互；否则（背对/被挡/落差大）照常导航
    if (withinVaultSightDistance(loc, st.target) && vaultInSight(session.botId, st.target)) {
      setPhase(session, 0, "INTERACT", now);
      return;
    }
    gaze.stopHold(session.botId);
    this.startNav(session, ctx, now, st.target);
  }

  // ─── SCAN：感知 + 选目标（优先不详宝库、近→远跳过导航封锁位）；选不出 → 诊断通知 + 40t 重扫 ──

  private scan(session: Session, st: VaultFlowState, ctx: VaultCtx, now: number): void {
    const knowledge = vaultSense(session.botId);
    if (!knowledge) {
      setPhase(session, VAULT_UNREAD_TICKS, "SCAN", now);
      return;
    }
    // 重选目标轮开始：点击未消耗的连败计数归零
    st.missStreak = 0;
    const sel = selectVaultTarget(knowledge, st.blocked);
    if (!sel) {
      st.target = undefined;
      st.targetKind = undefined;
      st.targetKey = undefined;
      if (Object.keys(st.blocked).length > 0) {
        // 附近宝库全被封锁：整表自解下轮重轮询，死磕位由重扫冷却隔开
        st.blocked = {};
        setPhase(session, VAULT_SCAN_COOLDOWN_TICKS, "SCAN", now);
        return;
      }
      const reason = diagnoseVaultIdle(knowledge) ?? "no-key";
      this.sayThrottled(session, st, now, IDLE_MESSAGES[reason]);
      setPhase(session, VAULT_SCAN_COOLDOWN_TICKS, "SCAN", now);
      return;
    }
    st.target = sel.target;
    st.targetKind = sel.kind;
    st.targetKey = sel.key;
    this.approach(session, st, ctx, now, knowledge.position);
  }

  // ─── NAVIGATE：协程发起 + 轮询收割 ──

  private startNav(session: Session, ctx: VaultCtx, now: number, target: { x: number; y: number; z: number }): void {
    const token = new CancelToken();
    ctx.nav = { token, result: null };
    vaultNavigate(session.botId, target, token)
      .then((ok) => {
        // 续体纪律（F-18）：只写纯结果；会话亡后写入孤立 ctx 无害
        ctx.nav.result = ok;
      })
      .catch((e: any) => {
        ctx.nav.result = false;
        console.warn(`[mockplayer3] 宝库寻路异常 bot=${session.botId}: ${e?.message ?? e}`);
      });
    setPhase(session, VAULT_NAV_POLL_TICKS, "NAVIGATE", now);
  }

  private harvestNav(session: Session, st: VaultFlowState, ctx: VaultCtx, now: number): void {
    if (ctx.nav.result === null) {
      setPhase(session, VAULT_NAV_POLL_TICKS, "NAVIGATE", now); // 在途（心跳续租在 tick 头）
      return;
    }
    const ok = ctx.nav.result;
    ctx.nav = { token: null, result: null };
    if (ok) {
      setPhase(session, 0, "INTERACT", now);
      return;
    }
    // 寻路失败（目标被拆/无可站位）：封锁该宝库位（同批改由次近的可达者接手）+ 清目标重扫
    const self = mover.snapshotOf(session.botId);
    if (st.target) st.blocked = { ...st.blocked, [vaultBlockKey(st.target, self?.dimensionId)]: "" };
    st.target = undefined;
    st.targetKind = undefined;
    st.targetKey = undefined;
    setPhase(session, VAULT_SCAN_COOLDOWN_TICKS, "SCAN", now);
  }

  // ─── INTERACT：冷却门 + 开箱回读验证分流 ──

  private interact(session: Session, st: VaultFlowState, ctx: VaultCtx, now: number): void {
    if (st.reconnectAt > 0) {
      // 重连等待期绝不二次交互（防多消耗钥匙）
      setPhase(session, VAULT_RECONNECT_POLL_TICKS, "RECONNECT", now);
      return;
    }
    const wait = st.lastInteractAt + VAULT_INTERACT_COOLDOWN_TICKS - now;
    if (wait > 0) {
      setPhase(session, wait, "INTERACT", now);
      return;
    }
    st.lastInteractAt = now;
    const record = this.runtime.record(session.botId);
    const self = mover.snapshotOf(session.botId);
    const target = st.target;
    const keyType = st.targetKey;
    if (!record || !self || !target || !keyType) {
      setPhase(session, 0, "DISPATCH", now);
      return;
    }
    // 持续注视宝库中心（HOLD 租约周期重注，F-06）；维度取实体当下真值——
    // record.dimensionId 是下线/设家点快照，错维会取到别的世界的方块
    const center = blockCenter(self.dimensionId, target) ?? { x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    gaze.startHold(session.botId, center);
    const out = vaultInteract(session.botId, target, keyType);
    switch (out.result) {
      case "consumed":
        // 真消耗：立即播报剩余（不设节流）+ 系统重连——目标保留，上线续开同一宝库
        st.missStreak = 0;
        this.bcast(session, now, `开箱成功！剩余 ${out.remaining} 把钥匙，下线重连继续`);
        if (!st.reconnectIssued) {
          // 发起置标记：仅重连落地（新会话 start）或等待超时后清除，防积压窗口二次投递双重下线
          st.reconnectIssued = true;
          st.reconnectAt = now;
          this.reconnect(session.botId);
        }
        setPhase(session, VAULT_RECONNECT_POLL_TICKS, "RECONNECT", now);
        break;
      case "not-consumed": {
        st.missStreak++;
        if (st.missStreak >= VAULT_MISS_ESCALATE * 2) {
          // 换过站位仍连续点不扣：按站位不可用封锁该宝库位，清目标换点（扫描冷却后重选）
          this.sayThrottled(session, st, now, "该宝库多次开箱未扣钥匙，封锁该宝库并更换目标");
          st.blocked = { ...st.blocked, [vaultBlockKey(target, self.dimensionId)]: "" };
          st.missStreak = 0;
          st.target = undefined;
          st.targetKind = undefined;
          st.targetKey = undefined;
          gaze.stopHold(session.botId);
          setPhase(session, VAULT_SCAN_COOLDOWN_TICKS, "SCAN", now);
          break;
        }
        if (st.missStreak >= VAULT_MISS_ESCALATE) {
          // 连续点不扣：疑似站位偏侧/偏高，重新寻路到正面站位候选（不封锁、不换库）
          this.sayThrottled(session, st, now, "开箱多次未扣钥匙，重新寻路调整站位");
          gaze.stopHold(session.botId);
          this.startNav(session, ctx, now, target);
          break;
        }
        // 点击成功但钥匙未消耗（宝库冷却/出掉落动画）：冷却后继续点击
        setPhase(session, VAULT_INTERACT_COOLDOWN_TICKS, "INTERACT", now);
        break;
      }
      case "no-key":
        this.sayThrottled(session, st, now, `背包没有${KEY_LABELS[keyType] ?? keyType}，请放入背包后重试`);
        setPhase(session, VAULT_INTERACT_COOLDOWN_TICKS, "INTERACT", now);
        break;
      case "failed":
        this.sayThrottled(session, st, now, "使用钥匙开宝库未成功，请调整假人位置后重试");
        setPhase(session, VAULT_INTERACT_COOLDOWN_TICKS, "INTERACT", now);
        break;
      case "target-gone":
        this.sayThrottled(session, st, now, "目标宝库已不存在，重新搜索附近宝库");
        delete st.blocked[vaultBlockKey(target, self.dimensionId)]; // 方块已没了，封锁位随之作废
        st.target = undefined;
        st.targetKind = undefined;
        st.targetKey = undefined;
        gaze.stopHold(session.botId);
        setPhase(session, VAULT_SCAN_COOLDOWN_TICKS, "SCAN", now);
        break;
    }
  }

  // ─── 播报（[模拟玩家][宝库] 前缀、同维度最近真人，节流窗全消息共窗） ──

  private sayThrottled(session: Session, st: VaultFlowState, now: number, detail: string): void {
    if (now < st.notifyAt) return;
    st.notifyAt = now + VAULT_NOTIFY_COOLDOWN_TICKS;
    this.bcast(session, now, detail);
  }

  private bcast(session: Session, _now: number, detail: string): void {
    const record = this.runtime.record(session.botId);
    const self = mover.snapshotOf(session.botId);
    if (!record || !self) return;
    // 播报按当下维度找最近真人（record.dimensionId 可能是旧维快照）
    this.ops.notifyNearestRealPlayer(self.dimensionId, self.location, `[模拟玩家][宝库] ${record.name} ${detail}`);
  }
}

/** 缺因文案 */
const IDLE_MESSAGES: Record<"no-key" | "no-vault" | "no-ominous-key" | "no-trial-key", string> = {
  "no-key": "背包没有宝库钥匙（普通/不详），请放入钥匙",
  "no-vault": "附近 15 格内没有宝库，请将假人带到宝库附近",
  "no-ominous-key": "附近只有不详宝库，背包没有不详钥匙（普通钥匙无法开不详宝库）",
  "no-trial-key": "背包没有普通钥匙（普通宝库只能使用普通钥匙），请放入普通钥匙",
};

function setPhase(session: Session, wakeDelay: number, name: VaultPhase, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name, nextWakeAt: now + wakeDelay };
}
