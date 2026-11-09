// ─── MessageFormBuilder:双按钮对话框 ─────────────────────────────
//
// 版式(从上到下):
//
//   ┌──────────────────────────────────────────────┐
//   │                   确认删除                   │  title()
//   ├──────────────────────────────────────────────┤
//   │ 删除后不可恢复。                             │  body()
//   │ 传送点: 家                                   │
//   │                                              │
//   │           [ ✓ 确认 ]    [ ✗ 取消 ]           │  button1 / button2
//   └──────────────────────────────────────────────┘
//
// 两个按钮的**左右摆放由游戏决定**,官方文档没有保证 button1 在哪一侧,
// 因此不要把「左/右」写进文案或依赖它。需要确定性顺序时,改用
// ActionFormBuilder 自己摆按钮。
//
// 语义对应:button1 = 确认(selection 0),button2 = 取消(selection 1)。
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

  /**
   * 设置确认按钮(button1)。
   *
   * 对应 selection 0。屏幕上的左右位置由游戏决定,不要依赖。
   */
  confirmButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button1(label);
    this.confirmCallback = callback;
    return this;
  }

  /**
   * 设置取消按钮(button2)。
   *
   * 对应 selection 1。屏幕上的左右位置由游戏决定,不要依赖。
   */
  cancelButton(label: string, callback?: () => void | Promise<void>): this {
    this.form.button2(label);
    this.cancelCallback = callback;
    return this;
  }

  /**
   * 显示对话框。
   *
   * 回调在 show() 返回**之前**执行完毕(内部 await runSafe)。
   *
   * @returns true = 确认,false = 取消 / 关闭 / 显示失败
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

  /**
   * 快速显示确认对话框。
   *
   * 按钮文案固定为 `§a✓ 确认` / `§c✗ 取消`。
   * `onConfirm` 在确认时执行(已在安全上下文)。
   */
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
