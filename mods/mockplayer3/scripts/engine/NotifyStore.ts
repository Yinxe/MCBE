// ─── 个人通知设置存储与私信投递闸门（DP: mp:notify:<玩家名>，JSON） ──
// 键口径与 ownerKey 同源（playerKey）。闸门本身不补发：sendNotify 返回三态
// 回执（送达/被设置屏蔽/玩家不可达），是否重试由调用方按消息重要性决定。
// 设置等于缺省时删除 DP 键保持整洁。

import { playerKey } from "../domain/Identity";
import type { NotifyLevel, NotifySetting } from "../domain/NotifyRules";
import {
  DEFAULT_NOTIFY_SETTING,
  decorateNotify,
  isDefaultNotifySetting,
  parseNotifySetting,
  shouldSendNotify,
} from "../domain/NotifyRules";
import { readJson, removeKey, writeJson } from "./Dp";
import { entityGateway } from "./EntityGateway";

const NOTIFY_PREFIX = "mp:notify:";

/** 会话内读缓存（null=未持久化按缺省；undefined=未读过） */
const cache = new Map<string, NotifySetting | null>();

/**
 * 读玩家通知设置（未持久化返回缺省）。
 * @param playerName - 真人玩家名
 */
export function getNotifySetting(playerName: string): NotifySetting {
  const key = playerKey(playerName);
  const cached = cache.get(key);
  if (cached !== undefined) return cached ?? { ...DEFAULT_NOTIFY_SETTING };
  const parsed = parseNotifySetting(readJson<unknown>(`${NOTIFY_PREFIX}${key}`));
  cache.set(key, isDefaultNotifySetting(parsed) ? null : parsed);
  return parsed;
}

/**
 * 写玩家通知设置（世界事件回调用外须 system.run；等价缺省时删键）。
 * @param playerName - 真人玩家名
 * @param setting - 全量设置
 */
export function setNotifySetting(playerName: string, setting: NotifySetting): void {
  const key = playerKey(playerName);
  const def = isDefaultNotifySetting(setting);
  cache.set(key, def ? null : setting);
  try {
    if (def) removeKey(`${NOTIFY_PREFIX}${key}`);
    else writeJson(`${NOTIFY_PREFIX}${key}`, setting);
  } catch (e: any) {
    console.warn(`[mockplayer3] 通知设置写入失败 ${key}: ${e?.message ?? e}`);
  }
}

/** 私信投递回执：送达 / 被玩家设置屏蔽（视为已消费）/ 玩家不可达（可重试） */
export type NotifyDelivery = "sent" | "suppressed" | "unreachable";

/**
 * 私信唯一投递闸门：按玩家设置过滤档位并加彩色标记后发送。
 * @param playerName - 目标真人玩家名
 * @param text - 正文（可自带 § 色码）
 * @param level - 通知档位
 * @returns 投递回执；suppressed=玩家主动不收（不重试），unreachable=离线/瞬态（调用方可重试）
 */
export function sendNotify(playerName: string, text: string, level: NotifyLevel): NotifyDelivery {
  if (!shouldSendNotify(getNotifySetting(playerName), level)) return "suppressed";
  const player = entityGateway.findRealPlayer(playerName);
  if (!player) return "unreachable";
  try {
    player.sendMessage(decorateNotify(level, text));
    return "sent";
  } catch {
    return "unreachable"; // 实体瞬态失效
  }
}
