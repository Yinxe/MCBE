// ─── 定点攻击能力 ──────────────────────────────────────────────────
// 定点三件套（挖掘/放置/攻击）之一：不移动、不改视角，机械重复挥击。
// 引擎自判命中归属；零注视请求。
// 实体瞬态丢失时低频重试，不清能力；耐久换械归 ToolGuard 全局守护。
// 能力是全局单例、零实例字段，相位即全部状态。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { ATTACK_INTERVAL_TICKS, IDLE_RECHECK_TICKS } from "../../domain/MineRules";
import { attacker } from "../../engine/Attacker";

/** 定点攻击相位机（单相位节拍循环） */
export class AttackCap implements Capability {
  readonly id = "attack" as const;

  requires(): LeaseRequest[] {
    // 零注视：只挥不瞄；motion 占位防走位类能力互踩（本能力不导航）
    return [{ kind: "hands" }, { kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    cap.phase = { name: "STRIKE", nextWakeAt: now };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap || cap.phase.name !== "STRIKE") return;
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);
    const result = attacker.swing(session.botId);
    // offline 低频重探；fired/idle 连点节拍
    setPhase(session, result === "offline" ? IDLE_RECHECK_TICKS : ATTACK_INTERVAL_TICKS, now);
  }

  stop(_session: Session, _now: number): void {
    // 挥击为同步瞬时调用，无在途任务可取消；视角从未被书写无需中性化
  }
}

// ─── 模块内小件 ──

function setPhase(session: Session, wakeDelay: number, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name: "STRIKE", nextWakeAt: now + wakeDelay };
}
