// ─── 定点放置能力 ──────────────────────────────────────────────────
// 定点作业：常驻节拍把主手方块放到正前方，靶面完全由玩家预设准星决定（与攻击同口径）。
// 视角绝不变化，每拍不发注视。
// 照拍重试：引擎静默拒放、准星无目标、实体瞬态、主手空手/非方块一律低频重探，补货即恢复；
// 空手或非方块时不发起放置（无可写目标），低息重探等补货。
// 例外停机：脚下位置漂移超阈值走 autoStop 落空闲，防主手方块在脚下自叠塔失控升高。
// 回读才算放置成功（常规通道射线差分、特殊通道目标格 typeId），该防线在放置原子内实现。
// 能力是全局单例、零实例字段；相位与启动位置挂 session.capability.data["place"]。

import type { Capability, LeaseRequest } from "../../domain/Capability";
import type { Session } from "../../domain/Session";
import type { Vec3 } from "../../domain/Coords";
import { distance3d, toBlockLocation } from "../../domain/Coords";
import { ACTION_HOLD_TTL_TICKS } from "../../domain/Leases";
import { IDLE_RECHECK_TICKS, PLACE_INTERVAL_TICKS } from "../../domain/MineRules";
import { placer } from "../../engine/Placer";
import { mover } from "../../engine/Mover";
import type { CapabilityHost } from "./Common";
import { ctxOf } from "./Common";

/** 放置/回读射线距离（与破坏原子同口径 6 格） */
const REACH = 6;

/** 启动后首拍醒距（tick）：生成窗引擎逐 tick 锁回旋转，先缓冲再按视角放置（F-01） */
const PLACE_SETTLE_TICKS = 8;

/** 脚下位置漂移硬闸（格）：与启动记录格偏差超过此值即停放置 */
const DRIFT_LIMIT = 1;

/** 放置私有上下文：base=启动首拍记录的脚下格（null=尚未记录） */
interface PlaceCtx {
  base: Vec3 | null;
}

/** 定点放置相位机（单相位节拍循环） */
export class PlaceCap implements Capability {
  readonly id = "place" as const;

  constructor(private readonly host?: CapabilityHost) {}

  requires(): LeaseRequest[] {
    // 不发任何注视（视角由玩家预设且恒定），只占双手
    return [{ kind: "hands" }];
  }

  start(session: Session, now: number): string | undefined {
    const cap = session.capability;
    if (!cap) return "能力上下文缺失";
    // 确认拒启（可检出）才显式失败，好过无声空转，原因由 Modes 透传给主人
    const kind = placer.mainhandKind(session.botId);
    if (kind === "empty") return "主手没有物品";
    if (kind === "not-block") return "主手不是可放置方块";
    // offline=实体/主手组件暂不可读的瞬态：拒启会把用户持久模式写穿为 none，
    // 故不拒绝——交 tick 低频重探，实体/组件就绪即自然恢复
    ctxOf<PlaceCtx>(cap.data, "place", () => ({ base: null }));
    cap.phase = { name: "LAY", nextWakeAt: now + PLACE_SETTLE_TICKS };
    return undefined;
  }

  tick(session: Session, now: number): void {
    const cap = session.capability;
    if (!cap || cap.phase.name !== "LAY") return;
    const ctx = ctxOf<PlaceCtx>(cap.data, "place", () => ({ base: null }));
    session.leases.renew("hands", this.id, now, ACTION_HOLD_TTL_TICKS);
    const loc = mover.locationOf(session.botId);
    if (!loc) {
      // 实体/位置瞬态不可读 → 低频重探
      setPhase(session, IDLE_RECHECK_TICKS, now);
      return;
    }
    if (!ctx.base) {
      // 首拍（已过启动缓冲）记录脚下格作漂移基准
      ctx.base = toBlockLocation(loc);
    } else if (distance3d(toBlockLocation(loc), ctx.base) > DRIFT_LIMIT) {
      setPhase(session, IDLE_RECHECK_TICKS, now);
      this.host?.autoStop(session.botId, "脚下位置漂移，已停止放置");
      return;
    }
    // 视角零改动：非方块主手不发起放置（无可写目标，直写会把非方块 typeId 当方块）
    const kind = placer.mainhandKind(session.botId);
    if (kind !== "block") {
      setPhase(session, IDLE_RECHECK_TICKS, now);
      return;
    }
    const result = placer.placeInFront(session.botId, REACH);
    switch (result) {
      case "no-target":
      case "offline":
        // 准星无目标/实体瞬态 → 低频重探
        setPhase(session, IDLE_RECHECK_TICKS, now);
        break;
      default:
        // placed/unchanged 照连放节拍重试；unchanged=引擎静默拒
        setPhase(session, PLACE_INTERVAL_TICKS, now);
    }
  }

  stop(_session: Session, _now: number): void {
    // 放置为同步瞬时调用（常规通道 startBuild/stopBuild 一拍落块、特殊通道 setBlockType 直写），无在途可取消
  }
}

// ─── 模块内小件 ──

function setPhase(session: Session, wakeDelay: number, now: number): void {
  const cap = session.capability;
  if (cap) cap.phase = { name: "LAY", nextWakeAt: now + wakeDelay };
}
