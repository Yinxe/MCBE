import { Player, Vector3 } from "@minecraft/server";
import { loadPlayerData, savePlayerData } from "./persistence";
import { DeathPointRecord, MAX_DEATH_POINTS, generateId } from "./types";

// ─── 记录死亡点 ─────────────────────────────────────────────────────

/**
 * 记录玩家的死亡位置。
 * 保留最近 MAX_DEATH_POINTS (10) 次死亡点。
 */
export function recordDeath(
  player: Player,
  location: Vector3,
  dimensionId: string,
): void {
  const data = loadPlayerData(player.id);

  const record: DeathPointRecord = {
    id: generateId(),
    deathTime: Date.now(),
    location: {
      x: Math.floor(location.x),
      y: Math.floor(location.y),
      z: Math.floor(location.z),
    },
    dimensionId,
  };

  data.deathPoints.push(record);

  // 超出限制时移除最旧的
  while (data.deathPoints.length > MAX_DEATH_POINTS) {
    data.deathPoints.shift();
  }

  savePlayerData(player.id, data);
}

// ─── 获取死亡点 ─────────────────────────────────────────────────────

/**
 * 获取玩家的死亡点列表（最新在前）。
 */
export function getDeathPoints(playerId: string): DeathPointRecord[] {
  const data = loadPlayerData(playerId);
  return [...data.deathPoints].reverse();
}

/**
 * 获取最近的死亡点。
 */
export function getLatestDeathPoint(playerId: string): DeathPointRecord | undefined {
  const data = loadPlayerData(playerId);
  if (data.deathPoints.length === 0) return undefined;
  return data.deathPoints[data.deathPoints.length - 1];
}

// ─── 删除死亡点 ─────────────────────────────────────────────────────

export function deleteDeathPoint(playerId: string, deathId: string): boolean {
  const data = loadPlayerData(playerId);
  const idx = data.deathPoints.findIndex((d) => d.id === deathId);
  if (idx === -1) return false;

  data.deathPoints.splice(idx, 1);
  savePlayerData(playerId, data);
  return true;
}
