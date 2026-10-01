// ─── 下线代理（组件化） ─────────────────────
// 重型 safeOffline 逻辑已迁移至 BotLifecycle + TickingArea 组件。
// 本文件保留为薄壳代理，队列、预占位、保存、卸载均由编排器与组件完成。

import type { BotRecord } from "../../rules/Types";

/** 下线结果 */
export interface OfflineResult {
  ok: boolean;
  reason?: string;
}

/**
 * 安全下线（代理至 BotLifecycle）。
 * ⚠️ 永不 throw，失败返回 { ok:false, reason }
 */
export async function safeOffline(record: BotRecord): Promise<OfflineResult> {
  const { botLifecycle } = await import("../../bootstrap/context");
  const res = await botLifecycle.offline(record);
  return res as OfflineResult;
}

/** @deprecated 保留别名 */
export const offlineBot = safeOffline;
