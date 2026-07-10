// ─── 标签更新（运行时） ─────────────────────────────────

import { world } from "@minecraft/server";

import { BotRecord } from "./core/types";
import { TAG_CONTROL, BOT_TAG, syncEntityTags } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";

export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: any): void {
  const hadControl = record.tags.includes(TAG_CONTROL.value);
  const hasControlNow = newTags.includes(TAG_CONTROL.value);

  record.tags = newTags;

  if (!hasControlNow) {
    record.controllerId = undefined;
  } else if (!hadControl && controllerPlayer) {
    record.controllerId = controllerPlayer.id;
  }

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
