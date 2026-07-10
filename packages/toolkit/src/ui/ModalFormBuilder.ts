// ─── ModalFormBuilder ─────────────────────────────────────────────
// 对 @minecraft/server-ui ModalFormData 的全功能封装。
//
// 支持所有原生组件配置项：
// - tooltip 悬浮提示（感叹号图标）
// - placeholder / defaultValue / valueStep / defaultValueIndex
// - header 标题区、divider 分隔线、submitButton 提交按钮
// - label 的 RawMessage 格式（translate + with 本地化）
//
// 保留命名访问特性：屏蔽 label 跨版本索引差异，按钮名取值。
//
// 用法：
//   const vals = await new ModalFormBuilder()
//     .title("设置")
//     .toggle("enabled", "启用", { defaultValue: true, tooltip: "开启后生效" })
//     .textField("name", "名称", { placeholder: "输入名字", tooltip: "仅支持中文" })
//     .dropdown("mode", "模式", ["简单", "高级"], { defaultValueIndex: 1 })
//     .slider("volume", "音量", 0, 100, { defaultValue: 50, valueStep: 5, tooltip: "调节音量" })
//     .divider()
//     .submitButton("确定")
//     .show(player);
//   if (vals) console.log(vals.enabled, vals.name, vals.mode);

import { type Player, type RawMessage } from "@minecraft/server";
import { ModalFormData, type ModalFormDataDropdownOptions, type ModalFormDataSliderOptions, type ModalFormDataTextFieldOptions, type ModalFormDataToggleOptions } from "@minecraft/server-ui";

// ─── 字段类型 ───────────────────────────────────────────────────

type FieldType = "header" | "label" | "divider" | "textField" | "dropdown" | "toggle" | "slider";

interface FormField {
  type: FieldType;
  name: string;
}

export type ModalFormValues = Record<string, string | number | boolean | undefined>;

// ─── 选项类型（直接透传原生接口） ─────────────────────────────

export { type ModalFormDataDropdownOptions, type ModalFormDataSliderOptions, type ModalFormDataTextFieldOptions, type ModalFormDataToggleOptions };

// ─── 构建器 ─────────────────────────────────────────────────────

export class ModalFormBuilder {
  private form = new ModalFormData();
  private fields: FormField[] = [];

  /** 设置表单标题 */
  title(text: RawMessage | string): this {
    this.form.title(text);
    return this;
  }

  /** 添加表单头部（标题区） */
  header(text: RawMessage | string): this {
    this.form.header(text);
    this.fields.push({ type: "header", name: "_header" });
    return this;
  }

  /** 添加分隔线 */
  divider(): this {
    this.form.divider();
    this.fields.push({ type: "divider", name: "_divider" });
    return this;
  }

  /** 添加只读文本标签 */
  label(_name: string, text: RawMessage | string): this {
    this.form.label(text);
    this.fields.push({ type: "label", name: _name });
    return this;
  }

  /** 添加文本输入框 */
  textField(name: string, label: RawMessage | string, opts?: ModalFormDataTextFieldOptions): this {
    const { defaultValue, tooltip, ...rest } = opts ?? {};
    this.form.textField(label, "", { defaultValue, tooltip, ...rest });
    this.fields.push({ type: "textField", name });
    return this;
  }

  /** 添加带占位符的文本输入框 */
  textFieldWithPlaceholder(name: string, label: RawMessage | string, placeholder: RawMessage | string, opts?: Omit<ModalFormDataTextFieldOptions, "placeholder">): this {
    this.form.textField(label, placeholder, opts ?? {});
    this.fields.push({ type: "textField", name });
    return this;
  }

  /** 添加下拉选择框 */
  dropdown(name: string, label: RawMessage | string, items: (RawMessage | string)[], opts?: ModalFormDataDropdownOptions): this {
    this.form.dropdown(label, items, opts ?? {});
    this.fields.push({ type: "dropdown", name });
    return this;
  }

  /** 添加开关 */
  toggle(name: string, label: RawMessage | string, opts?: ModalFormDataToggleOptions): this {
    this.form.toggle(label, opts ?? {});
    this.fields.push({ type: "toggle", name });
    return this;
  }

  /** 添加滑动条 */
  slider(name: string, label: RawMessage | string, min: number, max: number, valueStep?: number, opts?: Omit<ModalFormDataSliderOptions, "valueStep">): this {
    this.form.slider(label, min, max, valueStep, opts ?? {});
    this.fields.push({ type: "slider", name });
    return this;
  }

  /** 设置提交按钮文本 */
  submitButton(text: RawMessage | string): this {
    this.form.submitButton(text);
    return this;
  }

  /**
   * 显示表单并返回命名结果。
   * @returns 字段名→值的字典，取消时返回 null。
   */
  async show(player: Player): Promise<ModalFormValues | null> {
    try {
      const response = await this.form.show(player);
      if (response.canceled) return null;
      if (!response.formValues) return {};
      return this.parse(response.formValues as (string | number | boolean | undefined)[]);
    } catch (e) {
      console.warn(`[ModalForm] error: ${e}`);
      return null;
    }
  }

  /** 快速显示：一行完成构建 + 展示 */
  static async showQuick(
    player: Player,
    title: string,
    build: (f: ModalFormBuilder) => void
  ): Promise<ModalFormValues | null> {
    const builder = new ModalFormBuilder();
    builder.title(title);
    build(builder);
    return builder.show(player);
  }

  // ── 索引解析 ────────────────────────────────────────────────

  /**
   * 解析 formValues 为命名字典。
   * 自动判断 label 是否占用索引（取决于 Bedrock 版本）。
   */
  private parse(values: (string | number | boolean | undefined)[]): ModalFormValues {
    const result: ModalFormValues = {};
    const valueTypes: FieldType[] = ["textField", "dropdown", "toggle", "slider"];
    const valueFields = this.fields.filter((f) => valueTypes.includes(f.type));
    const valueCount = valueFields.length;
    const labelsOccupy = values.length === this.fields.length;

    if (labelsOccupy) {
      for (let i = 0; i < this.fields.length; i++) {
        const f = this.fields[i];
        if (valueTypes.includes(f.type)) {
          result[f.name] = values[i];
        }
      }
    } else {
      // label/header/divider 不占索引时，仅值字段顺序排列
      let vi = 0;
      for (const f of this.fields) {
        if (valueTypes.includes(f.type)) {
          result[f.name] = values[vi];
          vi++;
        }
      }
    }

    return result;
  }
}
