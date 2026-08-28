// DEPRECATED: 已内聚至 lifecycle/components/AutoOnlineComponent.onWorldLoad，外部不再直接调用。
// 本文件保留兼容空实现，避免旧调用与 AutoOnlineComponent 重复上线。

export async function initAutoOnline(): Promise<void> {
  // no-op: 实际逻辑在 AutoOnlineComponent
}
