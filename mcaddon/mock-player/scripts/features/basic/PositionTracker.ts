// DEPRECATED: 已内聚至 lifecycle/components/PositionComponent，外部不再直接订阅。
// 本文件保留兼容空实现，避免旧调用额外订阅 botMoved 导致位置重复落库。

export function initPositionTracker(): void {
  // no-op: 实际订阅在 PositionComponent
}
