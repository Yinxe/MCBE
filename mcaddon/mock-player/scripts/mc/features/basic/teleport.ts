// ─── 传送 ──────────────────────────────────────────────

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../../model/Types";
import { BOT_TAG } from "../../../tags/BotTags";
import { BotUiEvent } from "../../../events/UiEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "../../adapters/PoseGateway";
import { onlineBot } from "../manage/onlineBot";

export function tpPlayerToBot(player: Player, record: BotRecord): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  player.teleport(entity.location, { dimension: entity.dimension });
}

export function tpBotToPlayer(record: BotRecord, player: Player): void {
  if (!record.online || record.death) {
    throw new Error("模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;

  bot.teleport(player.location, { dimension: player.dimension });
  bot.isSneaking = player.isSneaking;
  record.isSneaking = player.isSneaking;

  // 姿态/视角/朝向：普通与常加载模式统一应用（setPose 内部 try-catch 防御，位置照常保存）
  const lookTarget = getPlayerLookTarget(player);
  setPose(bot, player.getRotation(), lookTarget);
  savePoseToRecord(record, player.location, player.dimension.id, player.getRotation(), lookTarget);
  saveCoordinator.saveRecord(record);
}

// ─── UI 事件订阅（BOT 主菜单 → 感知传送/同步动作） ──────

/** 订阅 BOT 主菜单动作事件：tpToBot=传送到假人身边（离线先上线）；syncPose=假人拉到身边+姿态同步 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;

    // ── 传送过去：离线先上线，等 1 tick 实体就绪后传送 ──
    if (e.action === "tpToBot") {
      const r = botRegistry.get(e.botName);
      if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已不存在`); return; }
      system.run(() => {
        if (!r.online || r.death) {
          onlineBot(r)
            .then(() => {
              player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 已上线`);
              system.run(() => {
                tpPlayerToBot(player, botRegistry.get(e.botName)!);
                player.sendMessage(`${color.success}已传送到 ${color.playerName}${e.botName}${color.success} 身边`);
              });
            })
            .catch((err: any) => player.sendMessage(`${color.error}${err?.message ?? err}`));
        } else {
          tpPlayerToBot(player, r);
          player.sendMessage(`${color.success}已传送到 ${color.playerName}${e.botName}${color.success} 身边`);
        }
      });
      return;
    }

    // ── 同步姿态：假人拉到玩家身边 + 复制姿态/朝向 ──
    if (e.action === "syncPose") {
      const r = botRegistry.get(e.botName);
      if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已不存在`); return; }
      if (!r.online || r.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
      system.run(() => {
        try {
          tpBotToPlayer(r, player);
          player.sendMessage(`${color.success}已同步 ${color.playerName}${e.botName}${color.success} 姿态与朝向`);
        } catch (err: any) { player.sendMessage(`${color.error}${err?.message ?? err}`); }
      });
    }
  });
}
