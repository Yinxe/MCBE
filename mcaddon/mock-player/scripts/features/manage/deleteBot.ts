// ─── 删除假人（组件化代理） ─────────────────
// 原删除逻辑已收敛至 BotLifecycle.delete + Cleanup/Persistence 组件。
// 本文件保留同步薄壳以兼容旧调用（命令/UI 直接调 deleteBot 为同步 void）。
// 同步包装内异步委托由 system.run 兜底，调用方无需改动。

import type { Player } from "@minecraft/server";
import type { BotRecord } from "../../rules/Types";

/**
 * 删除假人（同步兼容壳，内部异步委托至编排器）。
 * @param record 假人记录
 * @param reclaimTo 回收目标玩家（可选）
 */
export function deleteBot(record: BotRecord, reclaimTo?: Player): void {
  // 同步入口需立即返回，异步工作丢给编排器（队列保证串行）
  // 使用 dynamic import 避免循环，同时用 system.run 确保世界上下文安全
  void (async () => {
    const { botLifecycle } = await import("../../bootstrap/context");
    const { system } = await import("@minecraft/server");
    // 若已在 system.run 上下文中，直接调用；否则包一层
    const doDelete = async () => {
      const res = await botLifecycle.delete(record, reclaimTo as any);
      if (!res.ok) console.warn(`[MockPlayer] deleteBot 失败 ${record.name}: ${res.reason}`);
    };
    try {
      // 尝试直接执行，失败则调度到下一 tick
      await doDelete();
    } catch {
      system.run(() => { void doDelete(); });
    }
  })();
}

/** 异步版本（供新代码直接 await） */
export async function deleteBotAsync(record: BotRecord, reclaimTo?: Player): Promise<{ ok: boolean; reason?: string }> {
  const { botLifecycle } = await import("../../bootstrap/context");
  return botLifecycle.delete(record, reclaimTo as any);
}
