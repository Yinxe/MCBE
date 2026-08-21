// ─── 恢复假人上线（安全上线，含模拟4） ─────────────────
//
// 安全上线流程已合并至本模块，原 safeOnline 能力现由 safeOnline 直接提供：
//   - 常加载模式：申请模拟4(固定名排队) → 上线假人 → 等待3秒 → 卸载模拟4(假人继承)
//   - 普通模式  ：上线假人 → 等待2秒 → 结束
//   无论成功/失败，已申请的区域必定卸载（finally）。
//   非排队批量场景无需额外冷却，等待已内置于本流程。
//
// 资源限制：常加载路径使用固定名 `mockplayer:safe_online`，全局互斥排队；
//          普通路径无常加载，无需排队。
// 跨维度：tickingArea 已封装 `execute in <dimension> run ...`

import { system, world, type Player } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry, configStore, saveCoordinator } from "../../bootstrap/context";
import { spawnBot } from "./spawnMode";
import { trackBotOnline } from "../trident/tridentTracker";
import {
  createSim4Area,
  removeSim4Area,
  SAFE_ONLINE_TICKING_AREA_NAME,
} from "./tickingArea";

/** 上线结果（多状态，带失败原因） */
export interface OnlineResult {
  /** 是否上线成功 */
  ok: boolean;
  /** 成功时上线的假人实体 */
  bot?: SimulatedPlayer;
  /** 失败原因（异常消息/阶段说明，供日志与玩家提示） */
  reason?: string;
}

/** 等待指定 tick（Promise） */
function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}
function getCooldownTicks(): number {
  const sec = configStore.getSafeCooldownSeconds();
  return Math.max(1, Math.min(5, sec)) * 20;
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
        `（${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)}）`,
    );
    return { ok: true, bot };
  } catch (e: any) {
    console.error(`[MockPlayer] onlineBot 失败 ${record.name}: ${e?.message ?? e}`);
    return { ok: false, reason: e?.message ?? "unknown" };
  }
}

/** 安全上线队列（固定名 mockplayer:safe_online 互斥） */
let safeOnlineQueue: Promise<void> = Promise.resolve();

export function isSafeOnlineBusy(): boolean {
  try {
    return world.tickingAreaManager.hasTickingArea(SAFE_ONLINE_TICKING_AREA_NAME);
  } catch {
    return false;
  }
}
export function getSafeOnlineAreaName(): string {
  return SAFE_ONLINE_TICKING_AREA_NAME;
}

/**
 * 安全上线（统一入口，处理所有模式，原 onlineBot 已迁移至此）。
 * - 常加载：排队 → 申请模拟4 → rawOnline → 等待3秒(60tick) → 卸载 → 继承
 * - 普通  ：rawOnline → 等待2秒(40tick)
 * 无论成功/失败，已申请的区域必定卸载。
 * ⚠️ 永不 reject：失败 resolve { ok:false, reason }
 */
