// ─── 杀死假人 ──────────────────────────────────────────

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry } from "../../bootstrap/context";

export function killBot(record: BotRecord): void {
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  (entity as SimulatedPlayer).kill();
}

// ─── UI 事件订阅（BOT 主菜单 → 感知击杀动作） ──────────

/** 订阅 BOT 主菜单动作事件：击杀假人（在线且未死亡） */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "kill") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const r = botRegistry.get(e.botName);
    if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${e.botName}${color.error} 已被删除`); return; }
    if (!r.online || r.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
    system.run(() => {
      try {
        killBot(r);
        player.sendMessage(`${color.success}已杀死 ${color.playerName}${e.botName}`);
      } catch (err: any) { player.sendMessage(`${color.error}${err?.message ?? err}`); }
    });
  });
}
