// DEPRECATED: 已内聚至 lifecycle/components/SessionComponent，外部不再直接订阅。
// 本文件保留兼容空实现，避免旧调用在生命周期之外重复触发 botOffline。

import type { PlayerLeaveAfterEvent } from "@minecraft/server";

export function onPlayerLeave(_event: PlayerLeaveAfterEvent): void {
  // no-op: 实际逻辑在 SessionComponent
}
