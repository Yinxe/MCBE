// ─── 共享运行时包的对外入口 ────────────────────────────────────
//
// 本包只承载「多个行为包都要用、且与具体模组无关」的运行时能力:
// 文本样式码、跨包 HUD 逐玩家优先级仲裁。
//
// 刻意不包含的内容(留在各模组内或按需再抽):
//   · 表单构建器(ModalFormBuilder / ActionFormBuilder / MessageFormBuilder)
//   · 命令注册封装(defineCommand)
//   · 玩家权限判定(canManage)
// 这些要么与具体模组的交互设计强耦合,要么尚未被第二个模组使用。

export { color, style } from "./color";
export { HudManager, HUD_SLOTS } from "./HudManager";
export type { HudSlot, HudSource, SidebarView, HudManagerOptions } from "./HudManager";
export { isStale, pickWinner } from "./arbiter";
export type { BusClaim } from "./arbiter";
