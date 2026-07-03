import { type Player } from "@minecraft/server";
import { ActionFormData, ModalFormData } from "@minecraft/server-ui";

// ═══════════════════════════════════════════════════════════════════
// FormHelper —— ModalForm / ActionForm 命名访问封装
// ═══════════════════════════════════════════════════════════════════
//
// 解决的问题：
//   1. ModalForm label 在不同 Bedrock 版本中是否占用 formValues 索引
//      行为不一致，用命名访问彻底屏蔽分歧
//   2. 硬编码索引容易在增删字段时出错，命名访问使重构安全
//   3. ActionForm 按钮用名称而非 selection 索引，增删按钮不影响逻辑
//
// 用法：
//   const form = new ModalFormBuilder()
//     .title("标题")
//     .label("info", "说明文字")
//     .textField("name", "名称", "占位符")
//     .toggle("enabled", "启用")
//     .build();
//
//   const vals = await form.show(player);
//   if (!vals) return;                        // 取消
//   const name = vals.name as string;          // 命名访问
//   const enabled = vals.enabled as boolean;
// ═══════════════════════════════════════════════════════════════════

// ─── ModalForm ──────────────────────────────────────────────────

/** 表单字段类型 */
type FieldType = "label" | "textField" | "dropdown" | "toggle" | "slider";

/** 内部字段描述 */
interface FormField {
  type: FieldType;
  name: string;
}

/**
 * ModalForm 构建器。
 *
 * 所有字段通过命名方法添加，调用 build() 后获得包装后的表单对象，
 * 通过 show(player) 返回以字段名为键的结果字典。
 */
export class ModalFormBuilder {
  private form = new ModalFormData();
  private fields: FormField[] = [];
  private titleText = "";

  /** 设置表单标题 */
  title(text: string): this {
    this.titleText = text;
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
  textField(
    name: string,
    label: string,
    placeholder?: string,
    opts?: { defaultValue?: string }
  ): this {
    this.form.textField(label, placeholder ?? "", opts);
    this.fields.push({ type: "textField", name });
    return this;
  }

  /** 添加下拉选择框 */
  dropdown(
    name: string,
    label: string,
    options: string[],
    opts?: { defaultValueIndex?: number }
  ): this {
    this.form.dropdown(label, options, opts);
    this.fields.push({ type: "dropdown", name });
    return this;
  }

  /** 添加开关 */
  toggle(name: string, label: string, opts?: { defaultValue?: boolean }): this {
    this.form.toggle(label, opts);
    this.fields.push({ type: "toggle", name });
    return this;
  }

  /** 添加滑动条 */
  slider(
    name: string,
    label: string,
    min: number,
    max: number,
    opts?: { defaultValue?: number; valueStep?: number }
  ): this {
    this.form.slider(label, min, max, opts);
    this.fields.push({ type: "slider", name });
    return this;
  }

  /**
   * 显示表单并返回命名结果。
   * @returns 字段名→值的字典，取消时返回 null
   */
  async show(player: Player): Promise<Record<string, unknown> | null> {
    const response = await this.form.show(player);
    if (response.canceled) return null;
    const values = response.formValues;
    if (!values) return null;

    return this.parse(values);
  }

  // ── 索引解析 ──────────────────────────────────────────────────

  /**
   * 解析 formValues 为命名字典。
   *
   * label 在不同版本中行为：
   * - 新版：label 占用 formValues 索引，值为 null（数组长度 = 字段总数）
   * - 旧版：label 不占用索引（数组长度 < 字段总数）
   *
   * 通过比较数组长度与字段总数自动判断。
   */
  private parse(values: (string | number | boolean | undefined)[]): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const labelsOccupy = values.length === this.fields.length;

    if (labelsOccupy) {
      // label 占位：每个字段在 values 中有对应槽位（label 为 null）
      for (let i = 0; i < this.fields.length; i++) {
        if (this.fields[i].type !== "label") {
          result[this.fields[i].name] = values[i];
        }
      }
    } else {
      // label 不占位：只有非 label 字段出现在 values 中，顺序排列
      let vi = 0;
      for (const field of this.fields) {
        if (field.type !== "label") {
          result[field.name] = values[vi];
          vi++;
        }
      }
    }

    return result;
  }
}

// ─── ActionForm ─────────────────────────────────────────────────

/** ActionForm 按钮描述 */
interface ActionButton {
  /** 按钮唯一标识名 */
  name: string;
  /** 按钮显示文本 */
  label: string;
}

/**
 * ActionForm 构建器。
 *
 * 按钮通过命名方法添加，show() 返回按钮名而非 selection 索引。
 */
export class ActionFormBuilder {
  private form = new ActionFormData();
  private buttons: ActionButton[] = [];

  /** 设置表单标题 */
  title(text: string): this {
    this.form.title(text);
    return this;
  }

  /** 设置表单正文 */
  body(text: string): this {
    this.form.body(text);
    return this;
  }

  /** 添加按钮 */
  button(name: string, label: string): this {
    this.form.button(label);
    this.buttons.push({ name, label });
    return this;
  }

  /**
   * 显示表单并返回按钮选择结果。
   * @returns { name: 按钮名, selection: 原始索引 }，取消时返回 null
   */
  async show(
    player: Player
  ): Promise<{ name: string; selection: number } | null> {
    const response = await this.form.show(player);
    if (response.canceled || response.selection === undefined) return null;
    const btn = this.buttons[response.selection];
    if (!btn) return null;
    return { name: btn.name, selection: response.selection };
  }

  /** 获取按钮列表（用于动态查找等场景） */
  getButtonList(): readonly ActionButton[] {
    return this.buttons;
  }
}
