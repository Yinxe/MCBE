// ─── 标签更新（运行时） ─────────────────────────────────

import { world } from "@minecraft/server";

import { BotRecord } from "../../core/model/Types";
import { TAG_CONTROL, TAG_VAULT_MODE, BOT_TAG } from "../../core/tags/BotTags";
import { syncEntityTags } from "../adapters/EntityTags";
import { saveCoordinator } from "../bootstrap/context";
import { color } from "@yinxe/toolkit";

/**
 * 更新假人标签（运行时）。
 * @returns 拒绝原因（未通过校验时）；undefined = 成功
 */
export function setTags(record: BotRecord, newTags: string[], controllerPlayer?: any): string | undefined {
  // 宝库模式只允许普通模式
  if (newTags.includes(TAG_VAULT_MODE.value) && record.spawnMode === "chunkload") {
    const msg = "宝库模式需要普通生成模式，请先切换为普通模式";
    if (controllerPlayer) {
      controllerPlayer.sendMessage(`${color.error}${msg}`);
    }
    return msg;
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
  return undefined;
}
