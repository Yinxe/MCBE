// DEPRECATED: 已内聚至 lifecycle/components/InventoryComponent，外部不再直接订阅。
// 本文件保留兼容空实现，避免旧调用在生命周期之外重复保存背包/装备。

import type { PlayerInventoryItemChangeAfterEvent } from "@minecraft/server";

export function onPlayerInventoryItemChange(_event: PlayerInventoryItemChangeAfterEvent): void {
  // no-op: 实际逻辑在 InventoryComponent
}
