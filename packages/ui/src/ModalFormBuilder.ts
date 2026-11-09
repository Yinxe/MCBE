// ─── ModalFormBuilder:选项式表单,返回「字段名 → 值」 ─────────────
//
// 调用方按字段名声明输入项,不需要自己维护 formValues 下标。
// 取消时返回 null,不抛异常。
//
// 用法:
//   const vals = await new ModalFormBuilder()
//     .title("设置")
//     .label("info", "只读说明")
//     .divider()
//     .slider("maxWaypoints", "单人上限", 10, 100, { defaultValue: 30, valueStep: 5 })
//     .toggle("publicEnabled", "启用公共传送点", { defaultValue: true })
//     .show(player);
//   if (vals) applySettings(vals.maxWaypoints, vals.publicEnabled);

import { type Player, type RawMessage } from "@minecraft/server";
import {
  ModalFormData,
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
} from "@minecraft/server-ui";
import { parseModalValues, type FieldSpec, type FormValues } from "./formValues";

export type { FormValues as ModalFormValues };

export {
  type ModalFormDataDropdownOptions,
  type ModalFormDataSliderOptions,
  type ModalFormDataTextFieldOptions,
  type ModalFormDataToggleOptions,
};

export class ModalFormBuilder {
  private form = new ModalFormData();
  private fields: FieldSpec[] = [];

  /** 设置表单标题 */
  title(text: RawMessage | string): this {
    this.form.title(text);
    return this;
  }

  /** 添加标题区(居中大号文字) */
  header(text: RawMessage | string): this {
    this.form.header(text);
    this.fields.push({ kind: "header", name: "_header" });
    return this;
  }

  /** 添加分隔线 */
  divider(): this {
    this.form.divider();
    this.fields.push({ kind: "divider", name: "_divider" });
    return this;
  }

  /** 添加只读文本。`name` 仅用于占位,不参与取值。 */
  label(name: string, text: RawMessage | string): this {
    this.form.label(text);
    this.fields.push({ kind: "label", name });
    return this;
  }

  /** 添加文本输入框 */
  textField(name: string, label: RawMessage | string, opts?: ModalFormDataTextFieldOptions): this {
    const { defaultValue, tooltip, ...rest } = opts ?? {};
    this.form.textField(label, "", { defaultValue, tooltip, ...rest });
    this.fields.push({ kind: "textField", name });
    return this;
  }

  /** 添加带占位符的文本输入框 */
  textFieldWithPlaceholder(
    name: string,
    label: RawMessage | string,
    placeholder: RawMessage | string,
    opts?: Omit<ModalFormDataTextFieldOptions, "placeholder">,
  ): this {
    this.form.textField(label, placeholder, opts ?? {});
    this.fields.push({ kind: "textField", name });
    return this;
  }

  /** 添加下拉选择框 */
  dropdown(
    name: string,
    label: RawMessage | string,
    items: (RawMessage | string)[],
    opts?: ModalFormDataDropdownOptions,
  ): this {
    this.form.dropdown(label, items, opts ?? {});
    this.fields.push({ kind: "dropdown", name });
    return this;
  }

  /** 添加开关 */
  toggle(name: string, label: RawMessage | string, opts?: ModalFormDataToggleOptions): this {
    this.form.toggle(label, opts ?? {});
    this.fields.push({ kind: "toggle", name });
    return this;
  }

  /** 添加滑条 */
  slider(
    name: string,
    label: RawMessage | string,
    min: number,
    max: number,
    opts?: ModalFormDataSliderOptions,
  ): this {
    this.form.slider(label, min, max, opts ?? {});
    this.fields.push({ kind: "slider", name });
    return this;
  }

  /** 设置提交按钮文本 */
  submitButton(text: RawMessage | string): this {
    this.form.submitButton(text);
    return this;
  }

  /**
   * 显示表单并返回命名结果。
   *
   * @returns 字段名 → 值的字典;玩家取消或表单出错时返回 null
   */
  async show(player: Player): Promise<FormValues | null> {
    try {
      const response = await this.form.show(player);
      if (response.canceled) return null;
      if (!response.formValues) return {};
      return parseModalValues(this.fields, response.formValues as (string | number | boolean | undefined)[]);
    } catch (error) {
      console.warn(`[ModalForm] 显示失败: ${String(error)}`);
      return null;
    }
  }

  /** 快速显示:一行完成构建 + 展示 */
  static async showQuick(
    player: Player,
    title: string,
    build: (form: ModalFormBuilder) => void,
  ): Promise<FormValues | null> {
    const builder = new ModalFormBuilder();
    builder.title(title);
    build(builder);
    return builder.show(player);
  }
}
