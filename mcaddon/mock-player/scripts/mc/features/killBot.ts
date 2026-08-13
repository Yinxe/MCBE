// ─── 杀死假人 ──────────────────────────────────────────

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";
import { BotUiEvent } from "../../core/events/UiEvents";
import { botManager } from "../bot/BotManager";
import { botRegistry } from "../bootstrap/context";

export function killBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  (entity as SimulatedPlayer).kill();
}

// ─── UI 事件订阅（BOT 主菜单 → 感知击杀动作） ──────────

/** 订阅 BOT 主菜单动作事件：击杀假人（经 MockBot 实例；在线且未死亡） */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "kill") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const record = botRegistry.get(e.botName);
    if (!record) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已被删除`); return; }
    if (!record.online || record.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
    system.run(() => {
      try {
        botManager.getOrCreate(record).kill();
        player.sendMessage(`${color.success}已杀死 ${color.playerName}${e.botName}`);
      } catch (err: any) { player.sendMessage(`${color.error}${err?.message ?? err}`); }
    });
  });
}
