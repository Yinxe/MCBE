// ─── 断开重连周期标记表 ────────────────────────────────
//
// 宝库模式周期、生成模式切换等场景假人先 disconnect 再立即 respawn，
// 这段时间内在 playerLeave 中跳过"离开游戏"消息。
// 实际的上线时机由轮询 `waitForNameAvailable` 控制，确认旧实体完全
// 释放后再 spawn。

import { system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import type { BotRecord } from "../../rules/Types";
import { offlineBot } from "./offlineBot";
import { onlineBot } from "./onlineBot";
import { waitForNameAvailable } from "../../bot/PlayerGateway";
import { saveCoordinator } from "../../bootstrap/context";

export const reconnectingBots = new Set<string>();

export interface SafeReconnectOptions {
  /** 下线后、重新上线前执行（如切换 spawnMode），在 system.run 内执行 */
  onOffline?: (record: BotRecord) => void;
  /** 重新上线后执行（如通知玩家） */
  onOnline?: (bot: SimulatedPlayer, record: BotRecord) => void;
}

/**
 * 安全地断开 → 等待名称释放 → 重新上线一个假人。
 *
 * 封装了完整生命周期：
 *   1. 标记 reconnectingBots → 抑制 playerLeave 消息
 *   2. offlineBot + onOffline 回调（system.run 内执行）
 *   3. waitForNameAvailable 轮询（每 2 tick，60 tick 超时）
 *   4. onlineBot + onOnline 回调
 *
 * 无论调用上下文（system.run 内/外）均可安全使用。
 *
 * @example
 *   safeReconnect(record, {
 *     onOffline: () => switchSpawnMode(record, "chunkload"),
 *     onOnline: (bot) => player.sendMessage("已上线"),
 *   });
 */
export function safeReconnect(record: BotRecord, options?: SafeReconnectOptions): void {
  if (reconnectingBots.has(record.name)) {
    console.warn(`[MockPlayer] safeReconnect 跳过 ${record.name}——已有重连在进行`);
    return;
  }
  reconnectingBots.add(record.name);

  system.run(() => {
    try {
      offlineBot(record);
    } catch (e: any) {
      console.warn(`[MockPlayer] safeReconnect offlineBot 失败 ${record.name}: ${e?.message ?? e}`);
    }
    try {
      options?.onOffline?.(record);
    } catch (e: any) {
      console.warn(`[MockPlayer] safeReconnect onOffline 回调异常 ${record.name}: ${e?.message ?? e}`);
    }
  });

  waitForNameAvailable(record.name)
    .then(() => doConnect(record, options?.onOnline))
    .catch(() => {
      console.warn(`[MockPlayer] safeReconnect 等待名称释放超时 ${record.name}，强制执行上线`);
      doConnect(record, options?.onOnline);
    })
    .finally(() => reconnectingBots.delete(record.name));
}

async function doConnect(
  record: BotRecord,
  onOnline?: (bot: SimulatedPlayer, record: BotRecord) => void,
): Promise<void> {
  let bot: SimulatedPlayer;
  try {
    bot = await onlineBot(record);
  } catch (e: any) {
    console.error(`[MockPlayer] safeReconnect 上线失败 ${record.name}: ${e?.message ?? e}`);
    record.online = false;
    record.entityId = undefined;
    saveCoordinator.saveRecord(record);
    return;
  }

  try {
    onOnline?.(bot, record);
  } catch (e: any) {
    // 通知等回调失败不影响上线状态
    console.warn(`[MockPlayer] safeReconnect 回调异常 ${record.name}: ${e?.message ?? e}`);
  }
}