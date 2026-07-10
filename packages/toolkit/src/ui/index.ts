// @yinxe/toolkit UI 模块
// 对 @minecraft/server-ui（v2.0.0）的全功能封装。
//
// 封装内容：
// - ModalFormBuilder —— ModalFormData 命名访问封装
// - ActionFormBuilder —— ActionFormData 回调式封装
// - MessageFormBuilder —— MessageFormData 封装（确认/取消对话框）
// - trySendMessage, notifySuccess, notifyError —— UI 辅助函数
//
// 注意事项：
// 1. 所有 show() 方法必须使用 await 或在 system.run() 内调用
// 2. 所有回调函数（button / confirmButton / cancelButton）会在表单关闭后执行
// 3. ModalForm label 在不同 Bedrock 版本中对 formValues 索引行为不一致，
//    本封装自动处理该差异，始终按字段名取值
// 4. ActionForm 按钮图标路径为 RP 中的纹理路径（如 "textures/ui/icon_settings"）
// 5. 表单取消时统一返回 null（ModalForm）或 false（ActionForm/MessageForm）
// 6. 所有 show() 方法内部 try-catch，不会抛出未处理异常

export { ModalFormBuilder, type ModalFormValues } from "./ModalFormBuilder";
export { ActionFormBuilder } from "./ActionFormBuilder";
export { MessageFormBuilder } from "./MessageFormBuilder";
export { trySendMessage, notifySuccess, notifyError } from "./utils";
