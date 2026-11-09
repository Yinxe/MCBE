// ─── 模组通用共享包的对外入口 ────────────────────────────────────
//
// 本包承载「多个行为包都要用、且与具体模组无关」的通用能力:
//   · 文本样式码,以及跨包 HUD 逐玩家优先级仲裁;
//   · 三类表单的封装、安全上下文执行助手、界面消息助手。
//
// 刻意不包含的内容(留在各模组内):
//   · 命令注册封装(defineCommand 等价物,各模组自己写)
//   · 玩家权限判定(canManage 这类模组级策略)
//
// 只依赖官方 Script API,不引入任何第三方运行时库。

// 文本样式码
export { color, style } from "./color";

// 跨包 HUD 逐玩家优先级仲裁
export { HudManager, HUD_SLOTS } from "./HudManager";
export type { HudSlot, HudSource, SidebarView, HudManagerOptions } from "./HudManager";
export { isStale, pickWinner } from "./arbiter";
export type { BusClaim } from "./arbiter";

// 三类表单构建器
export { ModalFormBuilder } from "./ModalFormBuilder";
export type { ModalFormValues } from "./ModalFormBuilder";
export {
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
} from "./ModalFormBuilder";
export { ActionFormBuilder } from "./ActionFormBuilder";
export { MessageFormBuilder } from "./MessageFormBuilder";

// 安全上下文执行助手
export { runSafe, runSafeDetached } from "./runSafe";
export type { ErrorHandler } from "./runSafe";
export { createRunSafe } from "./runSafeCore";
export type { Scheduler } from "./runSafeCore";
export { parseModalValues, isValueField } from "./formValues";
export type { FieldKind, FieldSpec, FormValues } from "./formValues";

// 界面消息助手
export { trySendMessage, notifySuccess, notifyError } from "./message";
