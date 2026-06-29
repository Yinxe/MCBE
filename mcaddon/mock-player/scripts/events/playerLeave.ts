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

import { BOT_TAG } from "../features/types";
import { botRegistry, saveBotRecord, removeBotRestored } from "../features/persistence";
import { saveBotFullState } from "../features/operations";

export function onPlayerLeave(event: PlayerLeaveAfterEvent): void {
  const record = botRegistry.get(event.playerName);
  if (!record) return;
  console.warn(`[MockPlayer] 事件 playerLeave ${event.playerName}`);

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
  // 无论主动下线/死亡下线/删除，离开世界就是标记清除的唯一时机
  // 下次上线重新走 playerJoin 恢复流程
  removeBotRestored(record.name);
  world.sendMessage(`§7[§a假人§7] §e${record.name} 离开了游戏`);
}
