// ─── 控制模式 ──────────────────────────────────────────

import { Player, world } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { TAG_CONTROL, TAG_IDLE, EXCLUSIVE_SET, BOT_TAG, syncEntityTags } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";
import { getPlayerLookTarget } from "./core/utils";

export function toggleControl(record: BotRecord, player: Player): void {
  const hasControl = record.tags.includes(TAG_CONTROL.value);

  if (hasControl) {
    // 关闭控制
    record.tags = record.tags.filter((t) => t !== TAG_CONTROL.value);
    record.controllerId = undefined;

    const hasExclusive = record.tags.some((t) => EXCLUSIVE_SET.has(t));
    if (!hasExclusive) {
      record.tags.push(TAG_IDLE.value);
    }
  } else {
    // 开启控制
    record.tags = record.tags.filter((t) => !EXCLUSIVE_SET.has(t));
    if (!record.tags.includes(TAG_CONTROL.value)) {
      record.tags.push(TAG_CONTROL.value);
    }
    record.controllerId = player.id;

    // 立即同步一次体态
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
      const lookTarget = getPlayerLookTarget(player);
      (entity as SimulatedPlayer).teleport(player.location, { rotation: player.getRotation() });
      (entity as SimulatedPlayer).lookAtLocation(lookTarget, LookDuration.Continuous);
    }
  }

  // 同步标签到实体
  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
