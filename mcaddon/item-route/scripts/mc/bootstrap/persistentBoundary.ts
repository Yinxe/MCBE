// ─── 持久边界控制：showBoundary 设置 → 粒子光幕启停 + 生命周期 ──
// 从组合根抽出的"持久边界"装配点。三件事（审查）：
//   · `guard(wh)`——**附近玩家持信物才绘制**（v1 BoundaryDisplay requireHoe 口径）：
//     同维度 + isPlayerNearby(margin=8) + config.isToken(手持). 放 draw 时实时判定，
//     无玩家持信物在场则不撒粒子（省资源，持信物接近后自动恢复）。
//   · `boundaryControl`（进 deps.boundary）——WarehouseSettingsMenu 按 showBoundary 开关调用。
//   · 生命周期订阅——删仓停；resize 迁移后按新区域重启（showBoundary 开启时）。
import { world } from "@minecraft/server";
import type { EventBus } from "../../core/events/DomainEvents";
import { isPlayerNearby } from "../../core/model/Area";
import type { Warehouse } from "../../core/model/Warehouse";
import type { McModConfig } from "../storage/McModConfig";
import type { BoundaryControl } from "../commands/deps";
import { startPersistentBoundary, stopBoundary, PROXIMITY_MARGIN } from "../effects/BoundaryDisplay";

/** 装配依赖：领域总线 + 全局配置（信物判定）+ 运行时仓库表（resize 重启用） */
export interface PersistentBoundaryDeps {
  bus: EventBus;
  config: McModConfig;
  loaded: Warehouse[];
}

/**
 * 装配持久边界控制：返回 `BoundaryControl`（菜单 save 后调 setEnabled 启停），
 * 并注册仓库生命周期订阅（删仓停 / resize 按新区域重启）。
 */
export function setupPersistentBoundaryControl({ bus, config, loaded }: PersistentBoundaryDeps): BoundaryControl {
  // 附近玩家持信物守卫（v1 BoundaryDisplay requireHoe 口径）
  const guard =
    (wh: Warehouse): (() => boolean) =>
    () => {
      for (const p of world.getAllPlayers()) {
        if (p.dimension.id !== wh.area.dimension) continue;
        let holdingToken = false;
        try {
          const held = p.getComponent("inventory")?.container?.getItem(p.selectedSlotIndex);
          holdingToken = config.isToken(held?.typeId ?? "");
        } catch {
          /* 读取失败视为未持信物 */
        }
        if (!holdingToken) continue;
        if (
          isPlayerNearby(wh.area, [{ dimension: p.dimension.id, x: p.location.x, z: p.location.z }], PROXIMITY_MARGIN)
        ) {
          return true;
        }
      }
      return false;
    };

  const boundary: BoundaryControl = {
    setEnabled: (wh: Warehouse, enabled: boolean): void => {
      if (enabled) startPersistentBoundary(wh.id, { dimensionId: wh.area.dimension, area: wh.area }, guard(wh));
      else stopBoundary(wh.id);
    },
  };

  // 生命周期：删仓停；resize 迁移后按新区域重启（showBoundary 开启时）
  bus.warehouseDeleted.subscribe((e) => stopBoundary(e.warehouseId));
  bus.warehouseAreaChanged.subscribe((e) => {
    if (e.oldId !== undefined) stopBoundary(e.oldId);
    const wh = loaded.find((w) => w.id === e.warehouseId);
    if (wh !== undefined && wh.settings.showBoundary) boundary.setEnabled(wh, true);
  });

  return boundary;
}
