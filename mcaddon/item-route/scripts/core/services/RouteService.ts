// ─── 路由服务：全局开关/单仓速度/容器开关 ─────────────────
import type { Scheduler } from "../scheduling/Scheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId } from "../model/types";

export class RouteService {
  constructor(private readonly scheduler: Scheduler) {}

  setGlobalEnabled(enabled: boolean): void {
    this.scheduler.setGlobalEnabled(enabled);
  }

  /** 设置单仓处理速度（tick 间隔），会被全局限制 clamp */
  setProcessingSpeed(warehouseId: string, speed: number): void {
    this.scheduler.setProcessingSpeed(warehouseId, speed);
  }

  setContainerEnabled(warehouse: Warehouse, containerId: ContainerId, enabled: boolean): void {
    const container = warehouse.containers.get(containerId);
    if (container) container.enabled = enabled;
  }
}