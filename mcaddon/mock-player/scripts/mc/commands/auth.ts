// ─── 权限判定（mc 层） ────────────────────────────────
// 管理员 = OP（canManage，toolkit）或配置名单内玩家。
// 假人管理权 = 管理员 或 假人主人（ownerName）。
// 只读操作（list/data/tags）不限；修改类操作必须通过 canManageBot 守卫。

import type { Player } from "@minecraft/server";
import { canManage } from "@yinxe/toolkit";

import type { BotRecord } from "../../core/model/Types";
import { botRegistry, configStore } from "../bootstrap/context";

/** 是否管理员：OP 权限 或 配置名单内玩家 */
export function isAdmin(player: Player): boolean {
  if (canManage(player)) return true;
  return configStore.get().admins.includes(player.name);
}

/**
 * 是否可管理该假人：管理员 或 假人主人。
 * 无主假人（ownerName 为空）仅管理员可管理。
 */
export function canManageBot(player: Player, record: BotRecord): boolean {
  if (isAdmin(player)) return true;
  return !!record.ownerName && record.ownerName === player.name;
}

/**
 * 命令守卫：按名字解析假人记录并校验管理权。
 * @returns 错误消息（无权/不存在/未指定）；undefined = 通过，可继续操作
 */
export function guardBotCommand(player: Player, botName: string): string | undefined {
  if (!botName) return "请指定假人名字";
  const record = botRegistry.get(botName);
  if (!record) return `未找到假人 ${botName} 的记录`;
  if (!canManageBot(player, record)) {
    return `假人 ${botName} 只允许主人或管理员操作`;
  }
  return undefined;
}