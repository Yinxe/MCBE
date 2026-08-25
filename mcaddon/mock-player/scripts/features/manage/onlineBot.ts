// ─── 恢复假人上线（安全上线，全量走 test + 模拟4辅助） ──────
//
// 新流程（按用户要求）：
//   1. 先上线（test 生成，实体成功创建）
//   2. 再刷新模拟4（以假人为中心 per-bot 辅助区块 `mockplayer:aux:<name>`）
//   3. 完成模拟4区块采样自检并输出 ASCII 图（仅通知主人）
//   4. 宝库模式不触发辅助区块申请与安全下线机制
//   模拟4为辅助常加载，刷新后常驻直到下线时卸载；上线本身不依赖模拟4的预先申请。

import { system, world, type Dimension, type Player, type Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry, saveCoordinator } from "../../bootstrap/context";
import { spawnBot } from "./spawnMode";
import { trackBotOnline } from "../trident/tridentTracker";
import {
  checkOnlineQuota,
  createAuxWithFallback,
  delayTicks,
  getAuxAreaName,
  getCooldownTicks,
  getPerBotQueue,
  isVaultMode,
  sampleAndSendAscii,
  setPerBotQueue,
} from "./auxiliary";

/** 上线结果（多状态，带失败原因） */
export interface OnlineResult {
  /** 是否上线成功 */
  ok: boolean;
  /** 成功时上线的假人实体 */
  bot?: SimulatedPlayer;
  /** 失败原因（异常消息/阶段说明，供日志与玩家提示） */
  reason?: string;
}

/** 内部：原始上线（无模拟4、无排队、无等待） */
async function rawOnlineBot(record: BotRecord): Promise<OnlineResult> {
  try {
    const state = record.lastPoint ?? record.respawnPoint;
    const dim = world.getDimension(state.dimension);
    const bot = await spawnBot(record, state.location, dim, state.rotation, state.lookTarget);
    record.online = true;
    record.death = false;
    saveCoordinator.saveRecord(record);
    trackBotOnline(bot.id, record.name);
    console.info(
      `[MockPlayer] 上线假人 ${record.name} 模式=${record.spawnMode ?? "normal"}` +
        `（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`
    );
    return { ok: true, bot };
  } catch (e: any) {
    console.error(`[MockPlayer] onlineBot 失败 ${record.name}: ${e?.message ?? e}`);
    return { ok: false, reason: e?.message ?? "unknown" };
  }
}

/**
 * 安全上线（全量走 test，模拟4为上线后刷新辅助）。
 * 新流程：rawOnline（实体成功创建）→ 若非宝库模式则刷新 per-bot 模拟4 → 采样 ASCII 仅通知主人 → 结束。
 * 模拟4常驻直到下线时卸载；失败不阻断上线。
 * ⚠️ 永不 reject：失败 resolve { ok:false, reason }
 */
