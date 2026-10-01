// ─── mc 层共享工具（通用函数提取，化繁为简） ───────────
// 各 feature/port 重复定义的通用小工具收敛于此，避免多份拷贝。
// 仅放纯通用函数（无业务含义）；业务逻辑留在各自模块。

import { system } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";

/** 延迟等待指定 tick（异步协程节奏控制，替代各文件重复定义） */
export function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/** 水平距离（忽略 Y，寻路/通知半径判定用） */
export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 3D 距离（到达判定/射程用） */
export function distance3d(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
