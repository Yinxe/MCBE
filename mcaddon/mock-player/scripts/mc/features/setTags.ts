// ─── 标签更新（运行时） ─────────────────────────────────

import { world } from "@minecraft/server";

import { BotRecord } from "../../core/model/Types";
import { TAG_CONTROL, TAG_VAULT_MODE, BOT_TAG } from "../../core/tags/BotTags";
import { syncEntityTags } from "../adapters/EntityTags";
import { saveCoordinator } from "../bootstrap/context";
import { color } from "@yinxe/toolkit";

export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: any): void {
  // 宝库模式只允许普通模式
  if (newTags.includes(TAG_VAULT_MODE.value) && record.spawnMode === "chunkload") {
    if (controllerPlayer) {
      controllerPlayer.sendMessage(`${color.error}宝库模式需要普通生成模式，请先切换为普通模式`);
    }
    return;
  }
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

  saveCoordinator.saveRecord(record);
}
