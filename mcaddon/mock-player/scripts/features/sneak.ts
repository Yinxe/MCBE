// ─── 潜行 ──────────────────────────────────────────────

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "./core/types";
import { BOT_TAG, syncEntityTags } from "./core/tags";
import { botRegistry, saveBotRecord } from "./core/persistence";

export function setSneaking(record: BotRecord, sneaking: boolean): void {
  record.isSneaking = sneaking;

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as SimulatedPlayer).isSneaking = sneaking;
      syncEntityTags(entity, record.tags);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);
}
