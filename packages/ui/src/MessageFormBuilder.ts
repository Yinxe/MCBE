// ─── MessageFormBuilder:双按钮对话框 ─────────────────────────────
//
// 用法:
//   const confirmed = await MessageFormBuilder.confirm(player, "确认删除", "删除后不可恢复");
//   if (confirmed) deleteWaypoint(...);

import { type Player } from "@minecraft/server";
import { MessageFormData } from "@minecraft/server-ui";
import { runSafe } from "./runSafe";

export class MessageFormBuilder {
  private form = new MessageFormData();
  private confirmCallback?: () => void | Promise<void>;
  private cancelCallback?: () => void | Promise<void>;

  /** 设置对话框标题 */
  title(text: string): this {
    this.form.title(text);
    return this;
  }

  /** 设置对话框正文 */
  body(text: string): this {
    this.form.body(text);
    return this;
  }

  /** 设置确认按钮(button1,右侧) */
  confirmButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button1(label);
    this.confirmCallback = callback;
    return this;
  }

  /** 设置取消按钮(button2,左侧) */
  cancelButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button2(label);
    this.cancelCallback = callback;
    return this;
  }

  /**
   * 显示对话框。
   *
   * @returns true = 确认,false = 取消或关闭
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled) return false;

      if (response.selection === 0 && this.confirmCallback) {
        await runSafe(this.confirmCallback);
        return true;
      }
      if (response.selection === 1 && this.cancelCallback) {
        await runSafe(this.cancelCallback);
        return false;
      }
      return response.selection === 0;
    } catch (error) {
      console.warn(`[MessageForm] 显示失败: ${String(error)}`);
      return false;
    }
  }

  /** 快速显示确认对话框 */
  static async confirm(
    player: Player,
    title: string,
    body: string,
    onConfirm?: () => void | Promise<void>,
  ): Promise<boolean> {
    return new MessageFormBuilder()
      .title(title)
      .body(body)
      .confirmButton("§a✓ 确认", onConfirm)
      .cancelButton("§c✗ 取消")
      .show(player);
  }
}
