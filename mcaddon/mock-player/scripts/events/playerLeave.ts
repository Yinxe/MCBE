// ─── playerLeave — 假人离开世界 ──────────────────────────
//
// 这是一个"尽力保存"的兜底节点——实体可能已不可访问
// 主要的保存逻辑在 entityDie（死亡时）和 offlineBot（主动下线时）
//
// ⚠️ 踩坑：
//   world.getEntity(record.entityId) 在 playerLeave 中可能返回 undefined
//   因为 playerLeave 是 afterEvent，实体可能已从世界移除
//   所以这里必须 try-catch 包裹
//   可靠的保存时机是 entityDie（死亡）和 offlineBot（主动下线）

import { world, Player, PlayerLeaveAfterEvent } from "@minecraft/server";

import { BOT_TAG } from "../features/core/tags";
import { botRegistry, saveBotRecord, removeBotRestored } from "../features/core/persistence";
import { saveBotFullState } from "../features/saveState";
import { reconnectingBots } from "../features/pendingRespawn";
import { color } from "@yinxe/toolkit";

export function onPlayerLeave(event: PlayerLeaveAfterEvent): void {
  let record = botRegistry.get(event.playerName);

  // ── 容错：通过 entityId 反查（改名后 Player.name 只读不匹配 registry key） ──
  // 正常改名路径要求离线，此分支兜底防止数据泄露
  if (!record) {
    for (const r of botRegistry.values()) {
      if (r.entityId === event.playerId) {
        console.info(`[MockPlayer] playerLeave 反查命中 ${r.name}（playerName=${event.playerName}）`);
        record = r;
        break;
      }
    }
  }

  if (!record) return;
  console.info(`[MockPlayer] 事件 playerLeave ${event.playerName}`);

  // ⚠️ 旧实体残留：如果 record 已指向新实体（safeReconnect 已完成），
  // 忽略此事件——避免覆写新实体的 online/entityId/restore 标记
  if (record.entityId && event.playerId !== record.entityId) {
    console.info(`[MockPlayer] playerLeave 跳过：旧实体离开（${event.playerName} 已重建为新实体 ${record.entityId}）`);
    return;
  }

  // 实体可能还在，尽力保存
  if (record.entityId) {
    try {
      const bot = world.getEntity(record.entityId);
      if (bot?.hasTag(BOT_TAG)) {
        saveBotFullState(bot as Player, record);
      }
    } catch {
      // 实体已不可访问，忽略——主保存路径在 entityDie / offlineBot 已完成
    }
  }

  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  removeBotRestored(record.name);

  // 重连周期（宝库/模式切换）不发送"离开游戏"消息
  if (reconnectingBots.has(record.name)) {
    reconnectingBots.delete(record.name);
    return;
  }
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 离开了游戏`);
}
