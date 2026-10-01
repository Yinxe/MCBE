import type { Player } from "@minecraft/server";
import type { SelectionSession } from "../types";

/**
 * 全局选择会话存储。
 * 以玩家 ID 为键，存储每位玩家正在进行的仓库创建/调整会话状态。
 * 会话包含操作类型、已选点、仓库名称等信息。
 * 使用 Map 而非持久化存储，玩家退出或操作完成后自动清除。
 */
const sessions = new Map<string, SelectionSession>();

/**
 * 获取指定玩家的当前选择会话。
 * 如果玩家尚未开始任何选择操作，返回 undefined。
 *
 * @param player - 要查询的玩家对象
 * @returns 当前会话对象，或 undefined（如果没有进行中的会话）
 */
export function getSession(player: Player): SelectionSession | undefined {
  return sessions.get(player.id);
}

/**
 * 为指定玩家设置（更新）选择会话。
 * 通常在玩家开始创建仓库流程或选择第一个点时调用。
 *
 * @param player  - 目标玩家
 * @param session - 要保存的会话数据
 */
export function setSession(player: Player, session: SelectionSession): void {
  sessions.set(player.id, session);
}

/**
 * 清除指定玩家的选择会话。
 * 通常在操作完成、失败或玩家主动取消时调用。
 *
 * @param player - 目标玩家
 */
export function clearSession(player: Player): void {
  sessions.delete(player.id);
}

/**
 * 根据玩家 ID 字符串直接清除会话。
 * 适用于无法获取完整 Player 对象的场景（如 playerLeave 事件中只提供了 playerId）。
 *
 * @param playerId - 要清除会话的玩家唯一标识符
 */
export function clearSessionById(playerId: string): void {
  sessions.delete(playerId);
}
