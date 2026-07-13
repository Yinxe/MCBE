// ─── 区块检测工具 ──────────────────────────────────────
// 仅保留 isChunkLoaded 供 /mp:data 调试用
// GameTest 常加载方案已弃用（test.spawn 锁定实体旋转不可解）

import { Dimension, Vector3 } from "@minecraft/server";

export function isGameTestReady(): boolean {
  return false;
}

/** 空操作——常加载已禁用 */
export function initGameTestContext(): void {
  // 已禁用
}

/**
 * 检测指定位置的区块是否已加载
 */
export function isChunkLoaded(dimension: Dimension, pos: Vector3): boolean {
  try {
    const block = dimension.getBlock({
      x: Math.floor(pos.x),
      y: Math.max(Math.floor(pos.y), -64),
      z: Math.floor(pos.z),
    });
    if (!block) return false;
    const _ = block.typeId;
    return true;
  } catch {
    return false;
  }
}
