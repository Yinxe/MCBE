// ─── 跟随能力 ──────────────────────────────────────────────────────
// 机械距离带模型：按节拍重发导航，近距停走，超距/跨维即断关系。
// 假人实体瞬断（死亡窗口/换实体尾）不断关系只等待；目标连续数拍解析不到才断关系。
// 投掷期挂起：急停在途导航，关系与相位保留。
// 眼随主而转：停走与行走时均持续注视目标头部高度。
// 能力是全局单例、零实例字段，状态挂 capability.data。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import { distance3d } from "../../domain/Coords";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { FOLLOW_TICK, classifyFollowGap } from "../../domain/FollowRules";
import type { EntityOps } from "../../engine/EntityOps";
import { gaze } from "../../engine/Gaze";
import { mover } from "../../engine/Mover";
import { tridentOps } from "../../engine/TridentOps";
import type { Runtime } from "../Runtime";
import { ctxOf } from "./Common";
import type { CapabilityHost } from "./Common";

/** 目标连续解析不到的拍数上限（FOLLOW_TICK 节拍，约 30 tick）；达到才解除关系 */
const FOLLOW_MISS_LIMIT = 3;

/** capability.data 私有状态 */
interface FollowCtx {
  /** 本会话内连续解析不到目标的拍数；解析成功即归零 */
  missCount: number;
}

/** 跟随相位机（单相位 WATCH：节拍重判距离带） */
export class FollowCap implements Capability {
  readonly id = "follow" as const;

  constructor(
    private readonly runtime: Runtime,
    private readonly ops: EntityOps,
    private readonly host: CapabilityHost
  ) {}

  requires(): LeaseRequest[] {
    return [{ kind: "motion" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    const record = this.runtime.record(session.botId);
    if (!record?.followTarget) return "未指定跟随目标";
    cap.phase = { name: "WATCH", nextWakeAt: now };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap) return;
    const record = this.runtime.record(session.botId);
    if (!record) {
      // 会话在而记录缺失：等下拍记录恢复或会话拆除收敛，不逐拍空转
      setWake(session, FOLLOW_TICK, now);
      return;
    }
    if (!record.followTarget) {
      this.host.autoStop(session.botId, "跟随目标已解除");
      return;
    }
    session.leases.renew("motion", this.id, now, ACTION_HOLD_TTL_TICKS);

    // 投掷期挂起：急停在途导航（可能正走长路径），不重发不判距，关系与相位保留
    if (tridentOps.isThrowing(session.botId)) {
      mover.stop(session.botId);
      setWake(session, FOLLOW_TICK, now);
      return;
    }

    const self = mover.snapshotOf(session.botId);
    if (!self) {
      // 假人实体瞬断：关系保留，只等待重探
      setWake(session, FOLLOW_TICK, now);
      return;
    }
    const ctx = ctxOf(cap.data, "follow", () => ({ missCount: 0 }) as FollowCtx);
    const target = this.ops.playerProbe(record.followTarget);
    if (!target) {
      // undefined 含两种来源：目标真离线、换维窗口等瞬态解析失败，无法当场区分
      // 先每拍 stopMoving 原地等，保持跟随关系；连续达到 FOLLOW_MISS_LIMIT 拍才解除关系并停机
      ctx.missCount++;
      if (ctx.missCount < FOLLOW_MISS_LIMIT) {
        mover.stop(session.botId);
        setWake(session, FOLLOW_TICK, now);
        return;
      }
      mover.stop(session.botId);
      this.host.releaseFollow(session.botId);
      this.host.autoStop(session.botId, "跟随目标已离线，停止跟随");
      return;
    }
    ctx.missCount = 0;

    const verdict =
      target.dimensionId !== self.dimensionId
        ? ("crossdim" as const)
        : classifyFollowGap(distance3d(self.location, target.location));

    // 眼随主而转：stop/walk 带持续注视目标头部高度；release/跨维分支注视无意义，判向后再发
    if (verdict === "stop" || verdict === "walk") {
      gaze.forceLook(session.botId, { x: target.location.x, y: target.location.y + 1.6, z: target.location.z });
    }

    switch (verdict) {
      case "stop":
        mover.stop(session.botId); // 停走带每拍幂等清导航残留
        break;
      case "walk":
        mover.repath(session.botId, target.location); // 失败静默，下拍重发
        break;
      case "release":
        mover.stop(session.botId);
        this.host.releaseFollow(session.botId);
        this.host.autoStop(session.botId, "距离目标过远，停止跟随");
        return;
      default: {
        mover.stop(session.botId);
        this.host.releaseFollow(session.botId);
        this.host.autoStop(session.botId, "跟随目标不在同一维度，停止跟随");
        return;
      }
    }
    setWake(session, FOLLOW_TICK, now);
  }

  stop(session: Session, _now: number): void {
    // 幂等清场：急停清导航残留；注视甩向身体朝向远处，不回看旧目标（F-06 中性化）
    mover.stop(session.botId);
    gaze.stopHold(session.botId);
  }
}

function setWake(session: Session, delay: number, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name: "WATCH", nextWakeAt: now + delay };
}
