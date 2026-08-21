// ─── 目标选择器（core/ai，纯逻辑可单测） ──────────────
// 官方"意向系统"的索敌目标调度（wiki：每 tick 从高优先级到低优先级评估）：
//   1. 运行中目标延续条件失效（canContinue 缺省 = canActivate）→ **abort
//      中断协程** + 释放（3.3.8：先前只释放不中断，协程残留并发执行）
//   2. 从高到低找第一个 canActivate 的目标：
//        - 与运行中目标不同 → 切换（高优先级抢占/首次启动；abort 旧 +
//          onActivate 钩子）
//        - 相同 → 延续
//   3. tick 选中目标的行为树（Action 防重入：协程挂起时返回 Running 不
//      重复启动；Success/Failure = 本轮目标达成/失败 → 下轮重评）
//   4. 无目标可启用 → 不动（idle）
// v1 单主目标语义（同一时刻一个目标运行）；旗标并行预留（AiGoal.flags）。

import type { AiBrainContext, AiGoal } from "./Goal";

export class GoalSelector {
  private goals: AiGoal[] = [];
  private active: AiGoal | undefined;
  private lastTick = -1;

  /** 当前运行中的目标（undefined = idle） */
  get activeGoal(): AiGoal | undefined {
    return this.active;
  }

  /** 注册能力（同名忽略；按优先级升序维护——数字小优先） */
  registerGoal(goal: AiGoal): void {
    if (this.goals.some((g) => g.name === goal.name)) return;
    this.goals.push(goal);
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  /** 卸载能力（可插拔：拔掉防御/砍树等） */
  unregisterGoal(name: string): void {
    this.goals = this.goals.filter((g) => g.name !== name);
    if (this.active?.name === name) {
      try {
        this.active.abort?.(); // 卸载运行中目标：中断协程
      } catch (e: any) {
        console.error(`[MockPlayer] 目标 abort 异常(${name}): ${e?.message ?? e}\n${e?.stack ?? ""}`);
      }
      this.active = undefined;
    }
  }

  /**
   * 每 tick 调度一次（同 tick 防重入）。
   * @param ctx 大脑上下文（memory 共享感知；blackboard 由选中目标私有注入）
   */
  async step(ctx: AiBrainContext): Promise<void> {
    if (ctx.tick === this.lastTick) return; // 同 tick 防重入
    this.lastTick = ctx.tick;

    // 1. 运行中目标延续条件失效 → abort 中断协程 + 释放（下轮重新选择）
    if (this.active) {
      const canContinue = this.active.canContinue
        ? this.active.canContinue(ctx)
        : this.active.canActivate(ctx);
      if (!canContinue) {
        try {
          this.active.abort?.(); // 真正中断（如收竿/停导航的协程侧）
        } catch (e: any) {
          console.error(
            `[MockPlayer] 目标 abort 异常(${this.active.name}, ${ctx.botName}): ${e?.message ?? e}\n${e?.stack ?? ""}`
          );
        }
        this.active = undefined;
      }
    }

    // 2. 从高到低选第一个可激活目标
    let selected: AiGoal | undefined;
    for (const g of this.goals) {
      if (g.canActivate(ctx)) {
        selected = g;
        break;
      }
    }
    if (!selected) {
      this.active = undefined; // 3. 无目标 → idle
      return;
    }

    // 4. 切换/延续：新目标（抢占或首次）→ 旧目标 abort（取消协程副作用）+ onActivate 钩子
    if (this.active !== selected) {
      const previous = this.active;
      this.active = selected;
      try {
        previous?.abort?.(); // 被抢占的目标：通知取消（如收竿/停导航的协程侧）
      } catch (e: any) {
        console.error(
          `[MockPlayer] 目标 abort 异常(${previous?.name}, ${ctx.botName}): ${e?.message ?? e}\n${e?.stack ?? ""}`
        );
      }
      try {
        selected.onActivate?.(ctx);
      } catch (e: any) {
        console.error(
          `[MockPlayer] 目标 onActivate 异常(${selected.name}, ${ctx.botName}): ${e?.message ?? e}\n${e?.stack ?? ""}`
        );
      }
    }

    // 5. tick 目标树（惰性建树；Action 防重入：协程挂起返回 Running；
    //    异常打印完整栈，不阻断调度，下轮重试）
    const tree = selected.tree ?? selected.ensureTree?.(ctx);
    if (!tree) return;
    try {
      await tree.tick(ctx);
    } catch (e: any) {
      console.error(
        `[MockPlayer] 目标树异常(${selected.name}, ${ctx.botName}): ${e?.message ?? e}\n${e?.stack ?? ""}`
      );
    }
  }
}
