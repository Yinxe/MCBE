// ─── 邻近检查器：ProximityChecker 实现（在线成员到仓库中心直线距离） ──
// 调度激活的依据（本次修正，对应"只有成员影响生命周期 + 用中心直线距离"）：
//   · **只统计在线成员**（owner + member，统称"成员"）——普通玩家/访客在场不激活。
//   · 距离采用**到仓库中心的直线距离 ≤ 外接圆半径 + margin**（v1 口径），
//     大仓库时玩家身处区域内也能正确激活（否则固定 16 格会漏）。
// ⚠️ 性能：调度每 tick 对**每个仓库**各调一次 hasNearbyPlayer → 若每次现拉 world.getAllPlayers()
//   N 仓就 N 次全服玩家枚举（每 5 tick）。这里按 game tick 缓存一次玩家列表，同 tick 多仓共享。
import { system, world, type Player } from "@minecraft/server";
import type { ProximityChecker } from "../../core/scheduling/Scheduler";
import type { WarehouseId } from "../../core/model/types";
import { isPlayerNearby, type PlayerPosition } from "../../core/model/Area";
import { namedPlayers } from "../util/playerName";

/** 邻近判定参考（与 core Warehouse 结构对齐，main.ts 可直接喂 loaded 仓库） */
export interface WarehouseRef {
  area: {
    dimension: string;
    corner1: { x: number; y: number; z: number };
    corner2: { x: number; y: number; z: number };
  };
  ownerName: string;
  members: { playerName: string }[];
}

/** 邻近判定穿透 margin（叠加在外接圆半径外） */
export const PROXIMITY_MARGIN = 8;

// 每 game tick 缓存一次的玩家列表（避免对每仓重复 getAllPlayers）
let cachedTick = -1;
let cachedPlayers: Player[] = [];
function playersThisTick(): Player[] {
  const tick = system.currentTick;
  if (tick !== cachedTick) {
    cachedTick = tick;
    cachedPlayers = world.getAllPlayers();
  }
  return cachedPlayers;
}

export class McProximityChecker implements ProximityChecker {
  constructor(
    private readonly findWarehouse: (id: WarehouseId) => WarehouseRef | undefined,
    private readonly players: () => Player[] = playersThisTick
  ) {}

  hasNearbyPlayer(warehouseId: WarehouseId): boolean {
    const warehouse = this.findWarehouse(warehouseId);
    if (warehouse === undefined) return false;
    const memberNames = new Set<string>([warehouse.ownerName, ...warehouse.members.map((m) => m.playerName)]);
    const memberPositions: PlayerPosition[] = [];
    // ⚠️ 安全枚举（真实+模拟玩家）：namedPlayers 丢弃半初始化/字段不全项（自带的 .name 坑），
    // 成员判定按解析名匹配（owner/member 表）
    for (const { player: p, name } of namedPlayers(this.players())) {
      if (p.dimension.id !== warehouse.area.dimension) continue;
      if (!memberNames.has(name)) continue; // 只统计在线成员（真实+模拟玩家）
      memberPositions.push({ dimension: warehouse.area.dimension, x: p.location.x, z: p.location.z });
    }
    return isPlayerNearby(warehouse.area, memberPositions, PROXIMITY_MARGIN);
  }
}
