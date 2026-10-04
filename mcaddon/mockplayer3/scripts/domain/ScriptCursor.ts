// ─── 编程模式：执行游标（domain 纯逻辑） ────────────────────────────
// 把"下一条执行哪条 / 本轮是否结束 / 整段是否跑完 / 是否踩到跳转死循环"从异步执行器里
// 拆出来，做成可离线单测的纯状态机；执行器只负责把步骤落到引擎原子。
// 调用约定：peek 停在待执行条上 → 执行 → commit（成功）或 skip（失败且策略=跳过）。

import type { ScriptProgram, ScriptStep } from "./ScriptRules";
import { JUMP_STREAK_LIMIT } from "./ScriptRules";

/** 游标停靠点 */
export type ScriptCursorStop =
  | { kind: "step"; index: number; step: ScriptStep; cycle: number }
  | { kind: "cycle-end"; cycle: number; done: boolean }
  | { kind: "error"; message: string };

/**
 * 脚本执行游标。
 * @remarks peek 会就地消化 jump 与整段循环；同一停靠点只调用一次后再 commit/skip。
 */
export class ScriptCursor {
  private cursor = 0;
  private cycles = 0;
  private jumpStreak = 0;
  private finished = false;

  constructor(private readonly program: ScriptProgram) {}

  /** 当前待执行条序号（0 起；未停靠时无意义） */
  get index(): number {
    return this.cursor;
  }

  /** 当前轮次（1 起；未开始为 0） */
  get cycle(): number {
    return this.cycles;
  }

  /** 步骤总数 */
  get total(): number {
    return this.program.steps.length;
  }

  /** 整段是否已结束 */
  get done(): boolean {
    return this.finished;
  }

  /**
   * 取下一个停靠点（消化 jump 与整段循环）。
   * @returns 待执行步骤 / 本轮结束 / 整段完成 / 死循环等错误
   */
  peek(): ScriptCursorStop {
    if (this.finished) return { kind: "cycle-end", cycle: this.cycles, done: true };
    const total = this.program.steps.length;
    if (total === 0) {
      this.finished = true;
      return { kind: "cycle-end", cycle: 0, done: true };
    }
    if (this.cycles === 0) this.cycles = 1;
    const loop = this.program.loopCount;
    for (;;) {
      if (this.cursor >= total) {
        if (loop >= 0 && this.cycles >= loop) {
          this.finished = true;
          return { kind: "cycle-end", cycle: this.cycles, done: true };
        }
        this.cycles++;
        this.cursor = 0;
        this.jumpStreak = 0;
        continue;
      }
      const step = this.program.steps[this.cursor]!;
      if (step.type !== "jump") {
        this.jumpStreak = 0;
        return { kind: "step", index: this.cursor, step, cycle: this.cycles };
      }
      if (!Number.isInteger(step.target) || step.target < 1 || step.target > total) {
        this.finished = true;
        return { kind: "error", message: `跳转目标 ${step.target} 超出范围（1-${total}）` };
      }
      this.jumpStreak++;
      if (this.jumpStreak > JUMP_STREAK_LIMIT) {
        this.finished = true;
        return { kind: "error", message: `连续跳转超过 ${JUMP_STREAK_LIMIT} 次（没有实际动作），按死循环停下` };
      }
      this.cursor = step.target - 1;
    }
  }

  /** 当前停靠条执行完毕：推进一条 */
  commit(): void {
    if (this.finished) return;
    this.cursor++;
  }

  /** 当前条失败且策略=跳过：与 commit 同效，语义分开便于执行器与日志区分 */
  skip(): void {
    this.commit();
  }
}
