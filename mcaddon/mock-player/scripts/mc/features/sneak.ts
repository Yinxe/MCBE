// ─── 潜行 ──────────────────────────────────────────────

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { syncEntityTags } from "../adapters/EntityTags";
import { saveCoordinator } from "../bootstrap/context";

export function setSneaking(record: BotRecord, sneaking: boolean): void {
  record.isSneaking = sneaking;

  if (record.online) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as SimulatedPlayer).isSneaking = sneaking;
      syncEntityTags(entity, record.tags);
    }
  }

  saveCoordinator.saveRecord(record);
}
