// ─── 死亡点纯逻辑 ───────────────────────────────────────────────

import {
  MAX_DEATH_POINTS,
  generateId,
  type DeathPointRecord,
  type PlayerData,
  type Position,
} from "./types";
import { floorPosition } from "./waypoints";

/** 记录一次死亡。超出上限时丢弃最旧的。 */
export function recordDeathPoint(
  data: PlayerData,
  location: Position,
  dimensionId: string,
  now: number = Date.now(),
  random: number = Math.random(),
): DeathPointRecord {
  const record: DeathPointRecord = {
    id: generateId(now, random),
    deathTime: now,
    location: floorPosition(location),
    dimensionId,
  };

  data.deathPoints.push(record);

  while (data.deathPoints.length > MAX_DEATH_POINTS) {
    data.deathPoints.shift();
  }

  return record;
}

/** 最新的死亡点。没有记录时返回 undefined。 */
export function getLatestDeathPoint(
  data: PlayerData,
): DeathPointRecord | undefined {
  if (data.deathPoints.length === 0) return undefined;
  return data.deathPoints[data.deathPoints.length - 1];
}

/** 死亡点列表,最新在前。返回新数组。 */
export function listDeathPoints(data: PlayerData): DeathPointRecord[] {
  return data.deathPoints.slice().reverse();
}

/** 按 ID 删除死亡点。 */
export function removeDeathPoint(
  data: PlayerData,
  deathPointId: string,
): boolean {
  const index = data.deathPoints.findIndex(
    (record) => record.id === deathPointId,
  );
  if (index === -1) return false;
  data.deathPoints.splice(index, 1);
  return true;
}

/** 清空所有死亡点,返回清掉的条数。 */
export function clearDeathPoints(data: PlayerData): number {
  const count = data.deathPoints.length;
  data.deathPoints = [];
  return count;
}
