// ─── 视角方向计算（core 层） ────────────────────────────
// 纯数学：旋转角 → 方向向量。

import type { Vec2, Vec3 } from "../Types";

/**
 * 将旋转角（pitch/yaw，度）转为方向向量
 * 用于计算玩家当前看向的目标点
 */
export function rotationToDirection(rotation: Vec2): Vec3 {
  const pitchRad = (rotation.x * Math.PI) / 180;
  const yawRad = (rotation.y * Math.PI) / 180;
  return {
    x: -Math.sin(yawRad) * Math.cos(pitchRad),
    y: -Math.sin(pitchRad),
    z: Math.cos(yawRad) * Math.cos(pitchRad),
  };
}
