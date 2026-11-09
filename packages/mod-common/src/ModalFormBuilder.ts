// ─── ModalFormBuilder:选项式表单,返回「字段名 → 值」 ─────────────
//
// 版式(从上到下):
//
//   ┌──────────────────────────────────────────────┐
//   │                     设置                     │  title()
//   ├──────────────────────────────────────────────┤
//   │                   传送设置                   │  header()
//   │ 只读说明文字                                 │  label("info", …)
//   │ ──────────────────────────────────────────── │  divider()
//   │ 玩家名称  [ ________________ ]               │  textField() → string
//   │ 分类      [ 家            ▾ ]                │  dropdown()  → number(下标)
//   │ 公开      [ ●]                               │  toggle()    → boolean
//   │ 上限      [ ────●────── ] 30                 │  slider()    → number
//   │                                              │
//   │                  [  提交  ]                  │  submitButton()
//   └──────────────────────────────────────────────┘
//
// 关键语义:
//   · 调用方只给「字段名」,下标由本包维护,不需要自己数位置。
//   · dropdown 返回的是**选项下标**,不是选项文本;要文本请用
//     `items[值]` 自行映射。
//   · 取消 / 显示失败都返回 null(不抛异常);提交但无字段返回 {}。
//   · header / label / divider 是装饰行:在部分版本占用下标、在另一些
//     版本不占用,本包两种排布都兼容(见 formValues.ts)。
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

  /** 添加标题区(居中大号文字)。纯装饰,不产生值。 */
  header(text: RawMessage | string): this {
    this.form.header(text);
    this.fields.push({ kind: "header", name: "_header" });
    return this;
  }

  /** 添加分隔线。纯装饰,不产生值。 */
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

  /** 添加文本输入框,取值类型为 `string` */
  textField(name: string, label: RawMessage | string, opts?: ModalFormDataTextFieldOptions): this {
    const { defaultValue, tooltip, ...rest } = opts ?? {};
    this.form.textField(label, "", { defaultValue, tooltip, ...rest });
    this.fields.push({ kind: "textField", name });
    return this;
  }

  /** 添加带占位符的文本输入框,取值类型为 `string` */
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

  /**
   * 添加下拉选择框。
   *
   * 取值是**选中项下标**(`number`),不是选项文本。
   * 初始选中项用 `opts.defaultValueIndex` 指定,默认 0。
   */
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

  /** 添加开关,取值类型为 `boolean` */
  toggle(name: string, label: RawMessage | string, opts?: ModalFormDataToggleOptions): this {
    this.form.toggle(label, opts ?? {});
    this.fields.push({ kind: "toggle", name });
    return this;
  }

  /**
   * 添加滑条,取值类型为 `number`。
   *
   * 区间 `[min, max]` 两端都含。`opts.valueStep` 决定步长,
   * `opts.defaultValue` 决定初始位置。
   */
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
   * @returns 字段名 → 值的字典;玩家取消或表单出错时返回 null;
   *          提交但表单没有任何字段时返回 `{}`
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
