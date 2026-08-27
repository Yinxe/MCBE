// DEPRECATED: 已内聚至 lifecycle/components/PositionComponent，worldLoad 不再单独调用 initPositionTracker，外部订阅已集中管理。

// ─── 位置追踪（mc 层，事件订阅落库） ─────────────────────
// 订阅 botMoved 领域事件 → 更新假人位置数据（record.lastPoint）+ 持久化。
// **解耦约定**：导航模块（features/basic/move）只在监测到位置变化时发布
// botMoved 事件，不直接依赖持久化；位置落库由本订阅方负责——
//   move（发布）→ botMoved → PositionTracker（订阅）→ lastPoint + saveRecord
// 阈值控频：移动距离 < POSITION_UPDATE_DISTANCE 不写（避免每 10 tick 写 NBT）。

import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { distance3d } from "../utils";

/** 位置数据更新阈值（格）：移动距离超过此值才写 record + 持久化（控制写入频率） */
const POSITION_UPDATE_DISTANCE = 2;

/** 初始化幂等守卫（main.ts worldLoad 调用一次；防重复订阅） */
let positionTrackerReady = false;

/**
 * 初始化位置追踪（幂等；main.ts worldLoad 后调用）。
 * 订阅假人移动事件：更新 lastPoint（位置/维度/朝向）+ 持久化
 * （silent：高频移动更新防刷日志；距离阈值控频）。
 */
export function initPositionTracker(): void {
  if (positionTrackerReady) return;
  positionTrackerReady = true;
  BotEvents.botMoved.subscribe((event) => {
    try {
      const record = botRegistry.get(event.botName);
      if (!record) return;
      const last = record.lastPoint;
      // 移动距离未超阈值 → 跳过（避免每 10 tick 写一次 NBT）
      if (last && distance3d(last.location, event.position) < POSITION_UPDATE_DISTANCE) return;
      record.lastPoint = {
        location: event.position,
        dimension: event.dimension,
        rotation: event.rotation,
        lookTarget: last?.lookTarget ?? record.respawnPoint.lookTarget,
      };
      saveCoordinator.saveRecord(record, true); // silent：高频移动更新防刷日志
    } catch (e: any) {
      console.warn(`[MockPlayer] PositionTracker 更新失败 ${event.botName}: ${e?.message ?? e}`);
    }
  });
}