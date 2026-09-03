// ─── mc 层共享工具（通用函数提取，化繁为简） ───────────
// 各 feature/port 重复定义的通用小工具收敛于此，避免多份拷贝。
// 仅放纯通用函数（无业务含义）；业务逻辑留在各自模块。

import { system } from "@minecraft/server";
import type { Vector3 } from "@minecraft/server";

import { ActionError } from "../errors";

/** 延迟等待指定 tick（异步协程节奏控制，替代各文件重复定义） */
export function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/**
 * 引擎微动作统一骨架：把世界/实体操作推迟到**下一 tick**（system.run）
 * 执行，成功 resolve(true)；引擎异常在内部消化，统一转 ActionError
 * （"failed"，根因挂 cause）抛出。
 * 基础动作（setPose/lookAt/place/drop 等）一律经此封装——`return new Promise`
 * 风格，调用方 await 感知结果或 .catch 处理 ActionError。
 * @param action 动作闭包（同步执行体；可抛 ActionError 原样透传）
 * @param failMessage 失败时的中文错误描述（包装 ActionError 用）
 * @returns 成功 resolve(true)
 * @throws ActionError 动作闭包抛出的 ActionError 原样透传；其余异常包装为
 *   ActionError("failed", failMessage, cause)
 */
export function runActionNextTick(action: () => void, failMessage: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    system.run(() => {
      try {
        action();
        resolve(true);
      } catch (e: unknown) {
        reject(e instanceof ActionError ? e : new ActionError("failed", failMessage, e));
      }
    });
  });
}

/** 水平距离（忽略 Y，寻路/通知半径判定用） */
export function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** 3D 距离（到达判定/射程用） */
export function distance3d(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
