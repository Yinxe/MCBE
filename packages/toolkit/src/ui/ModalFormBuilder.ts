// ─── ModalFormBuilder ─────────────────────────────────────────────
// 对 @minecraft/server-ui ModalFormData 的命名访问封装。
// 屏蔽 label 在不同 Bedrock 版本中的索引行为差异，支持字段名取值。
//
// 用法：
//   const form = new ModalFormBuilder()
//     .title("设置")
//     .toggle("enabled", "启用", { defaultValue: true })
//     .textField("name", "名称", { defaultValue: "张三" })
//     .build();
//   const vals = await form.show(player);
//   if (!vals) return;           // 取消
//   dosomething(vals.enabled);   // 命名访问，无需维护索引

import { type Player } from "@minecraft/server";
import { ModalFormData } from "@minecraft/server-ui";

// ─── 类型 ───────────────────────────────────────────────────────

type FieldType = "label" | "textField" | "dropdown" | "toggle" | "slider";

interface FormField {
  type: FieldType;
  name: string;
}

export type ModalFormValues = Record<string, string | number | boolean | undefined>;

// ─── 构建器 ─────────────────────────────────────────────────────

export class ModalFormBuilder {
  private form = new ModalFormData();
  private fields: FormField[] = [];

  /** 设置表单标题 */
  title(text: string): this {
    this.form.title(text);
    return this;
  }

  /** 添加只读文本标签 */
  label(_name: string, text: string): this {
    this.form.label(text);
    this.fields.push({ type: "label", name: _name });
    return this;
  }

  /** 添加文本输入框 */
  textField(name: string, label: string, placeholder?: string, opts?: { defaultValue?: string }): this {
    this.form.textField(label, placeholder ?? "", opts ?? {});
    this.fields.push({ type: "textField", name });
    return this;
  }

  /** 添加下拉选择框 */
  dropdown(name: string, label: string, options: string[], opts?: { defaultValueIndex?: number }): this {
    this.form.dropdown(label, options, opts ?? {});
    this.fields.push({ type: "dropdown", name });
    return this;
  }

  /** 添加开关 */
  toggle(name: string, label: string, opts?: { defaultValue?: boolean }): this {
    this.form.toggle(label, opts ?? {});
    this.fields.push({ type: "toggle", name });
    return this;
  }

  /** 添加滑动条 */
  slider(name: string, label: string, min: number, max: number, opts?: { defaultValue?: number; valueStep?: number }): this {
    this.form.slider(label, min, max, opts ?? {});
    this.fields.push({ type: "slider", name });
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
  static async showQuick(player: Player, title: string, build: (f: ModalFormBuilder) => void): Promise<ModalFormValues | null> {
    const builder = new ModalFormBuilder();
    builder.title(title);
    build(builder);
    return builder.show(player);
  }

  // ── 索引解析 ────────────────────────────────────────────────

  /**
   * 解析 formValues 为命名字典。
   *
   * label 在不同版本中行为：
   * - 新版：label 占用 formValues 索引，值为 null
   * - 旧版：label 不占用索引
   * 自动通过比较数组长度判断。
   */
  private parse(values: (string | number | boolean | undefined)[]): ModalFormValues {
    const result: ModalFormValues = {};
    const labelsOccupy = values.length === this.fields.length;

    for (let i = 0; i < this.fields.length; i++) {
      const field = this.fields[i];
      if (field.type === "label") continue;
      if (labelsOccupy) {
        result[field.name] = values[i];
      } else {
        // label 不占位时，非 label 字段顺序排列
        const fieldCount = this.fields.slice(0, i + 1).filter((f) => f.type !== "label").length;
        result[field.name] = values[fieldCount - 1];
      }
    }

    return result;
  }
}
