// ─── 击杀假人（组件化代理） ───────────────
// 核心击杀逻辑已迁移至 BotLifecycle.kill（触发 beforeKill 钩子 + LifecycleEvents.beforeKill）。
// 本文件保留兼容壳与 UI 订阅。

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { BotRecord } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry } from "../../bootstrap/context";

export function killBot(record: BotRecord): void {
  // 同步兼容：内部委托编排器异步，抛错保持同步语义（未找到实体时同步抛）
  const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
  if (!entity || !(entity as any).hasTag?.(BOT_TAG)) {
    throw new Error("无法在世界中找到该模拟玩家");
  }
  // 异步触发编排器钩子（不阻塞 kill 动作本身）
  void (async () => {
    const { botLifecycle } = await import("../../bootstrap/context");
    const res = await botLifecycle.kill(record);
    if (!res.ok) console.warn(`[MockPlayer] killBot 编排失败 ${record.name}: ${res.reason}`);
  })();
  (entity as SimulatedPlayer).kill();
}

/** 异步版本（编排器直通） */
export async function killBotAsync(record: BotRecord): Promise<{ ok: boolean; reason?: string }> {
  const { botLifecycle } = await import("../../bootstrap/context");
  return botLifecycle.kill(record);
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
