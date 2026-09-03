// ─── 控制模式 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { ActionError, describeError } from "../../errors";
import { BotRecord } from "../../rules/Types";
import { TAG_CONTROL, TAG_IDLE, EXCLUSIVE_SET, STANDALONE_SET, BOT_TAG } from "../../rules/tags/BotTags";
import { syncEntityTags } from "./EntityTags";
import { botRegistry } from "../../bootstrap/context";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "./PoseGateway";
import { runActionNextTick } from "../utils";
import { setTags } from "../state/setTags";

/**
 * 切换体态控制模式（开启=贴身跟随控制器视角；关闭=回到空闲）。
 * 传送/姿态为微动作（system.run 下一 tick 执行，成功 resolve(true)）；
 * 引擎异常内部消化转 ActionError；标签校验拒绝仍走玩家消息。
 * @param record 假人记录
 * @param player 控制者玩家
 * @returns 切换完成 resolve(true)
 * @throws ActionError 开启控制时的实体传送/姿态设置失败
 */
export async function toggleControl(record: BotRecord, player: Player): Promise<boolean> {
  const hasControl = record.tags.includes(TAG_CONTROL.value);
  let newTags: string[];

  if (hasControl) {
    // 关闭控制：只移除 control，保留其他标签
    newTags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    // 空闲兜底：无独立开关标签（互斥组已清空——行为统一走 workMode 字段）
    // 时补 idle（与 computeTagsFromBehaviorForm 兜底语义对齐）
    const hasExclusive = newTags.some((t) => EXCLUSIVE_SET.has(t) || STANDALONE_SET.has(t));
    if (!hasExclusive) {
      newTags.push(TAG_IDLE.value);
    }
    const rejected = setTags(record, newTags);
    if (rejected) { player.sendMessage(`${color.error}${rejected}`); return false; }
    return true;
  }

  // 开启控制：移除所有互斥标签，设置 control
  newTags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
  if (!newTags.includes(TAG_CONTROL.value)) {
    newTags.push(TAG_CONTROL.value);
  }
  const rejected = setTags(record, newTags, player);
  if (rejected) { player.sendMessage(`${color.error}${rejected}`); return false; }

  // 立即同步一次体态（微动作：下一 tick 执行，异常转 ActionError）
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (entity && entity.hasTag(BOT_TAG)) {
    const bot = entity as SimulatedPlayer;
    const playerRot = player.getRotation();
    const lookTarget = getPlayerLookTarget(player);
    await runActionNextTick(() => {
      bot.teleport(player.location, { dimension: player.dimension });
    }, `假人 ${record.name} 传送到控制者身边失败`);

    // 姿态统一应用（setPose 微动作，位置照常保存）
    try {
      await setPose(bot, playerRot, lookTarget);
    } catch (e: unknown) {
      console.warn(`[MockPlayer] 控制模式体态同步失败: ${describeError(e)}`);
    }
    savePoseToRecord(record, player.location, player.dimension.id, playerRot, lookTarget);
  }
  return true;
}
