// ─── ActionFormBuilder ───────────────────────────────────────────
// 对 @minecraft/server-ui ActionFormData 的回调式封装。
// 每个按钮绑定回调函数，show() 自动执行，无需维护 selection 索引。
//
// 用法：
//   await new ActionFormBuilder()
//     .title("菜单")
//     .body("请选择操作")
//     .button("创建", () => onCreate(player))
//     .button("管理", () => onManage(player))
//     .show(player);

import { type Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

// ─── 类型 ───────────────────────────────────────────────────────

interface ActionButton {
  label: string;
  callback?: () => void | Promise<void>;
}

// ─── 构建器 ─────────────────────────────────────────────────────

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

  /** 添加按钮，可选回调函数（支持 async）。取消或点击无回调按钮则静默返回。 */
  button(label: string, callback?: () => void | Promise<void>): this {
    this.form.button(label);
    this.buttons.push({ label, callback });
    return this;
  }

  /** 添加带图标的按钮（图标路径为 RP 中的纹理路径） */
  buttonWithIcon(label: string, iconPath: string, callback?: () => void | Promise<void>): this {
    this.form.button(label, iconPath);
    this.buttons.push({ label, callback });
    return this;
  }

  /**
   * 显示表单，用户点击按钮后自动执行对应的回调。
   * @returns true=点了按钮，false=取消
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled || response.selection === undefined) return false;
      const btn = this.buttons[response.selection];
      if (btn?.callback) {
        await btn.callback();
      }
      return true;
    } catch (e) {
      console.warn(`[ActionForm] error: ${e}`);
      return false;
    }
  }

  /** 快速显示：一行完成构建 + 展示 */
  static async showQuick(
    player: Player,
    title: string,
    build: (f: ActionFormBuilder) => void
  ): Promise<boolean> {
    const builder = new ActionFormBuilder();
    builder.title(title);
    build(builder);
    return builder.show(player);
  }
}
