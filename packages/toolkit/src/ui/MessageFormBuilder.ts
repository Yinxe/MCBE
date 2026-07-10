// ─── MessageFormBuilder ──────────────────────────────────────────
// 对 @minecraft/server-ui MessageFormData 的封装。
// 双按钮对话框：是/否、确定/取消，或自定义语义。
// 回调始终在 system.run() 中执行。

import { type Player } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { runSafeAsync } from "./runSafe";

export class MessageFormBuilder {
  private form = new MessageFormData();
  private confirmCallback?: () => void | Promise<void>;
  private cancelCallback?: () => void | Promise<void>;

  title(text: string): this {
    this.form.title(text);
    return this;
  }

  body(text: string): this {
    this.form.body(text);
    return this;
  }

  /** 设置确认按钮（按钮 1，右侧） */
  confirmButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button1(label);
    this.confirmCallback = callback;
    return this;
  }

  /** 设置取消按钮（按钮 2，左侧） */
  cancelButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button2(label);
    this.cancelCallback = callback;
    return this;
  }

  /**
   * 显示对话框。
   * @returns true=确认，false=取消/关闭
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled) return false;

      if (response.selection === 0 && this.confirmCallback) {
        await runSafeAsync(this.confirmCallback);
        return true;
      }
      if (response.selection === 1 && this.cancelCallback) {
        await runSafeAsync(this.cancelCallback);
        return false;
      }
      return response.selection === 0;
    } catch (e) {
      console.warn(`[MessageForm] error: ${e}`);
      return false;
    }
  }

  /** 快速显示确认对话框 */
  static async confirm(
    player: Player,
    title: string,
    body: string,
    onConfirm?: () => void | Promise<void>
  ): Promise<boolean> {
    return new MessageFormBuilder()
      .title(title)
      .body(body)
      .confirmButton("§a✓ 确认", onConfirm)
      .cancelButton("§c✗ 取消")
      .show(player);
  }
}
