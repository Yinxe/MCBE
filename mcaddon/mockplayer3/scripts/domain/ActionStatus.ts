// ─── 长流程模式：运行状态板（domain 纯逻辑） ──────────────────────────
// 面板与命令要显示"此刻跑到哪条/第几轮/为什么停"，这些信息由能力层在推进与收场时写入，
// 与动作表内容分开：动作表落盘（DP），运行状态只活在进程内存里（重启即失，重跑重新计时）。
// 逐假人一份，删假人时清。

/** 运行阶段 */
export type ActionPhase = "idle" | "running" | "completed" | "failed" | "empty";

/** 单假人的长流程模式运行快照 */
export interface ActionStatus {
  /** 阶段 */
  phase: ActionPhase;
  /** 当前/最后停靠的动作序号（1 起；无意义时为 0） */
  stepIndex: number;
  /** 动作总数 */
  total: number;
  /** 第几轮（1 起） */
  cycle: number;
  /** 附加说明（失败原因/已完成/已停止等，中文） */
  message: string;
  /** 最后更新时刻（tick） */
  updatedAt: number;
}

/** 初始快照 */
export function idleStatus(now: number): ActionStatus {
  return { phase: "idle", stepIndex: 0, total: 0, cycle: 0, message: "", updatedAt: now };
}

/** 状态板：逐假人快照（进程内存活） */
export class ActionStatusBoard {
  private readonly board = new Map<number, ActionStatus>();

  /**
   * 局部更新（未给字段保持原值）。
   * @param botId - 假人身份
   * @param patch - 变更字段
   */
  patch(botId: number, patch: Partial<ActionStatus>): void {
    const prev = this.board.get(botId) ?? idleStatus(0);
    this.board.set(botId, { ...prev, ...patch });
  }

  /** 取快照（从未跑过 → undefined） */
  get(botId: number): ActionStatus | undefined {
    return this.board.get(botId);
  }

  /** 删假人清场 */
  forget(botId: number): void {
    this.board.delete(botId);
  }

  /**
   * 状态中文摘要（命令/面板共用）。
   * @param status - 快照
   */
  static describe(status: ActionStatus | undefined): string {
    if (!status) return "未运行";
    switch (status.phase) {
      case "idle":
        return status.message ? `已停止（${status.message}）` : "未运行";
      case "empty":
        return "还没有长流程模式";
      case "running":
        return `运行中：第 ${status.stepIndex}/${status.total} 条 · 第 ${status.cycle} 轮`;
      case "completed":
        return `已完成：${status.total} 条 × ${status.cycle} 轮`;
      case "failed":
        return `失败停下：第 ${status.stepIndex}/${status.total} 条（${status.message}）`;
    }
  }
}
