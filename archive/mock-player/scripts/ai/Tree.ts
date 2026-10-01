// ─── 行为树 ──────────────────────────────────────────────
// 单根入口：每 tick 调用一次（引擎防重入：上一次 tick 未完成时跳过）。

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

export class BehaviorTree {
  constructor(private readonly root: Node) {}

  /** 推进一次（异步：挂起在协程式叶子时等待其完成） */
  async tick(ctx: AiContext): Promise<Status> {
    return this.root.tick(ctx);
  }
}
