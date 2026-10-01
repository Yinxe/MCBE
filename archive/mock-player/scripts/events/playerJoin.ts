// DEPRECATED: 已内聚至 lifecycle/components/SessionComponent，外部不再直接订阅。
// 本文件保留兼容空实现，避免旧调用在生命周期之外重复触发 botOnline / 重复恢复背包/经验。

import type { PlayerJoinAfterEvent } from "@minecraft/server";

export function onPlayerJoin(_event: PlayerJoinAfterEvent): void {
  // no-op: 实际逻辑在 SessionComponent
}
