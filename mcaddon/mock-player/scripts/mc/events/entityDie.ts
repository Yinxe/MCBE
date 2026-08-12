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
import { world, system, EntityDieAfterEvent } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { PositionState } from "../../core/model/Types";
import { BOT_TAG, TAG_RESPAWN } from "../../core/tags/BotTags";
import { BotEvents } from "../../core/events/DomainEvents";
import { syncEntityTags } from "../adapters/EntityTags";
import { formatPos } from "../format";
import { formatDimensionId } from "../../core/format/Format";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { setPose } from "../adapters/PoseGateway";
import { trackBotOffline } from "../features/tridentTracker";

/** 自动重生延迟（tick）：复活后延迟 1 秒再传送回重生点 */
const RESPAWN_DELAY_TICKS = 20;

export function onEntityDie(event: EntityDieAfterEvent): void {
  const entity = event.deadEntity;
  try {
    if (!entity.hasTag(BOT_TAG)) return;
  } catch {
    return; // 一次性投掷物等非假人实体
  }
  const record = botRegistry.get(entity.nameTag);
  if (!record) return;

  // ⚠️ 整体异常隔离：死亡存储链任何一步失败都不能中断后续清理
  // （死亡点记录/重生/下线），否则 record 状态与实体不一致
  try {
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

  // 1. 死亡事件 = 数据存储时机点：直接读实体背包/装备/经验，有什么存什么。
  //    entityDie 回调时实体已处于死亡最终状态——普通物品已按游戏规则掉落
  //    （掉落物是物品离开假人的唯一副本），keepOnDeath（自带死亡不掉落）
  //    的物品仍在背包中，一并如实保存。不做额外过滤/清空，顺应游戏规则。
  saveCoordinator.saveFullState(bot, record);
  console.info(`[MockPlayer] 死亡存储 ${record.name}（实体当前状态，含死亡不掉落物品）`);

  // 2. 记录死亡信息
  record.deathPoint = deathState;
  record.lastPoint = null;
  saveCoordinator.saveRecord(record);

  // 死亡领域事件（自动重生仍触发，复活由 botRespawn 表达）
  BotEvents.botDeath.trigger({
    botName: record.name,
    position: { x: deathState.location.x, y: deathState.location.y, z: deathState.location.z },
    dimension: deathState.dimension,
  });

  world.sendMessage(
    `${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 死亡了 ${color.muted}@ ${formatPos(deathState.location)} ${color.darkGray}${formatDimensionId(deathState.dimension)}`,
  );

  // 3. 有自动重生标签 → 自动复活到重生点
  // ⚠️ 用 record.tags 判定（实体 tag 在死亡重建后可能漂移，导致自动重生静默失效）
  // ⚠️ 重生延迟 1 秒再传送回重生点：重生点致死（岩浆/窒息）时循环从"瞬间"降频为
  //    "每秒一次"，消息/写风暴大幅缓解，且玩家能更快发现异常并处理
  if (record.tags.includes(TAG_RESPAWN.value)) {
    try {
      trackBotOffline(record.entityId!);
      bot.respawn();

      // respawn() 必须在 entityDie 回调内调用（离开事件后实体 ID 失效），
      // 但回传送/恢复可延迟：respawn 后实体重建为有效的新实体
      system.runTimeout(() => {
        try {
          if (!bot.isValid) return; // 延迟期间再次死亡/下线 → 放弃本次恢复（entityDie 会重新处理）

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
          saveCoordinator.saveRecord(record);
          world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.accent}${record.name} 已自动复活`);
        } catch (e: any) {
          world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 自动复活完成失败: ${e.message}`);
        }
      }, RESPAWN_DELAY_TICKS);
      return;
    } catch (e: any) {
      // 重生失败→继续走死亡下线流程
      world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.error}${record.name} 自动重生失败: ${e.message}`);
    }
  }

  // 4. 无自动重生 / 自动重生失败 / 熔断 → 死亡下线
  trackBotOffline(record.entityId!);
  record.online = false;
  record.entityId = undefined;
  saveCoordinator.saveRecord(record);
  bot.disconnect();
  // 下线领域事件（订阅方：三叉戟回退第一任等）
  BotEvents.botOffline.trigger({ botName: record.name });
  world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 已死亡下线`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 死亡处理异常 ${record.name}: ${e?.message ?? e}`);
  }
}
