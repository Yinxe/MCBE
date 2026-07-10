// ─── UI 工具函数 ─────────────────────────────────────────────────
// 在 @minecraft/server-ui 表单中常用的辅助操作。

import { type Player } from "@minecraft/server";

/**
 * 安全向玩家发送消息，玩家已断线时静默忽略。
 */
export function trySendMessage(player: Player, message: string): void {
  try {
    player.sendMessage(message);
  } catch {
    // 玩家可能已断线，静默忽略
  }
}

/**
 * 在标题栏显示操作结果，绿色成功 / 红色失败。
 */
export function notifySuccess(player: Player, msg: string): void {
  trySendMessage(player, `§a${msg}`);
}

export function notifyError(player: Player, msg: string): void {
  trySendMessage(player, `§c${msg}`);
}
