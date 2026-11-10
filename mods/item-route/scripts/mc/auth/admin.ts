// ─── 管理员判定（模组级策略,不是通用能力） ──────────────────────
// 本仓库的共享包 `@mc-toolchain/mod-common` 刻意不提供权限判定:
// 「谁是管理员」是各模组自己的策略,不适合沉淀成跨模组约定。
// 因此这里按脚本 API 的玩家权限级别判定,与上游模组里的同名判定语义一致。
import { PlayerPermissionLevel, type Player } from "@minecraft/server";

/**
 * 玩家是否为管理员(OP)。
 *
 * 依据 `playerPermissionLevel` 是否达到 Operator。**不**额外接受 `op` 标签:
 * 上游没有这条兜底,加上会扩大管理员面(任何玩家自助加标签即可绕过仓库权限)。
 */
export function canManage(player: Player): boolean {
  return player.playerPermissionLevel >= PlayerPermissionLevel.Operator;
}
