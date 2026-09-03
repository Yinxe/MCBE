// ─── 任务运行环境工具（flow/tasks 共用） ────────────────
// waitTicksCancellable     可取消 tick 等待（取消令牌 signal 立即唤醒）
// createThrottledNotifier  附近玩家通知（节流；任务进展可见性）
// 循环骨架/退避/收尾统一在 spec.ts（defineLoopTask），本文件只留原子工具。

import { system, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import type { CancelToken } from "../../../rules/utils/CancelToken";
import { horizontalDistance } from "../../utils";

/**
 * 可取消 tick 等待：到期或 token 取消（signal resolve）先到者唤醒；
 * 无 token 时等价 waitTicks。任务阶段的统一节奏控制。
 * @param ticks 等待时长（tick）
 * @param token 取消令牌（可选）
 */
export function waitTicksCancellable(ticks: number, token?: CancelToken): Promise<void> {
  const wait = new Promise<void>((resolve) => system.runTimeout(resolve, Math.max(0, ticks)));
  if (!token) return wait;
  return Promise.race([wait, token.signal]);
}

// ─── 附近玩家通知 ──────────────────────────────────────

/** 通知半径（格，水平距离） */
const NOTIFY_RADIUS = 16;
/** 通知节流（tick）：同一任务实例共用（每次 start 重置） */
const NOTIFY_COOLDOWN_TICKS = 100;

/** 创建节流通知器（每任务实例一个；冷却期内重复调用静默丢弃） */
export function createThrottledNotifier(): (botName: string, detail: string) => void {
  let nextAllowedTick = 0;
  return (botName: string, detail: string): void => {
    const now = system.currentTick;
    if (now < nextAllowedTick) return;
    nextAllowedTick = now + NOTIFY_COOLDOWN_TICKS;
    try {
      const self = world.getPlayers({ name: botName })[0];
      for (const p of world.getAllPlayers()) {
        if (p.id === self?.id) continue;
        if (p.dimension.id !== self?.dimension.id) continue;
        if (horizontalDistance(p.location, self?.location ?? p.location) > NOTIFY_RADIUS) continue;
        p.sendMessage(`${color.muted}[模拟玩家]${color.reset} ${color.playerName}${botName}${color.reset} ${detail}`);
      }
    } catch {
      /* 通知失败不影响任务 */
    }
  };
}
