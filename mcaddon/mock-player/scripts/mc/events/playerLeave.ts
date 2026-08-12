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

import { BOT_TAG } from "../../core/tags/BotTags";
import { BotEvents } from "../../core/events/DomainEvents";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { offlineBot } from "../features/offlineBot";
import { reconnectingBots } from "../features/pendingRespawn";
import { color } from "@yinxe/toolkit";

/** 真实玩家下线 → 该主人名下全部在线假人安全下线 */
function offlineOwnerBots(ownerName: string): void {
  const owned = botRegistry.all().filter((r) => r.ownerName === ownerName && r.online);
  if (owned.length === 0) return;
  console.info(`[MockPlayer] 玩家 ${ownerName} 下线，联动下线 ${owned.length} 个假人`);
  for (const record of owned) {
    try {
      offlineBot(record);
    } catch (e: any) {
      console.warn(`[MockPlayer] 联动下线失败 ${record.name}: ${e?.message ?? e}`);
    }
  }
}

export function onPlayerLeave(event: PlayerLeaveAfterEvent): void {
  let record = botRegistry.get(event.playerName);

  // ── 容错：通过 entityId 反查（改名后 Player.name 只读不匹配 registry key） ──
  // 正常改名路径要求离线，此分支兜底防止数据泄露
  if (!record) {
    for (const r of botRegistry.all()) {
      if (r.entityId === event.playerId) {
        console.info(`[MockPlayer] playerLeave 反查命中 ${r.name}（playerName=${event.playerName}）`);
        record = r;
        break;
      }
    }
  }

  if (!record) {
    // ── 真实玩家下线 → 他的全部在线假人联动下线（玩家隔离机制） ──
    // 假人都在 registry 中（本 handler 是假人路径）；查不到记录 = 真实玩家离开
    offlineOwnerBots(event.playerName);
    return;
  }
  console.info(`[MockPlayer] 事件 playerLeave ${event.playerName}`);

  // ⚠️ 幂等防护：entityDie（死亡下线）/ offlineBot（主动下线）已先行处理
  // （保存 + online=false + 触发 botOffline + 消息），disconnect 派发的
  // playerLeave 只是残留事件——重复触发会导致 releaseBotTridents 双扫描、
  // 认主汇报重复入队、聊天双消息。重连周期标记在此顺带清理。
  if (!record.online) {
    if (reconnectingBots.has(record.name)) reconnectingBots.delete(record.name);
    return;
  }

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
        saveCoordinator.saveFullState(bot as Player, record);
      }
    } catch {
      // 实体已不可访问，忽略——主保存路径在 entityDie / offlineBot 已完成
    }
  }

  record.online = false;
  record.entityId = undefined;
  saveCoordinator.saveRecord(record);

  // 下线领域事件（订阅方：三叉戟回退第一任等；offlineBot/entityDie 已各自触发，重复触发幂等）
  BotEvents.botOffline.trigger({ botName: record.name });
  botRegistry.removeRestored(record.name);

  // 重连周期（宝库/模式切换）不发送"离开游戏"消息
  if (reconnectingBots.has(record.name)) {
    reconnectingBots.delete(record.name);
    return;
  }
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 离开了游戏`);
}