export async function safeOnline(record: BotRecord): Promise<OnlineResult> {
  if (record.online) {
    return { ok: false, reason: `假人 ${record.name} 已在线` };
  }
  const isChunkload = (record.spawnMode ?? "normal") === "chunkload";
  if (!isChunkload) {
    // 普通模式：直接上线 + 等待2秒
    const result = await rawOnlineBot(record);
    await delayTicks(getCooldownTicks());
    return result;
  }

  // ── 常加载：排队独占固定名区域 ──
  let release!: () => void;
  const current = new Promise<void>((res) => (release = res));
  const prev = safeOnlineQueue;
  safeOnlineQueue = prev.then(() => current).catch(() => current);
  try {
    await prev;
  } catch {
    // 忽略前序异常
  }

  let areaCreated = false;
  let areaDim: any = undefined;
  let waited = false;
  let finalResult: OnlineResult | undefined;
  try {
    const state = record.lastPoint ?? record.respawnPoint;
    if (!state) {
      finalResult = { ok: false, reason: "无可用位置（lastPoint/respawnPoint 缺失）" };
      return finalResult;
    }
    let dimension: any;
    try {
      dimension = world.getDimension(state.dimension);
      areaDim = dimension;
    } catch (e: any) {
      finalResult = { ok: false, reason: `维度无效 ${state.dimension}: ${e?.message ?? e}` };
      return finalResult;
    }

    const createRes = await createSim4Area(state.location, dimension, SAFE_ONLINE_TICKING_AREA_NAME);
    if (!createRes.ok) {
      console.warn(`[MockPlayer] 安全上线创建模拟4失败 ${record.name}: ${createRes.reason}`);
      finalResult = { ok: false, reason: `创建常加载区域失败: ${createRes.reason}` };
      return finalResult;
    }
    areaCreated = true;
    console.info(
      `[MockPlayer] 安全上线已申请模拟4 ${SAFE_ONLINE_TICKING_AREA_NAME} @ ${state.dimension} ${Math.floor(state.location.x)} ${Math.floor(state.location.y)} ${Math.floor(state.location.z)} for ${record.name}`,
    );

    finalResult = await rawOnlineBot(record);
    // 等待3秒再卸载，让区块稳定由假人继承
    await delayTicks(getCooldownTicks());
    waited = true;

    const removeRes = removeSim4Area(SAFE_ONLINE_TICKING_AREA_NAME, dimension);
    if (!removeRes.ok) {
      console.warn(`[MockPlayer] 安全上线移除模拟4失败 ${record.name}: ${removeRes.reason}`);
    } else {
      console.info(`[MockPlayer] 安全上线已移除模拟4 ${SAFE_ONLINE_TICKING_AREA_NAME} for ${record.name}`);
    }
    areaCreated = false;
    return finalResult;
  } catch (e: any) {
    console.error(`[MockPlayer] safeOnline 异常 ${record.name}: ${e?.message ?? e}`);
    finalResult = { ok: false, reason: e?.message ?? "unknown" };
    // 若已创建区域但尚未等待/卸载，补等待再卸
    if (areaCreated && !waited) {
      try {
        await delayTicks(getCooldownTicks());
      } catch {}
      waited = true;
    }
    if (areaCreated) {
      try {
        const r = removeSim4Area(SAFE_ONLINE_TICKING_AREA_NAME, areaDim);
        if (!r.ok) console.warn(`[MockPlayer] 安全上线兜底移除失败 ${record.name}: ${r.reason}`);
      } catch (ee: any) {
        console.warn(`[MockPlayer] 安全上线兜底异常 ${record.name}: ${ee?.message ?? ee}`);
      }
      areaCreated = false;
    }
    return finalResult;
  } finally {
    if (areaCreated) {
      // 异常分支且未在 catch 中处理（如提前 return 前的 finally）
      if (!waited) {
        try {
          await delayTicks(getCooldownTicks());
        } catch {}
      }
      try {
        const r = removeSim4Area(SAFE_ONLINE_TICKING_AREA_NAME, areaDim);
        if (!r.ok) console.warn(`[MockPlayer] 安全上线 finally 兜底移除失败 ${record.name}: ${r.reason}`);
      } catch (e: any) {
        console.warn(`[MockPlayer] 安全上线 finally 兜底异常 ${record.name}: ${e?.message ?? e}`);
      }
    }
    release();
  }
}

// 注意：不再提供 onlineBot 别名，请直接使用 safeOnline

/**
 * 世界加载时的残留清理：若上次异常残留固定名区域，尝试移除（幂等）。
 * 供 main.ts worldLoad 阶段调用。
 */
export function cleanupSafeOnlineArea(): void {
  try {
    const r = removeSim4Area(SAFE_ONLINE_TICKING_AREA_NAME);
    if (r.ok) console.info(`[MockPlayer] 已清理残留安全上线常加载区域 ${SAFE_ONLINE_TICKING_AREA_NAME}`);
  } catch {}
  try {
    if (world.tickingAreaManager.hasTickingArea(SAFE_ONLINE_TICKING_AREA_NAME)) {
      world.tickingAreaManager.removeTickingArea(SAFE_ONLINE_TICKING_AREA_NAME);
      console.info(`[MockPlayer] 已清理残留 Manager 区域 ${SAFE_ONLINE_TICKING_AREA_NAME}`);
    }
  } catch {}
}

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
