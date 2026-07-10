// ─── ActionFormBuilder ───────────────────────────────────────────
// 对 @minecraft/server-ui ActionFormData 的回调式封装。
// 每个按钮绑定回调函数，show() 自动执行，无需维护 selection 索引。
//
// 安全性：回调始终在 system.run() 中执行，确保可安全调用 MC API。
// 但回调内若调用其他表单（show()），返回后仍在同一 tick 内。
// 若需嵌套表单后再操作 MC API，在回调内再包一层 system.run()。
//
// 用法：
//   await new ActionFormBuilder()
//     .title("菜单")
//     .body("请选择操作")
//     .button("创建", () => onCreate(player))
//     .show(player);

import { type Player, system } from "@minecraft/server";
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
  title(text: string): this {
    this.form.title(text);
    return this;
  }

  /** 设置表单正文 */
  body(text: string): this {
    this.form.body(text);
    return this;
  }

  /**
   * 添加按钮。
   * @param callback - 点击后的回调，始终在 system.run() 中执行。
   *                   无回调的按钮（如纯关闭）可不传。
   */
  button(label: string, callback?: () => void | Promise<void>): this {
    this.form.button(label);
    this.buttons.push({ label, callback });
    return this;
  }

  /**
   * 添加带图标的按钮。
   * @param iconPath - RP 纹理路径，如 "textures/ui/icon_settings"
   */
  buttonWithIcon(label: string, iconPath: string, callback?: () => void | Promise<void>): this {
    this.form.button(label, iconPath);
    this.buttons.push({ label, iconPath, callback });
    return this;
  }

  /**
   * 显示表单，用户点击后自动执行对应回调（在 system.run 中）。
   * @returns true=点了按钮，false=取消
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled || response.selection === undefined) return false;
      const btn = this.buttons[response.selection];
      if (btn?.callback) {
        await this.runSafe(btn.callback);
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

/**
 * 在 system.run() 中安全执行回调，支持 async。
 */
private runSafe(fn: () => void | Promise<void>): Promise<void> {
  return runSafeAsync(fn);
}
