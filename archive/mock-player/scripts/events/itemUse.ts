// DEPRECATED: 木棍菜单唯一注册点已迁移至 interaction/ui/menuTrigger.ts
// 此文件保留兼容，实际 itemUse 订阅由 menuTrigger.ts 单例处理，避免重复订阅导致双层菜单

export function onItemUse(): void {
  // no-op: 实际逻辑在 menuTrigger.ts
}
