// ─── 上线代理（组件化） ─────────────────────
// 旧的重型 safeOnline 逻辑已拆至 lifecycle/BotLifecycle + TickingArea/Quota 组件。
// 本文件保留为薄壳代理，保持对外 OnlineResult 签名与永不 reject 约定。
// 队列、配额守卫、生成、辅助常加载均由编排器与组件协同完成。

import { system, world, type Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { BotRecord } from "../../rules/Types";
import { BotUiEvent } from "../../events/UiEvents";
import { botRegistry } from "../../bootstrap/context";

/** 上线结果（多状态，带失败原因） */
export interface OnlineResult {
  /** 是否上线成功 */
  ok: boolean;
  /** 成功时上线的假人实体 */
  bot?: SimulatedPlayer;
  /** 失败原因（异常消息/阶段说明，供日志与玩家提示） */
  reason?: string;
}

/**
 * 安全上线（代理至 BotLifecycle）。
 * ⚠️ 永不 reject：失败 resolve { ok:false, reason }
 */
export async function safeOnline(record: BotRecord): Promise<OnlineResult> {
  const { botLifecycle } = await import("../../bootstrap/context");
  const res = await botLifecycle.online(record);
  return res as OnlineResult;
}

/** @deprecated 保留别名，统一走 safeOnline */
export const onlineBot = safeOnline;

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
