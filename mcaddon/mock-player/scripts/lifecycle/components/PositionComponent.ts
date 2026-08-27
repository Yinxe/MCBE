// ─── 位置追踪组件（生命周期内聚） ──────────
// 职责：订阅 botMoved → 更新 lastPoint + silent 持久化，阈值控频
// 原逻辑在 features/basic/PositionTracker.ts，现收敛于生命周期。

import { BotEvents } from "../../events/DomainEvents";
import { distance3d } from "../../features/utils";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";

const POSITION_UPDATE_DISTANCE = 2;

export class PositionComponent implements LifecycleComponent {
  readonly id = "position";
  readonly priority = 70;

  private ctx!: LifecycleContext;
  private off?: () => void;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;
    this.off = BotEvents.botMoved.subscribe((event) => {
      try {
        const record = this.ctx.registry.get(event.botName);
        if (!record) return;
        const last = record.lastPoint;
        // 距离阈值控频
        if (last) {
          const dx = last.location.x - event.position.x;
          const dy = last.location.y - event.position.y;
          const dz = last.location.z - event.position.z;
          // 使用 distance3d 工具（若不可用则手算）
          let dist: number;
          try { dist = distance3d(last.location as any, event.position as any); } catch { dist = Math.hypot(dx, dy, dz); }
          if (dist < POSITION_UPDATE_DISTANCE) return;
        }
        record.lastPoint = {
          location: event.position,
          dimension: event.dimension,
          rotation: event.rotation,
          lookTarget: last?.lookTarget ?? record.respawnPoint.lookTarget,
        };
        this.ctx.save.saveRecord(record, true);
      } catch (e: any){ console.warn(`[Position] 更新失败 ${event.botName}: ${e?.message ?? e}`); }
    });
    console.info(`[Position] 已订阅 botMoved（阈值 ${POSITION_UPDATE_DISTANCE} 格，生命周期内聚）`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    if (this.off) try { this.off(); } catch {}
    this.off = undefined;
  }
}
