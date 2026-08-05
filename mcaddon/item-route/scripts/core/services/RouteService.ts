// ─── 路由服务：全局开关/单仓速度/容器开关 ─────────────────
// 对调度器的薄门面，供命令/UI（ConfigUI 全局开关、settings 速度）调用，
// 避免外部直接触达 Scheduler 内部细节。
import type { Scheduler } from "../scheduling/Scheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId } from "../model/types";
import { refreshInputMembership } from "../model/ContainerRegistry";

export class RouteService {
  constructor(private readonly scheduler: Scheduler) {}

  setGlobalEnabled(enabled: boolean): void {
    this.scheduler.setGlobalEnabled(enabled);
  }

  /** 设置全局速度上限（clamp 生效），并让已激活仓库立即按新上限重建 interval */
  setGlobalSpeedLimit(limit: number): void {
    this.scheduler.setGlobalSpeedLimit(limit);
  }

  /** 设置单仓处理速度（tick 间隔），会被全局限制 clamp */
  setProcessingSpeed(warehouseId: string, speed: number): void {
    this.scheduler.setProcessingSpeed(warehouseId, speed);
  }

  setContainerEnabled(warehouse: Warehouse, containerId: ContainerId, enabled: boolean): void {
    const container = warehouse.containers.get(containerId);
    if (container) {
      container.enabled = enabled;
      // 启用开关影响 inputs 成员资格（输入容器禁/启 → 进出 inputs 镜像）
      refreshInputMembership(warehouse, container);
    }
  }
}