// ─── 共享界面包的对外入口 ────────────────────────────────────────
//
// 本包只承载「多个行为包都要用、且与具体模组无关」的界面能力:
// 三类表单的封装、安全上下文执行助手、界面消息助手。
//
// 刻意不包含的内容(留在 @mc-toolchain/shared 或各模组内):
//   · 文本样式码与 HUD 仲裁(属于 @mc-toolchain/shared)
//   · 命令注册封装(defineCommand 等价物,各模组自己写)
//   · 玩家权限判定(canManage 这类模组级策略)
//
// 只依赖官方 Script API,不引入任何第三方运行时库。

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
export { runSafe, runSafeDetached } from "./runSafe";
export type { ErrorHandler } from "./runSafe";
export { createRunSafe } from "./runSafeCore";
export type { Scheduler } from "./runSafeCore";
export { parseModalValues, isValueField } from "./formValues";
export type { FieldKind, FieldSpec, FormValues } from "./formValues";
export { trySendMessage, notifySuccess, notifyError } from "./message";
