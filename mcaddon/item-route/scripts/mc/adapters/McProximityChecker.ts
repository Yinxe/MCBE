// ─── 邻近检查器：ProximityChecker 实现（玩家位置轮询，按维度过滤） ──
import { world, type Player } from "@minecraft/server";
import type { ProximityChecker } from "../../core/scheduling/Scheduler";
import type { WarehouseId } from "../../core/model/types";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";

export interface WarehouseAreaRef {
  dimension: string;
  corner1: { x: number; y: number; z: number };
  corner2: { x: number; y: number; z: number };
}

/** 邻近判定半径（与调度激活距离一致） */
const PROXIMITY_RANGE = 16;

export class McProximityChecker implements ProximityChecker {
  constructor(
    private readonly findWarehouse: (id: WarehouseId) => { area: WarehouseAreaRef } | undefined,
    private readonly players: () => Player[] = () => world.getAllPlayers()
  ) {}

  hasNearbyPlayer(warehouseId: WarehouseId): boolean {
    const warehouse = this.findWarehouse(warehouseId);
    if (warehouse === undefined) return false;
    const { area } = warehouse;
    for (const p of this.players()) {
      if (p.dimension.id !== area.dimension) continue;
      const pos: PlayerPosition = { dimension: area.dimension, x: p.location.x, z: p.location.z };
      if (isPlayerNearby(area, [pos], PROXIMITY_RANGE)) return true;
    }
    return false;
  }
}