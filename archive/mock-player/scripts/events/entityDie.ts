// DEPRECATED: 已内聚至 lifecycle/components/DeathComponent，外部不再直接订阅。
// 本文件保留兼容空实现，避免旧调用在生命周期之外重复触发 botDeath/botOffline。

import type { EntityDieAfterEvent } from "@minecraft/server";

export function onEntityDie(_event: EntityDieAfterEvent): void {
  // no-op: 实际逻辑在 DeathComponent
}
