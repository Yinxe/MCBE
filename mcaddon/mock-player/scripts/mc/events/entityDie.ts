// ─── entityDie — 假人死亡处理 ────────────────────────────
//
// 处理流程：
//   1. 保存当前背包/装备/经验（无论是否自动重生，deadEntity 此时仍可访问）
//   2. 记录死亡点
//   3. 有自动重生标签 → respawn + 传送回重生点
//   4. 无自动重生 → 死亡下线
//
// ⚠️ 踩坑：
//   - entityDie 的 deadEntity 虽然已死，但 dimension.id / location / getRotation 仍可用
//   - respawn() 必须在 entityDie 中调用，离开事件后实体 ID 就无效了
//   - 死亡后 world.getPlayers({ tags }) 不再返回该假人

import { color } from "@yinxe/toolkit";
import { world, EntityDieAfterEvent } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { PositionState } from "../../core/model/Types";
import { BOT_TAG, TAG_RESPAWN } from "../../core/tags/BotTags";
import { syncEntityTags } from "../adapters/EntityTags";
import { formatPos } from "../format";
import { formatDimensionId } from "../../core/format/Format";
import { botRegistry, botStore } from "../bootstrap/context";
import { saveBotFullState } from "../features/saveState";
import { captureExperience } from "../adapters/McItemCodec";
import { setPose } from "../adapters/PoseGateway";
import { trackBotOffline } from "../features/tridentTracker";
import { decideDeathInventoryPolicy } from "../../core/service/InventoryLifecycle";

export function onEntityDie(event: EntityDieAfterEvent): void {
  const entity = event.deadEntity;
  try {
    if (!entity.hasTag(BOT_TAG)) return;
  } catch {
    return; // 一次性投掷物等非假人实体
  }
  const record = botRegistry.get(entity.nameTag);
  if (!record) return;

  console.info(`[MockPlayer] 事件 entityDie ${record.name}（${entity.dimension.id} ${Math.floor(entity.location.x)} ${Math.floor(entity.location.y)} ${Math.floor(entity.location.z)}）`);

  const bot = entity as SimulatedPlayer;
  const deathState: PositionState = {
    location: entity.location,
    dimension: entity.dimension.id,
    rotation: bot.getRotation(),
    lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
  };

  // ⚠️ 先置死亡标记：关闭 100tick 周期保存的竞态窗口
  // （否则窗口内周期保存会用死亡实体背包覆盖下面的持久化结果）
  record.death = true;

  // 1. 死亡时物品持久化策略（刷物防护，core 纯函数决策）：
  //    - 死亡掉落开启（keepInventory=false）→ 引擎掉落物是唯一副本，持久化清空，
  //      无论 entityDie 时 deadEntity 背包是否已被清空（时序差异）都不会双份
  //    - 死亡不掉落（keepInventory=true）→ 物品保留，保存当前背包，重生/重连不丢物
  const policy = decideDeathInventoryPolicy(world.gameRules.keepInventory);
  if (policy === "persist") {
    // 死亡不掉落：保存当前背包/装备/经验（实体仍可访问）
    saveBotFullState(bot, record);
  } else {
    // 死亡掉落：背包/装备持久化清空（掉落物是唯一副本）；经验照存（无交易价值，防不了刷也不丢）
    botStore.removeInventory(record.name);
    record.experience = captureExperience(bot);
    botRegistry.save(record);
    console.info(`[MockPlayer] 死亡清空背包持久化 ${record.name}（死亡掉落开启，掉落物为唯一副本）`);
  }

  // 2. 记录死亡信息
  record.deathPoint = deathState;
  record.lastPoint = null;
  botRegistry.save(record);

  world.sendMessage(
    `${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 死亡了 ${color.muted}@ ${formatPos(deathState.location)} ${color.darkGray}${formatDimensionId(deathState.dimension)}`,
  );

  // 3. 有自动重生标签 → 自动复活到重生点
  if (entity.hasTag(TAG_RESPAWN.value)) {
    try {
      trackBotOffline(record.entityId!);
      bot.respawn();
      const dim = world.getDimension(record.respawnPoint.dimension);
      bot.teleport(record.respawnPoint.location, { dimension: dim });
      if (record.spawnMode !== "chunkload") {
        setPose(bot, record.respawnPoint.rotation, record.respawnPoint.lookTarget);
      }

      // 复活后更新 entityId 并恢复标签（死亡可能导致实体重建，标签丢失）
      record.entityId = bot.id;
      syncEntityTags(bot, record.tags);

      // 清空死亡状态
      record.death = false;
      record.deathPoint = null;
      record.lastPoint = { ...record.respawnPoint };
      botRegistry.save(record);
      world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.accent}${record.name} 已自动复活`);
      return;
    } catch (e: any) {
      // 重生失败→继续走死亡下线流程
      world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 自动重生失败: ${e.message}`);
    }
  }

  // 4. 无自动重生 / 自动重生失败 → 死亡下线
  trackBotOffline(record.entityId!);
  record.online = false;
  record.entityId = undefined;
  botRegistry.save(record);
  bot.disconnect();
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 已死亡下线`);
}
