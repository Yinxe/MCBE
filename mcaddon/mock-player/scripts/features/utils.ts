// ─── 工具函数 ──────────────────────────────────────────

import { Player, Vector3, Vector2 } from "@minecraft/server";
import { PositionState } from "./types";

// ─── 坐标方向 ──────────────────────────────────────────

export function rotationToDirection(rotation: Vector2): Vector3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}

export function getPlayerLookTarget(player: Player, maxDistance: number = 64): Vector3 {
  const hit = player.getBlockFromViewDirection({ maxDistance });
  if (hit) {
    const b = hit.block;
    return { x: b.location.x + 0.5, y: b.location.y + 0.5, z: b.location.z + 0.5 };
  }
  const head = player.getHeadLocation();
  const dir = rotationToDirection(player.getRotation());
  return {
    x: head.x + dir.x * maxDistance,
    y: head.y + dir.y * maxDistance,
    z: head.z + dir.z * maxDistance,
  };
}

// ─── 格式化 ────────────────────────────────────────────

const DIM_MAP: Record<string, string> = {
  "minecraft:overworld": "主世界",
  "minecraft:nether": "下界",
  "minecraft:the_end": "末地",
};

export function formatDimensionId(dimId: string): string {
  return DIM_MAP[dimId] ?? dimId;
}

export function formatPos(v: Vector3): string {
  return `§7[§f${Math.floor(v.x)} §f${Math.floor(v.y)} §f${Math.floor(v.z)}§7]`;
}

export function formatState(state: PositionState): string {
  return `${formatPos(state.location)} §8${formatDimensionId(state.dimension)} §7旋转(${Math.floor(state.rotation.x)},${Math.floor(state.rotation.y)})`;
}

// ─── 状态捕获 ──────────────────────────────────────────

export function capturePlayerState(player: Player, lookTarget: Vector3): PositionState {
  return {
    location: player.location,
    dimension: player.dimension.id,
    rotation: player.getRotation(),
    lookTarget,
  };
}

export function capturePlayerStateFromRotation(
  location: Vector3,
  dimension: string,
  rotation: Vector2,
  lookTarget: Vector3
): PositionState {
  return { location, dimension, rotation, lookTarget };
}

// ─── 坐标解析 ──────────────────────────────────────────

/** 解析 "x y z" 格式的坐标文本 */
export function parseCoordinateInput(input: string): Vector3 | undefined {
  if (!input || input.trim() === "") return undefined;
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 3) return undefined;
  const x = parseFloat(parts[0]);
  const y = parseFloat(parts[1]);
  const z = parseFloat(parts[2]);
  if (isNaN(x) || isNaN(y) || isNaN(z)) return undefined;
  return { x, y, z };
}
