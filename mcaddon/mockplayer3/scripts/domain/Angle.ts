// ─── 角度与注视数学（domain 纯逻辑，pose 原子内核） ────────
// 朝向解算、最短弧差、头部对准判定。
// MCBE 约定：yaw 0=+Z(南)、逆时针增；pitch 上限 ±90。

import type { Vec2, Vec3 } from "./Coords";

/** 注视校正：重发间隔（tick） */
export const VIEW_SETTLE_INTERVAL = 4;
/** 注视校正：总时限（tick，10s 防极端情况无限重发） */
export const VIEW_SETTLE_TIMEOUT = 200;
/** 头部对准容差（度，双轴） */
export const VIEW_SETTLE_TOLERANCE_DEG = 12;
/** lookTarget 缺失时由朝向推远处目标点的距离（格） */
export const VIEW_SETTLE_FALLBACK_DISTANCE = 64;

/** 归一化角度到 [-180, 180) */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** 两角最短弧差（绝对值，度） */
export function angleDiffDeg(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

/**
 * 由"眼睛→目标"向量解算注视角（与 rotationToDirection 互逆）。
 * @returns x=pitch、y=yaw（度）；零距离返回 {0,0} 防除零
 */
export function rotationToward(from: Vec3, to: Vec3): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return { x: 0, y: 0 };
  return {
    x: (Math.asin(-dy / len) * 180) / Math.PI,
    y: (Math.atan2(-dx, dz) * 180) / Math.PI,
  };
}

/** 朝向单位向量（度→向量，与 rotationToward 互逆） */
export function rotationToDirection(rot: Vec2): Vec3 {
  const pitch = (rot.x * Math.PI) / 180;
  const yaw = (rot.y * Math.PI) / 180;
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
}

/** 由头部位置与朝向推"准星远处点"（小数精度——取整会毁掉准星连续性） */
export function farLookPoint(head: Vec3, rot: Vec2, distance = VIEW_SETTLE_FALLBACK_DISTANCE): Vec3 {
  const dir = rotationToDirection(rot);
  return { x: head.x + dir.x * distance, y: head.y + dir.y * distance, z: head.z + dir.z * distance };
}

/**
 * 头部是否已对准期望朝向（双轴都 ≤ 容差）。
 * @param headRotation - 实体 headRotation（x=pitch, y=yaw）
 */
export function isHeadFacing(headRotation: Vec2, want: Vec2, toleranceDeg = VIEW_SETTLE_TOLERANCE_DEG): boolean {
  return angleDiffDeg(headRotation.x, want.x) <= toleranceDeg && angleDiffDeg(headRotation.y, want.y) <= toleranceDeg;
}

/** 目标朝向 yaw（0=南；-0 归一为 0） */
export function computeTargetYaw(from: Vec3, to: Vec3): number {
  return (-Math.atan2(to.x - from.x, to.z - from.z) * 180) / Math.PI + 0;
}

/** yaw 是否已对齐（容差内） */
export function isYawAligned(currentYaw: number, targetYaw: number, toleranceDeg: number): boolean {
  return angleDiffDeg(currentYaw, targetYaw) <= toleranceDeg;
}
