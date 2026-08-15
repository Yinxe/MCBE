// ─── 恢复假人上线 ──────────────────────────────────────

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { spawnBot } from "./spawnMode";
import { offlineBot } from "./offlineBot";
import { trackBotOnline } from "../trident/tridentTracker";

/**
 * 恢复离线假人上线（异步：生成前会等待名称唯一，见 spawnMode）
 * - 根据 spawnMode 选择普通/强加载模式
 * - 从记录中取最后位置/重生点
 * - 背包/装备/经验由后续的 playerJoin 事件恢复
 * - 反查表供 entitySpawn 标记三叉戟用；认主在 playerJoin 中统一处理
 */
export async function onlineBot(record: BotRecord): Promise<SimulatedPlayer> {
  const state = record.lastPoint ?? record.respawnPoint;
  const dim = world.getDimension(state.dimension);

  const bot = await spawnBot(record, state.location, dim, state.rotation, state.lookTarget);

  // spawn 成功后（名称唯一）再置在线状态
  record.online = true;
  record.death = false;
  // ⚠️ 显式持久化在线状态：不依赖 spawn 后 playerJoin 事件落库的隐式时序
  //（若 playerJoin 未如期触发，DB 里 online 保持旧值，重启后假人状态与实体不一致）
  saveCoordinator.saveRecord(record);

  // 加入反查表（entityId → botName），供 entitySpawn 标记三叉戟用
  trackBotOnline(bot.id, record.name);

  console.info(
    `[MockPlayer] 上线假人 ${record.name} 模式=${record.spawnMode ?? "normal"}` +
    `（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`,
  );
  return bot;
}

// ─── UI 事件订阅（BOT 主菜单 → 感知上线/下线动作） ──────

/** 订阅 BOT 主菜单动作事件：上线/下线切换 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "toggleOnline") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const r = botRegistry.get(e.botName);
    if (!r) return;
    system.run(() => {
      try {
        if (r.online) {
          offlineBot(r);
          player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 已下线`);
        } else {
          onlineBot(r)
            .then(() => player.sendMessage(`${color.success}${color.playerName}${e.botName}${color.success} 已上线`))
            .catch((err: any) => player.sendMessage(`${color.error}${err?.message ?? err}`));
        }
      } catch (err: any) { player.sendMessage(`${color.error}${err?.message ?? err}`); }
    });
  });
}
