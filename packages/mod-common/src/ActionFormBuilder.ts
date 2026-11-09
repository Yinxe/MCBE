// ─── ActionFormBuilder:按钮式菜单,回调在安全上下文执行 ──────────
//
// 版式(从上到下):
//
//   ┌──────────────────────────────────────────────┐
//   │                     菜单                     │  title()
//   ├──────────────────────────────────────────────┤
//   │ 请选择操作                                   │  body() / header() / label()
//   │ ──────────────────────────────────────────── │  divider()
//   │   传送                                       │  button() → selection 0
//   │ ──────────────────────────────────────────── │  divider()
//   │   管理传送点                                 │  button() → selection 1
//   │ ──────────────────────────────────────────── │  divider()
//   │   新建传送点                                 │  button() → selection 2
//   └──────────────────────────────────────────────┘
//
// 要点:
//   · show() 返回 boolean,不是下标 —— 调用方拿不到点了哪个按钮,
//     点击后的动作应该写在回调里。
//   · 回调经 runSafe 推迟到安全上下文,可以直接传送 / 开下一个表单。
//   · 装饰行(header / divider / label)不进入按钮下标映射:本包假定
//     selection 是「按钮序号」。大量混用装饰行时若出现点击错位,
//     请直接用 ActionFormData 自行维护映射。
//
// 用法:
//   await new ActionFormBuilder()
//     .title("菜单")
//     .body("请选择操作")
//     .button("传送", () => showWarpSelector(player))
//     .show(player);

import { type Player, type RawMessage } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { runSafe } from "./runSafe";

interface ActionButton {
  callback?: () => void | Promise<void>;
}

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

  /** 添加标题区(居中大号文字) */
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
   * 添加只读文本行。
   *
   * 纯装饰,不产生可点击项,也不进入按钮下标映射。
   */
  label(text: RawMessage | string): this {
    this.form.label(text);
    return this;
  }

  /**
   * 添加按钮。
   *
   * 按钮在表单中的先后顺序决定 selection 下标,与添加顺序一致。
   *
   * @param callback 点击后的回调,经执行助手在安全上下文执行
   */
  button(text: RawMessage | string, callback?: () => void | Promise<void>): this {
    this.form.button(text);
    this.buttons.push({ callback });
    return this;
  }

  /**
   * 添加带图标的按钮。
   *
   * @param iconPath RP 纹理路径,如 "textures/ui/icon_settings"
   */
  buttonWithIcon(text: RawMessage | string, iconPath: string, callback?: () => void | Promise<void>): this {
    this.form.button(text, iconPath);
    this.buttons.push({ callback });
    return this;
  }

  /**
   * 显示表单,玩家点击后执行对应回调。
   *
   * 回调在 show() 返回**之前**执行完毕(内部 await runSafe),因此调用方
   * await 到 true 时,点击引发的动作已经跑完。
   *
   * @returns true = 点了按钮,false = 取消 / 关闭 / 显示失败
   */
  async show(player: Player): Promise<boolean> {
    try {
      const response = await this.form.show(player);
      if (response.canceled || response.selection === undefined) return false;
      const button = this.buttons[response.selection];
      if (button && button.callback) {
        await runSafe(button.callback);
      }
      return true;
    } catch (error) {
      console.warn(`[ActionForm] 显示失败: ${String(error)}`);
      return false;
    }
  }

  /** 快速显示:一行完成构建 + 展示 */
  static async showQuick(player: Player, title: string, build: (form: ActionFormBuilder) => void): Promise<boolean> {
    const builder = new ActionFormBuilder();
    builder.title(title);
    build(builder);
    return builder.show(player);
  }
}
