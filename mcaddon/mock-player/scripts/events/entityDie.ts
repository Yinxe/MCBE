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

import { world, EntityDieAfterEvent } from "@minecraft/server";
import { SimulatedPlayer, LookDuration } from "@minecraft/server-gametest";

import { PositionState } from "../features/core/types";
import { BOT_TAG, TAG_RESPAWN, syncEntityTags } from "../features/core/tags";
import { formatPos, formatDimensionId } from "../features/core/utils";
import { botRegistry, saveBotRecord } from "../features/core/persistence";
import { saveBotFullState } from "../features/saveState";

export function onEntityDie(event: EntityDieAfterEvent): void {
  const entity = event.deadEntity;
  if (!entity.hasTag(BOT_TAG)) return;
  const record = botRegistry.get(entity.nameTag);
  if (!record) return;

  console.warn(`[MockPlayer] 事件 entityDie ${record.name}（${entity.dimension.id} ${Math.floor(entity.location.x)} ${Math.floor(entity.location.y)} ${Math.floor(entity.location.z)}）`);

  const bot = entity as SimulatedPlayer;
  const deathState: PositionState = {
    location: entity.location,
    dimension: entity.dimension.id,
    rotation: bot.getRotation(),
    lookTarget: record.lastPoint?.lookTarget ?? record.respawnPoint.lookTarget,
  };

  // 1. 保存当前状态（entity 仍可访问）。先于一切分支，确保无论自动重生成败都能保存
  saveBotFullState(bot, record);

  // 2. 记录死亡信息
  record.death = true;
  record.deathPoint = deathState;
  record.lastPoint = null;
  saveBotRecord(record);

  world.sendMessage(
    `§7[§a假人§7] §c${record.name} 死亡了 §7@ ${formatPos(deathState.location)} §8${formatDimensionId(deathState.dimension)}`,
  );

  // 3. 有自动重生标签 → 自动复活到重生点
  if (entity.hasTag(TAG_RESPAWN.value)) {
    try {
      bot.respawn();
      const dim = world.getDimension(record.respawnPoint.dimension);
      bot.teleport(record.respawnPoint.location, { rotation: record.respawnPoint.rotation, dimension: dim });
      bot.isSneaking = record.isSneaking;
      bot.lookAtLocation(record.respawnPoint.lookTarget, LookDuration.Continuous);

      // 复活后更新 entityId 并恢复标签（死亡可能导致实体重建，标签丢失）
      record.entityId = bot.id;
      syncEntityTags(bot, record.tags);

      // 清空死亡状态
      record.death = false;
      record.deathPoint = null;
      record.lastPoint = { ...record.respawnPoint };
      saveBotRecord(record);
      world.sendMessage(`§7[§a假人§7] §b${record.name} 已自动复活`);
      return;
    } catch (e: any) {
      // 重生失败→继续走死亡下线流程
      world.sendMessage(`§7[§a假人§7] §c${record.name} 自动重生失败: ${e.message}`);
    }
  }

  // 4. 无自动重生 / 自动重生失败 → 死亡下线
  record.online = false;
  record.entityId = undefined;
  saveBotRecord(record);
  bot.disconnect();
  world.sendMessage(`§7[§a假人§7] §e${record.name} 已死亡下线`);
}
