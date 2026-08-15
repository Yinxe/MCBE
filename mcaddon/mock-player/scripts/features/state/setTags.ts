// ─── 标签更新（运行时） ─────────────────────────────────

import { world } from "@minecraft/server";

import { BotRecord } from "../../rules/Types";
import { TAG_CONTROL, BOT_TAG } from "../../rules/tags/BotTags";
import { syncEntityTags } from "../basic/EntityTags";
import { saveCoordinator } from "../../bootstrap/context";

/**
 * 更新假人标签（运行时）。
 * @returns 拒绝原因（未通过校验时）；undefined = 成功
 */
export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: any): string | undefined {
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
  return undefined;
}
