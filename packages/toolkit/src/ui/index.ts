// @yinxe/toolkit UI 模块
// 对 @minecraft/server-ui（v2.0.0）的全功能封装。
//
// ── 封装内容 ──
// ActionFormBuilder   —— ActionFormData 回调式封装
//   布局: .title(), .header(), .body(), .divider()
//   按钮: .button(label, callback?), .buttonWithIcon(label, iconPath, callback?)
//         iconPath 为 RP 纹理路径，如 "textures/ui/icon_settings"
//
// MessageFormBuilder  —— MessageFormData 封装
//   布局: .title(), .body()
//   按钮: .confirmButton(label, callback?)  button1 右侧
//         .cancelButton(label, callback?)   button2 左侧
//
// ModalFormBuilder    —— ModalFormData 命名访问封装
//   布局: .title(), .header(), .label(), .divider(), .submitButton()
//   字段: .textField(), .textFieldWithPlaceholder(), .dropdown(), .toggle(), .slider()
//   所有字段支持 tooltip 悬浮提示！
//   返回字段名→值的字典，无需维护 formValues 索引
//
// ── tooltip 说明 ──
// 显示在字段右侧的感叹号图标(ⓘ)，玩家悬停时显示提示文字。
// 支持 ModalForm 的所有字段类型。
//    .toggle("pvp", "允许 PVP", {
//      defaultValue: false,
//      tooltip: "开启后玩家间可互相攻击"
//    })
//
// ── RawMessage 本地化 ──
// label/body/title 等所有文本参数均支持 RawMessage 格式：
//    .title({ translate: "menu.title" })
//    .body({ translate: "menu.body", with: ["玩家名"] })
//
// ── 注意事项 ──
// 1. 所有带有回调的按钮，回调始终在 system.run() 中执行
// 2. ModalForm label 在不同 Bedrock 版本中索引行为不一致，
//    本封装自动处理该差异，返回命名结果
// 3. 表单取消时统一返回 null（ModalForm）或 false（ActionForm/MessageForm）
// 4. 所有 show() 方法内部 try-catch，不会抛出未处理异常

export { ModalFormBuilder, type ModalFormValues } from "./ModalFormBuilder";
export {
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
} from "./ModalFormBuilder";
export { ActionFormBuilder } from "./ActionFormBuilder";
export { MessageFormBuilder } from "./MessageFormBuilder";
export { runSafeAsync } from "./runSafe";
export { trySendMessage, notifySuccess, notifyError } from "./utils";
