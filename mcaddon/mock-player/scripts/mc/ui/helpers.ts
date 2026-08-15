// ─── UI 层共享辅助（化繁为简） ─────────────────────────
// UI 表单共同的"取假人记录 + 可用性检查 + 错误消息"样板收敛于此：
//   1. resolveUiBotRecord：取记录（不存在 → 发消息返回 undefined）
//   2. ensureUiBotAvailable：在线可用性检查（不可用 → 发消息返回 false）
// 各 UI 不再重复 botRegistry.get + record.online/death 样板。

import type { Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import type { BotRecord } from "../../model/Types";
import { botRegistry } from "../bootstrap/context";

/**
 * 取假人记录（UI 通用）：不存在 → 发"已删除/不存在"消息并返回 undefined。
 * @param player 操作的玩家
 * @param botName 假人名
 * @param label 假人展示名（缺省 botName）
 */
export function resolveUiBotRecord(player: Player, botName: string, label = botName): BotRecord | undefined {
  const record = botRegistry.get(botName);
  if (!record) {
    player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${label}${color.error} 已不存在`);
    return undefined;
  }
  return record;
}

/**
 * 在线可用性检查（UI 通用）：不在线/死亡 → 发消息返回 false。
 * @param player 操作的玩家
 * @param record 假人记录
 */
export function ensureUiBotAvailable(player: Player, record: BotRecord): boolean {
  if (!record.online || record.death) {
    player.sendMessage(`${color.error}假人不在线或已死亡`);
    return false;
  }
  return true;
}
