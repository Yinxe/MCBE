// ─── 假人误点拦截守护（ToolGuard 同族常驻守护） ────────────────────
// 判定纯函数在 domain/ClickGuard（写死名单与短路序），本层只把 clock 喂进许可记录，
// 并对外发放"有意交互"许可。名单不入配置，无策略投影。

import { ClickPermits, judgeBlockClick } from "../domain/ClickGuard";
import { clock } from "./Clock";

export class BotClickGuard {
  private readonly permits = new ClickPermits();

  /**
   * 发放一次有意交互许可（假人自己的交互原子发起前调用）。
   * @param botId - 发起交互的假人
   */
  grant(botId: number): void {
    this.permits.grant(botId, clock.now());
  }

  /**
   * 这次假人方块点击该不该拦。
   * @param botId - 点击发起者
   * @param typeId - 被点方块 typeId
   * @returns true = cancel
   */
  decide(botId: number, typeId: string): boolean {
    return judgeBlockClick(typeId, this.permits.permitted(botId, clock.now()));
  }

  /** 会话销毁时清除该 botId 的许可记录，避免 id 复用串到新会话 */
  forget(botId: number): void {
    this.permits.forget(botId);
  }
}

/** 进程级单例 */
export const botClickGuard = new BotClickGuard();
