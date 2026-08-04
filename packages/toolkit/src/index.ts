// ─── 运行时统一导出 ──────────────────────────────────────

export { color, style, actionFormFg } from "./color";
export { canManage } from "./player";
export { defineCommand, type CommandContext } from "./command";
export { EventSignal, CancelableEventSignal, type CancelableEvent } from "./events";
export {
  ActionFormBuilder,
  MessageFormBuilder,
  ModalFormBuilder,
  runSafeAsync,
  trySendMessage,
  notifySuccess,
  notifyError,
  type ModalFormValues,
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
} from "./ui";
