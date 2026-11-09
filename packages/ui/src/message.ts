// ─── 界面消息助手 ────────────────────────────────────────────────
//
// 面向表单交互的消息发送:玩家已离线时静默跳过,而不是让异常打断后续流程。

import { type Player } from "@minecraft/server";

/**
 * 安全地向玩家发送消息。玩家已断线时静默忽略。
 */
export function trySendMessage(player: Player, message: string): void {
  try {
    player.sendMessage(message);
  } catch {
    // 玩家可能已断线,静默忽略
  }
}

/**
 * 成功提示(绿色)。
 */
export function notifySuccess(player: Player, message: string): void {
  trySendMessage(player, `§a${message}`);
}

/**
 * 失败提示(红色)。
 */
export function notifyError(player: Player, message: string): void {
  trySendMessage(player, `§c${message}`);
}
