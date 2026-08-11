// ─── @yinxe/toolkit 屏幕显示模块 ──────────────────────────────
// 跨包 /scriptevent 总线 + 逐玩家优先级仲裁（actionbar / title / sidebar）。
export { HudManager, HUD_SLOTS } from "./HudManager";
export type { HudSlot, HudSource, SidebarView, HudManagerOptions } from "./HudManager";
export { pickWinner, isStale, type BusClaim } from "./arbiter";
export { isWithinRange, type Vec3, type RangeProbe, type RangeCenter } from "./range";