// ─── 路由服务：全局开关/单仓速度/容器开关 ─────────────────
// 对调度器的薄门面，供命令/UI（OPConfigUI 全局开关、settings 速度）调用，
// 避免外部直接触达 Scheduler 内部细节。不改索引/统计（路由副作用由领域事件驱动）。
import type { Scheduler } from "../scheduling/Scheduler";
import type { Warehouse } from "../model/Warehouse";
import type { ContainerId } from "../model/types";
import { refreshInputMembership } from "../model/ContainerRegistry";

/** 路由调度门面：把命令/UI 的路由配置操作转发给 Scheduler，并维护容器启用 → inputs 镜像 */
export class RouteService {
  constructor(private readonly scheduler: Scheduler) {}

  /** 全局分拣开关（false 停全部仓库路由） */
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

  /** 容器启用开关：改内存 + 刷新 inputs 成员资格（输入容器禁/启 → 进出 inputs 镜像） */
  setContainerEnabled(warehouse: Warehouse, containerId: ContainerId, enabled: boolean): void {
    const container = warehouse.containers.get(containerId);
    if (container) {
      container.enabled = enabled;
      refreshInputMembership(warehouse, container);
    }
  }
}
