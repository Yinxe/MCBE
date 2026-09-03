// ─── 传送 ──────────────────────────────────────────────

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { ActionError, describeError } from "../../errors";
import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "./PoseGateway";
import { runActionNextTick } from "../utils";
import { safeOnline } from "../manage/onlineBot";

/**
 * 传送玩家到假人身边。
 * 微动作：system.run 推迟到下一 tick 执行传送；成功 resolve(true)，
 * 引擎异常内部消化转 ActionError（前置不满足=offline/unavailable，
 * 引擎调用失败=failed，根因在 cause）。
 * @param player 发起传送的玩家
 * @param record 假人记录
 * @returns 成功 resolve(true)
 * @throws ActionError 假人不在线/实体丢失/传送失败
 */
export function tpPlayerToBot(player: Player, record: BotRecord): Promise<boolean> {
  if (!record.online || record.death) {
    return Promise.reject(new ActionError("offline", "模拟玩家不在线或已死亡"));
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    return Promise.reject(new ActionError("unavailable", "无法在世界中找到该模拟玩家"));
  }
  return runActionNextTick(() => {
    player.teleport(entity.location, { dimension: entity.dimension });
  }, `传送玩家到 ${record.name} 身边失败`);
}

/**
 * 把假人拉到玩家身边并同步姿态/朝向/潜行。
 * 传送为微动作（下一 tick 执行）；姿态同步 await setPose（同为微动作）。
 * @param record 假人记录
 * @param player 目标玩家
 * @returns 全部完成 resolve(true)
 * @throws ActionError 假人不在线/实体丢失/传送或姿态设置失败
 */
export async function tpBotToPlayer(record: BotRecord, player: Player): Promise<boolean> {
  if (!record.online || record.death) {
    throw new ActionError("offline", "模拟玩家不在线或已死亡");
  }
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new ActionError("unavailable", "无法在世界中找到该模拟玩家");
  }

  const bot = entity as SimulatedPlayer;
  await runActionNextTick(() => {
    bot.teleport(player.location, { dimension: player.dimension });
    bot.isSneaking = player.isSneaking;
  }, `传送假人 ${record.name} 到玩家身边失败`);
  record.isSneaking = player.isSneaking;

  // 姿态/视角/朝向：普通与常加载模式统一应用（setPose 微动作，位置照常保存）
  const lookTarget = getPlayerLookTarget(player);
  await setPose(bot, player.getRotation(), lookTarget);
  savePoseToRecord(record, player.location, player.dimension.id, player.getRotation(), lookTarget);
  saveCoordinator.saveRecord(record);
  return true;
}

// ─── UI 事件订阅（BOT 主菜单 → 感知传送/同步动作） ──────

/** 订阅 BOT 主菜单动作事件：tpToBot=传送到假人身边（离线先上线）；syncPose=假人拉到身边+姿态同步 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;

    // ── 传送过去：离线先上线（已统一为安全上线） ──
    if (e.action === "tpToBot") {
      const r = botRegistry.get(e.botName);
      if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已不存在`); return; }
      system.run(async () => {
        if (!r.online || r.death) {
          const result = await safeOnline(r);
          // 永不 reject（失败 resolve { ok: false, reason }）
          if (!result.ok) { player.sendMessage(`${color.error}${e.botName} 上线失败，无法传送: ${result.reason ?? "unknown"}`); return; }
          player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 已上线`);
          system.run(() => {
            tpPlayerToBot(player, botRegistry.get(e.botName)!)
              .then(() => player.sendMessage(`${color.success}已传送到 ${color.playerName}${e.botName}${color.success} 身边`))
              .catch((err: unknown) => player.sendMessage(`${color.error}${describeError(err)}`));
          });
        } else {
          tpPlayerToBot(player, r)
            .then(() => player.sendMessage(`${color.success}已传送到 ${color.playerName}${e.botName}${color.success} 身边`))
            .catch((err: unknown) => player.sendMessage(`${color.error}${describeError(err)}`));
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
        tpBotToPlayer(r, player)
          .then(() => player.sendMessage(`${color.success}已同步 ${color.playerName}${e.botName}${color.success} 姿态与朝向`))
          .catch((err: unknown) => player.sendMessage(`${color.error}${describeError(err)}`));
      });
    }
  });
}
