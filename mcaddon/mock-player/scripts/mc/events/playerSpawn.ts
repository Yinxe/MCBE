// ─── playerSpawn — 假人重生（死亡后重生） ───────────────
//
// 注意区分两个场景：
//   initialSpawn=true  — spawnSimulatedPlayer 首次生成（不走这，恢复了由 playerJoin 负责）
//   initialSpawn=false — 死亡后 respawn（走这，只更新状态，不覆盖背包）
//
// 为什么不在 playerSpawn 恢复背包？
//   playerSpawn 在死亡重生时也会触发（initialSpawn=false），此时不该覆盖玩家的物品栏
//   恢复背包的正确时机是 playerJoin（仅加入世界时触发）

import { world, PlayerSpawnAfterEvent } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { BOT_TAG } from "../../core/tags/BotTags";
import { domainEvents } from "../../core/events/DomainEvents";
import { syncEntityTags } from "../adapters/EntityTags";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { trackBotOnline } from "../features/tridentTracker";

export function onPlayerSpawn(event: PlayerSpawnAfterEvent): void {
  // 首次生成不处理（由 playerJoin 负责恢复）
  if (event.initialSpawn) return;
  const player = event.player;
  if (!player.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(player.name);
  if (!record) return;
  console.info(`[MockPlayer] 事件 playerSpawn(重生) ${record.name}`);
  record.death = false;
  record.online = true;

  // 重生后实体可能重建，更新 entityId 并恢复标签
  record.entityId = player.id;
  trackBotOnline(player.id, record.name);
  syncEntityTags(player, record.tags);

  saveCoordinator.saveRecord(record);
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.accent}${record.name} 重生了`);

  // 复活领域事件：订阅方（三叉戟认主夺回/劫掠续药等）驱动
  domainEvents.botRespawn.trigger({ botName: record.name });
}
