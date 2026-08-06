// ─── 邻近检查器：ProximityChecker 实现（在线成员到仓库中心直线距离） ──
// 调度激活的依据（本次修正，对应"只有成员影响生命周期 + 用中心直线距离"）：
//   · **只统计在线成员**（owner + member，统称"成员"）——普通玩家/访客在场不激活。
//   · 距离采用**到仓库中心的直线距离 ≤ 外接圆半径 + margin**（v1 口径），
//     大仓库时玩家身处区域内也能正确激活（否则固定 16 格会漏）。
// 采用"调用时实时读 world.getAllPlayers() 过滤"（调度每 5 tick 才调一次，量级可接受）。
import { world, type Player } from "@minecraft/server";
import type { ProximityChecker } from "../../core/scheduling/Scheduler";
import type { WarehouseId } from "../../core/model/types";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";

/** 邻近判定参考（与 core Warehouse 结构对齐，main.ts 可直接喂 loaded 仓库） */
export interface WarehouseRef {
  area: {
    dimension: string;
    corner1: { x: number; y: number; z: number };
    corner2: { x: number; y: number; z: number };
  };
  ownerId: string;
  members: { playerId: string }[];
}

/** 邻近判定穿透 margin（叠加在外接圆半径外） */
export const PROXIMITY_MARGIN = 8;

export class McProximityChecker implements ProximityChecker {
  constructor(
    private readonly findWarehouse: (id: WarehouseId) => WarehouseRef | undefined,
    private readonly players: () => Player[] = () => world.getAllPlayers()
  ) {}

  hasNearbyPlayer(warehouseId: WarehouseId): boolean {
    const warehouse = this.findWarehouse(warehouseId);
    if (warehouse === undefined) return false;
    const memberIds = new Set<string>([warehouse.ownerId, ...warehouse.members.map((m) => m.playerId)]);
    const memberPositions: PlayerPosition[] = [];
    for (const p of this.players()) {
      if (p.dimension.id !== warehouse.area.dimension) continue;
      if (!memberIds.has(p.id)) continue; // 只统计在线成员（owner/member）
      memberPositions.push({ dimension: warehouse.area.dimension, x: p.location.x, z: p.location.z });
    }
    return isPlayerNearby(warehouse.area, memberPositions, PROXIMITY_MARGIN);
  }
}
