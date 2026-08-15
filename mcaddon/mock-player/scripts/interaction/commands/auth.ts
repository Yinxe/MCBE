// ─── 权限判定（mc 层） ────────────────────────────────
// 管理员 = OP（canManage，toolkit）或配置名单内玩家。
// 假人管理权 = 管理员 或 假人主人（ownerName）。
// 只读操作（list/data/tags）不限；修改类操作必须通过 canManageBot 守卫。
// 无主假人（旧版本升级数据）：首次管理操作自动认领（静默添加主人，见 autoClaim）。

import type { Player } from "@minecraft/server";
import { canManage, color } from "@yinxe/toolkit";

import type { BotRecord } from "../../rules/Types";
import { requireBot, type Bot } from "../../bot/Bot";
import { botRegistry, configStore, saveCoordinator } from "../../bootstrap/context";

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
 * 自动认领：无主假人（旧版本升级数据）→ 当前操作者静默成为主人。
 * 旧版（≤1.1.48）无 ownerName 字段，数据里没有创建者信息——无法自动推断，
 * 采用"首次管理操作认领"：谁先管理谁成为主人（先到先得）。
 * @returns true = 已认领（调用方应提示并放行）；false = 假人已有主（未改动）
 */
export function autoClaim(player: Player, record: BotRecord): boolean {
  if (record.ownerName) return false; // 已有主：不认领
  record.ownerName = player.name;
  saveCoordinator.saveRecord(record);
  console.info(`[MockPlayer] 自动认领 ${record.name} → ${player.name}`);
  return true;
}

/**
 * 命令守卫：按名字解析假人记录并校验管理权；无主假人自动认领。
 * @returns 错误消息（无权/不存在/未指定）；undefined = 通过，可继续操作
 */
export function guardBotCommand(player: Player, botName: string): string | undefined {
  if (!botName) return "请指定假人名字";
  const record = botRegistry.get(botName);
  if (!record) return `未找到假人 ${botName} 的记录`;
  if (canManageBot(player, record)) return undefined;
  // 无主假人 → 自动认领（旧版升级兼容）
  if (autoClaim(player, record)) {
    player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`);
    return undefined;
  }
  return `假人 ${botName} 只允许主人或管理员操作`;
}
/**
 * 命令层统一解析假人 Bot 对象（含权限守卫 + 记录检查 + 错误消息）。
 * 简化命令样板：找不到记录/无权限时自动向玩家发消息并返回 undefined。
 * @param player 执行命令的玩家
 * @param botName 假人名
 * @param registry 注册表（默认全局单例）
 * @returns Bot 对象；失败（无权限/无记录）→ undefined（已发消息）
 */
export function resolveBotForCommand(
  player: Player,
  botName: string,
  registry: typeof botRegistry = botRegistry
): Bot | undefined {
  if (!botName) {
    player.sendMessage(`${color.error}请指定假人名字`);
    return undefined;
  }
  const denied = guardBotCommand(player, botName);
  if (denied) {
    player.sendMessage(`${color.error}${denied}`);
    return undefined;
  }
  try {
    return requireBot(botName, registry);
  } catch {
    player.sendMessage(`${color.error}未找到假人 ${color.playerName}${botName}${color.error} 的记录`);
    return undefined;
  }
}
