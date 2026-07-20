// ─── 控制模式 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { TAG_CONTROL, TAG_IDLE, EXCLUSIVE_SET, BOT_TAG, syncEntityTags } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";
import { setPose, getPlayerLookTarget, savePoseToRecord } from "./core/pose";
import { setTags } from "./setTags";

export function toggleControl(record: BotRecord, player: Player): void {
  const hasControl = record.tags.includes(TAG_CONTROL.value);
  let newTags: string[];

  if (hasControl) {
    // 关闭控制：只移除 control，保留其他标签
    newTags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    // 确保至少有一个互斥标签兜底
    const hasExclusive = newTags.some((t) => EXCLUSIVE_SET.has(t));
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

      // 强加载模式不可转向
      if (record.spawnMode !== "chunkload") {
        setPose(bot, player.getRotation(), getPlayerLookTarget(player));
        savePoseToRecord(record, player.location, player.dimension.id, player.getRotation());
      } else {
        savePoseToRecord(record, player.location, player.dimension.id);
      }
    }
  }
}
