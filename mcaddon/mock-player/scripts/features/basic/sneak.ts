// ─── 潜行 ──────────────────────────────────────────────

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { syncEntityTags } from "./EntityTags";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";

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

// ─── UI 事件订阅（行为菜单提交 → 感知潜行字段） ────────

/** 订阅行为菜单提交事件：潜行开关 diff 后同步 */
export function registerUiSubscriptions(): void {
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    const record = botRegistry.get(e.botName);
    if (!record || record.isSneaking === e.sneaking) return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    system.run(() => {
      try {
        setSneaking(record, e.sneaking);
      } catch (err: any) {
        player?.sendMessage(`${color.error}切换潜行失败: ${err?.message ?? err}`);
      }
    });
  });
}
