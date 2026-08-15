// ─── 控制模式 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../rules/Types";
import { TAG_CONTROL, TAG_IDLE, EXCLUSIVE_SET, STANDALONE_SET, BOT_TAG } from "../../rules/tags/BotTags";
import { syncEntityTags } from "./EntityTags";
import { botRegistry } from "../../bootstrap/context";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "./PoseGateway";
import { setTags } from "../state/setTags";

export function toggleControl(record: BotRecord, player: Player): void {
  const hasControl = record.tags.includes(TAG_CONTROL.value);
  let newTags: string[];

  if (hasControl) {
    // 关闭控制：只移除 control，保留其他标签
    newTags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    // 确保至少有一个互斥/独立开关标签兜底（如劫掠模式开启中则不强制补 idle）
    const hasExclusive = newTags.some((t) => EXCLUSIVE_SET.has(t) || STANDALONE_SET.has(t));
    if (!hasExclusive) {
      newTags.push(TAG_IDLE.value);
    }
    setTags(record, newTags);
  } else {
    // 开启控制：移除所有互斥标签，设置 control
    newTags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
    if (!newTags.includes(TAG_CONTROL.value)) {
      newTags.push(TAG_CONTROL.value);
    }
    setTags(record, newTags, player);

    // 立即同步一次体态
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      const bot = entity as SimulatedPlayer;
      bot.teleport(player.location, { dimension: player.dimension });

      // 姿态统一应用（setPose 内部 try-catch 防御，位置照常保存）
      setPose(bot, player.getRotation(), getPlayerLookTarget(player));
      savePoseToRecord(record, player.location, player.dimension.id, player.getRotation());
    }
  }
}
