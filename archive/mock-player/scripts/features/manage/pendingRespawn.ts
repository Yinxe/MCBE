// ─── 断开重连（组件化代理） ─────────────────
// 原重连流程已收敛至 BotLifecycle.reconnect（编排器统一队列 + LifecycleEvents）。
// 本文件保留兼容壳，供外部抑制消息的 Set 与原签名保持一致，实际 Set 与 LifecycleContext.reconnecting 共享同一实例。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { BotRecord } from "../../rules/Types";

import { reconnectingBots } from "../../bootstrap/context";
export { reconnectingBots };

export interface SafeReconnectOptions {
  onOffline?: (record: BotRecord) => void;
  onOnline?: (bot: SimulatedPlayer, record: BotRecord) => void;
}

/**
 * 安全重连（代理至 BotLifecycle.reconnect）。
 * 保留原签名：同步返回，无需 await。
 */
export function safeReconnect(record: BotRecord, options?: SafeReconnectOptions): void {
  void (async () => {
    const { botLifecycle } = await import("../../bootstrap/context");
    if (botLifecycle.isReconnecting(record.name)) {
      console.warn(`[MockPlayer] safeReconnect 跳过 ${record.name}——已有重连在进行`);
      return;
    }
    try {
      await botLifecycle.reconnect(record, options as any);
    } catch {}
  })();
}
