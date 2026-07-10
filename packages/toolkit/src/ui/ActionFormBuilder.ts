// ─── ActionFormBuilder ───────────────────────────────────────────
// 对 @minecraft/server-ui ActionFormData 的回调式封装。
//
// 回调始终在 system.run() 中执行。支持 header()、divider() 等布局组件，
// 以及 RawMessage 格式的本地化标签。
//
// 用法：
//   await new ActionFormBuilder()
//     .title("菜单")
//     .body("请选择操作")
//     .header("操作分类")
//     .divider()
//     .button("创建", () => onCreate(player))
//     .show(player);

import { type Player, type RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { runSafeAsync } from "./runSafe";

// ─── 类型 ───────────────────────────────────────────────────────

interface ActionButton {
  label: string;
  iconPath?: string;
  callback?: () => void | Promise<void>;
}

// ─── 构建器 ─────────────────────────────────────────────────────

export class ActionFormBuilder {
  private form = new ActionFormData();
  private buttons: ActionButton[] = [];

  /** 设置表单标题 */
  title(text: RawMessage | string): this {
    this.form.title(text);
    return this;
  }

  /** 设置表单正文 */
  body(text: RawMessage | string): this {
    this.form.body(text);
    return this;
  }

  /** 添加标题区（居中大号文字） */
  header(text: RawMessage | string): this {
    this.form.header(text);
    return this;
  }

  /** 添加分隔线 */
  divider(): this {
    this.form.divider();
    return this;
  }

  /**
   * 添加按钮。
   * @param callback - 点击后的回调，始终在 system.run() 中执行
   */
  button(text: RawMessage | string, callback?: () => void | Promise<void>): this {
    this.form.button(text);
    this.buttons.push({ label: typeof text === "string" ? text : "", callback });
    return this;
  }

  /**
   * 添加带图标的按钮。
   * @param iconPath - RP 纹理路径，如 "textures/ui/icon_settings"
   */
  buttonWithIcon(text: RawMessage | string, iconPath: string, callback?: () => void | Promise<void>): this {
    this.form.button(text, iconPath);
    this.buttons.push({ label: typeof text === "string" ? text : "", iconPath, callback });
    return this;
  }

  /**
   * 显示表单，用户点击后自动执行对应回调。
   * @returns true=点了按钮，false=取消
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled || response.selection === undefined) return false;
      const btn = this.buttons[response.selection];
      if (btn?.callback) {
        await runSafeAsync(btn.callback);
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
