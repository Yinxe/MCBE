// ─── 防误触 HUD 提示（接入公共 actionbar 总线：@yinxe/toolkit） ──
// 挖掘防误触拦截（首次用错误工具/空手挖方块）时，游戏内没有任何反馈、只有日志。
// 本模块把拦截/确认信号转成逐玩家的 actionbar 提示，窗口与 AccidentalGuard 一致
//（ANTI_TOUCH_WINDOW_TICKS = 50 tick = 2.5s）：
//   · 拦截 → notifyIntercept(player)：登记 2.5s 提示窗口，actionbar 显示
//     "防误触：已拦截切换，N 秒内再挖一次将启用"（含剩余秒数倒计时）
//   · 确认 → clear(player)：同窗口二次挖掘放行，立即清提示（防残留误导）
// 渲染经公共 HudManager /scriptevent 总线逐玩家仲裁——priority 60 低于
// spectator(200) 与 item-route 会话(100)/仓库(80)，他包重要内容自动让位；
// 提示窗口到期 render 返回 undefined → 自动释放声明、HudManager 清残留。

import { system, type Player } from "@minecraft/server";
import { HudManager, color, style } from "@yinxe/toolkit";
import { ANTI_TOUCH_WINDOW_TICKS } from "./AccidentalGuard";

/** actionbar 优先级：低于 spectator(200) / item-route 会话(100)·仓库(80) → 让位 */
const HINT_PRIORITY = 60;
/** 单驱动周期（tick）：约每 0.1s 仲裁一次 */
const HINT_INTERVAL_TICKS = 2;

export class AntiTouchHud {
  private readonly hud = new HudManager({ modId: "auto-refill", intervalTicks: HINT_INTERVAL_TICKS });
  /** 玩家 id → 提示过期 tick（拦截时登记，窗口后自动清除） */
  private readonly hintUntil = new Map<string, number>();

  constructor() {
    this.hud.register({
      id: "antiTouch",
      slot: "actionbar",
      priority: HINT_PRIORITY,
      render: (p: Player) => this.text(p),
    });
  }

  /** Phase 4 安全上下文启动驱动循环（须在 system.run / 事件回调内调用） */
  start(): void {
    this.hud.start();
  }

  /** 防误触拦截（首次试探命中被吞）：登记 2.5s 提示窗口 */
  notifyIntercept(player: Player): void {
    this.hintUntil.set(player.id, system.currentTick + ANTI_TOUCH_WINDOW_TICKS);
  }

  /** 同窗口二次确认（放行切换）：立即清除提示 */
  clear(player: Player): void {
    this.hintUntil.delete(player.id);
  }

  /** 该玩家 actionbar 提示文本；无提示/已过期返回 undefined（不占总线，让位他包） */
  private text(p: Player): string | undefined {
    const until = this.hintUntil.get(p.id);
    if (until === undefined) return undefined;
    const remain = until - system.currentTick;
    if (remain <= 0) {
      this.hintUntil.delete(p.id);
      return undefined;
    }
    const secs = Math.ceil(remain / 20);
    return style("防误触 ", color.warn, color.bold) + style(`已拦截切换，${secs} 秒内再挖一次将启用`, color.info);
  }
}
