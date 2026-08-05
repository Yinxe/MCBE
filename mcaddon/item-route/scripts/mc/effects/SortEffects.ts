// ─── 视觉反馈：路由闪光/存入效果（角色颜色粒子） ─────────────
// 订阅领域事件 `visualEffect`（route-flash/particle）→ 在命中容器坐标播放粒子。
// 关键约束（v1「无玩家在场不播放」）：先检查维度内 `getPlayers().length === 0`
// 则跳过——避免玩家不在场时空耗粒子。
// 坐标解析经注入的 EffectLocator（装配层以 loaded warehouses 反查），本模块不持
// 仓库引用，保持薄订阅者角色。RP 粒子 identifier：itemroute:sort / itemroute:deposit。
import { type Dimension } from "@minecraft/server";
import type { EventBus, VisualEffectEvent } from "../../core/events/DomainEvents";
import type { ContainerRole } from "../../core/model/Container";

/** 角色 → 粒子类型（v1 同款色值） */
export const ROLE_COLOR: Record<ContainerRole, string> = {
  input: "minecraft:gold_particle",
  single: "minecraft:green_sparkle",
  multi: "minecraft:blue_sparkle",
  misc: "minecraft:heart_particle",
};

export const CHEST_SIZE = 0.96;
export const FULL_BLOCK_SIZE = 1.08;
export const SORT_PARTICLE = "itemroute:sort";
export const DEPOSIT_PARTICLE = "itemroute:deposit";

/** 事件 → 播放坐标/维度的解析器（装配层注入：仓库/容器查找） */
export interface EffectLocator {
  dimensionOf(warehouseId: string): Dimension | undefined;
  containerCenter(containerId: string): { x: number; y: number; z: number } | undefined;
}

/** 订阅领域事件 visualEffect：route-flash/particle 播放粒子；维度内无玩家跳过 */
export function registerSortEffects(bus: EventBus, locator: EffectLocator): void {
  bus.visualEffect.subscribe((e: VisualEffectEvent) => {
    try {
      if (e.kind !== "route-flash" && e.kind !== "particle") return;
      const dimension = locator.dimensionOf(e.warehouseId);
      if (dimension === undefined) return;
      if (dimension.getPlayers().length === 0) return; // 无玩家在场不播放
      if (e.containerId === undefined) return;
      const center = locator.containerCenter(e.containerId);
      if (center === undefined) return;
      dimension.spawnParticle(e.kind === "route-flash" ? SORT_PARTICLE : DEPOSIT_PARTICLE, center);
    } catch (err) {
      console.warn(`[item-route] 视觉反馈失败: ${err}`);
    }
  });
}

/** 播放单次路由闪光（无玩家在场自动跳过） */
export function playSortEffect(dimension: Dimension, loc: { x: number; y: number; z: number }, color?: string): void {
  if (dimension.getPlayers().length === 0) return;
  dimension.spawnParticle(color ?? SORT_PARTICLE, { x: loc.x + 0.5, y: loc.y + FULL_BLOCK_SIZE / 2, z: loc.z + 0.5 });
}

/** 播放存入效果（较小粒子） */
export function playSearchEffect(dimension: Dimension, loc: { x: number; y: number; z: number }): void {
  if (dimension.getPlayers().length === 0) return;
  dimension.spawnParticle(DEPOSIT_PARTICLE, { x: loc.x + 0.5, y: loc.y + CHEST_SIZE, z: loc.z + 0.5 });
}