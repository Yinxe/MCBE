// @yinxe/toolkit UI 模块
// 对 @minecraft/server-ui（v2.0.0）的全功能封装。
//
// ── 封装内容 ──
// ActionFormBuilder   —— ActionFormData 回调式封装
//   .button(label, callback?)        纯文字按钮
//   .buttonWithIcon(label, iconPath, callback?)  带图标按钮
//   iconPath 为 RP 纹理路径，如 "textures/ui/icon_settings"
//
// MessageFormBuilder  —— MessageFormData 封装
//   .confirmButton(label, callback?)  确认按钮（button1，右侧）
//   .cancelButton(label, callback?)   取消按钮（button2，左侧）
//
// ModalFormBuilder    —— ModalFormData 命名访问封装
//   .textField(name, label, placeholder?, opts?)
//   .dropdown(name, label, items, opts?)
//   .toggle(name, label, opts?)
//   .slider(name, label, min, max, opts?)
//   返回字段名→值的字典，无需维护 formValues 索引
//
// 辅助函数：
//   trySendMessage, notifySuccess, notifyError
//   runSafeAsync —— 在 system.run() 中安全执行回调
//
// ── 注意事项 ──
// 1. 所有带有回调的按钮，回调始终在 system.run() 中执行
// 2. ModalForm 的 label 在不同 Bedrock 版本中索引行为不一致，
//    本封装自动处理该差异，返回命名结果
// 3. 表单取消时统一返回 null（ModalForm）或 false（ActionForm/MessageForm）
// 4. 回调内若需要嵌套调用 MC API（维度/方块/容器），再包一层 system.run()
// 5. 所有 show() 方法内部 try-catch，不会抛出未处理异常

export { ModalFormBuilder, type ModalFormValues } from "./ModalFormBuilder";
export { ActionFormBuilder } from "./ActionFormBuilder";
export { MessageFormBuilder } from "./MessageFormBuilder";
export { runSafeAsync } from "./runSafe";
export { trySendMessage, notifySuccess, notifyError } from "./utils";