export async function safeOnline(record: BotRecord): Promise<OnlineResult> {
  if (record.online) {
    return { ok: false, reason: `假人 ${record.name} 已在线` };
  }
  const quotaErr = checkOnlineQuota(record);
  if (quotaErr) return { ok: false, reason: quotaErr };

  // per-bot 串行防同名并发
  const prev = getPerBotQueue(record.name);
  let release!: () => void;
  const current = new Promise<void>((res) => (release = res));
  setPerBotQueue(record.name, current);
  try {
    await prev;
  } catch {}

  try {
    console.info(
      `[MockPlayer] safeOnline 开始 ${record.name} owner=${record.ownerName ?? "无"} tag=${record.tags.join(",")}`
    );
    // 1. 先上线（test 生成，实体成功创建）
    console.info(
      `[MockPlayer] → rawOnline ${record.name} @ ${(record.lastPoint ?? record.respawnPoint).dimension} ${Math.floor((record.lastPoint ?? record.respawnPoint).location.x)},${Math.floor((record.lastPoint ?? record.respawnPoint).location.y)},${Math.floor((record.lastPoint ?? record.respawnPoint).location.z)}`
    );
    const result = await rawOnlineBot(record);
    if (!result.ok || !result.bot) {
      console.warn(`[MockPlayer] rawOnline 失败 ${record.name}: ${result.reason}`);
      return result;
    }
    console.info(
      `[MockPlayer] rawOnline 成功 ${record.name} entityId=${result.bot.id} @ ${result.bot.dimension.id} ${Math.floor(result.bot.location.x)},${Math.floor(result.bot.location.y)},${Math.floor(result.bot.location.z)}`
    );

    // 2. 宝库模式跳过辅助
    if (isVaultMode(record)) {
      console.info(`[MockPlayer] 宝库模式 ${record.name} 跳过模拟4辅助（tags=${record.tags.join(",")}）`);
      return result;
    }
    console.info(`[MockPlayer] 非宝库，准备刷新 per-bot 模拟4 for ${record.name}`);

    // 3. 上线后刷新 per-bot 模拟4（常驻，容量不足自动回退单区块）
    const bot = result.bot;
    const areaName = getAuxAreaName(record.name);
    console.info(
      `[MockPlayer] → createAuxWithFallback(Sim4→单区块) ${areaName} @ ${bot.dimension.id} ${Math.floor(bot.location.x)},${Math.floor(bot.location.y)},${Math.floor(bot.location.z)} r=4`
    );
    const res = await createAuxWithFallback(bot.location as Vector3, bot.dimension as Dimension, areaName);
    if (!res.ok) {
      console.warn(
        `[MockPlayer] 上线后辅助区块申请失败 ${record.name}: ${res.reason}（仍保持上线，小范围已由 test 兜底）`
      );
      // 通知主人容量不足
      const ownerName = record.ownerName;
      if (ownerName) {
        const owner = world.getAllPlayers().find((p) => p.name === ownerName);
        owner?.sendMessage(`${color.warn}【${record.name}】辅助常加载申请失败: ${res.reason}，已回退小范围常加载`);
      }
      return result;
    }
    if ((res as any).fallback) {
      console.info(
        `[MockPlayer] 上线后辅助区块成功（回退单区块） ${areaName} @ ${bot.dimension.id} ${Math.floor(bot.location.x)},${Math.floor(bot.location.z)} for ${record.name}（Sim4 容量不足降级）`
      );
    } else {
      console.info(
        `[MockPlayer] 上线后刷新模拟4成功 ${areaName} @ ${bot.dimension.id} ${Math.floor(bot.location.x)},${Math.floor(bot.location.z)} for ${record.name}`
      );
    }

    // 4. 采样自检并 ASCII 输出（仅主人），稍延迟让区块完成加载
    console.info(`[MockPlayer] → 采样模拟4 ${areaName} 延迟 2t 后`);
    await delayTicks(2);
    console.info(`[MockPlayer] → sampleAndSendAscii ${record.name}`);
    sampleAndSendAscii(bot, record);
    console.info(`[MockPlayer] safeOnline 完成 ${record.name}`);

    return result;
  } catch (e: any) {
    console.error(`[MockPlayer] safeOnline 异常 ${record.name}: ${e?.message ?? e}`);
    return { ok: false, reason: e?.message ?? "unknown" };
  } finally {
    release();
  }
}

// ─── 在线配额强制执行（已抽至 auxiliary 单源，保留重导出兼容） ───────
export { enforceAllOnlineQuotas, enforceOnlineQuotaForOwner } from "./auxiliary";

// 注意：不再提供 onlineBot 别名，请直接使用 safeOnline

// ─── UI 事件订阅（BOT 主菜单 → 感知上线/下线动作，统一安全版） ──────

/** 订阅 BOT 主菜单动作：toggleOnline / safeOnline 均走安全上下线（普通/常加载统一入口） */
export function registerUiSubscriptions(): void {
  const handleOnline = async (player: Player | undefined, botName: string, isSafeButton: boolean) => {
    if (!player) return;
    const r = botRegistry.get(botName);
    if (!r) {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 不存在`);
      return;
    }
    if (r.online) {
      // 已在线时 toggle 为下线，safeOnline 按钮不应出现，但兼容处理
      const { safeOffline } = await import("./offlineBot");
      const res = await safeOffline(r);
      if (!res.ok) {
        player.sendMessage(`${color.error}${botName} 下线失败: ${res.reason ?? "unknown"}`);
        return;
      }
      player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已下线`);
      return;
    }
    // 离线 → 安全上线（safeOnline 已内置普通2s/常加载3s+模拟4）
    if (isSafeButton) player.sendMessage(`${color.muted}正在为 ${color.playerName}${r.name}${color.muted} 安全上线...`);
    const result = await safeOnline(r);
    if (!result.ok) {
      player.sendMessage(`${color.error}${botName} 上线失败: ${result.reason ?? "unknown"}`);
      return;
    }
    player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已上线`);
  };

  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action === "toggleOnline") {
      const player = world.getEntity(e.playerId) as Player | undefined;
      system.run(() => {
        handleOnline(player, e.botName, false).catch((err: any) => {
          const p = player as Player | undefined;
          p?.sendMessage(`${color.error}${err?.message ?? err}`);
        });
      });
      return;
    }
    if (e.action === "safeOnline") {
      const player = world.getEntity(e.playerId) as Player | undefined;
      system.run(() => {
        handleOnline(player, e.botName, true).catch((err: any) => {
          const p = player as Player | undefined;
          p?.sendMessage(`${color.error}${err?.message ?? err}`);
        });
      });
    }
  });
}
