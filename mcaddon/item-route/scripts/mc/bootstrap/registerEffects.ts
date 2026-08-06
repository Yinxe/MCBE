// ─── 效果装配：SortEffects / BoundaryDisplay / WarningRelay / NotifyRelay 统一注册 ──
// 从组合根抽出的"视觉/播报效果"装配点：定位器（维度/容器反查）在此定义，
// 只依赖 `loaded`（Phase 4 填充的运行时仓库表，闭包实时读）。main.ts 只调一次。
import { world } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import type { Warehouse } from "../../core/model/Warehouse";
import { registerSortEffects } from "../effects/SortEffects";
import { registerBoundaryDisplay } from "../effects/BoundaryDisplay";
import { registerWarningRelay } from "../effects/WarningRelay";
import { registerNotifyRelay } from "../effects/NotifyRelay";

/**
 * 注册全部视觉效果与播报订阅（路由闪光 / 临时边界 / 容量预警 / 成员通知）。
 * 定位器经 `loaded` 反查仓库/容器（不持核心对象引用，保持薄订阅者）。
 * @param bus    - 领域事件总线
 * @param loaded - 运行时仓库表（Phase 4 填充；闭包实时读，激活/卸载即时生效）
 */
export function registerRenderEffects(bus: EventBus, loaded: Warehouse[]): void {
  // 路由闪光 / 搜索标记：维度 + 命中容器（坐标/角色/方块类型 → 角色颜色粒子 + 尺寸）
  registerSortEffects(bus, {
    dimensionOf: (whId) => {
      const w = loaded.find((x) => x.id === whId);
      return w === undefined ? undefined : world.getDimension(w.area.dimension);
    },
    targetOf: (containerId) => {
      for (const w of loaded) {
        const c = w.containers.get(containerId);
        if (c !== undefined && c.occupiedLocations.length > 0) {
          return {
            occupiedLocations: c.occupiedLocations,
            role: c.role,
            blockType: (c as { blockType?: string }).blockType ?? "",
          };
        }
      }
      return undefined;
    },
  });

  // 临时边界（建仓/调整区域后 boundary-glow）
  registerBoundaryDisplay(bus, (whId) => {
    const w = loaded.find((x) => x.id === whId);
    return w === undefined ? undefined : { dimensionId: w.area.dimension, area: w.area };
  });

  // 容量预警 / 成员通知（都只需仓库解析）
  registerWarningRelay(bus, () => loaded);
  registerNotifyRelay(bus, () => loaded);
}
