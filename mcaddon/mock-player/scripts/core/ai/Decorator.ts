// ─── 装饰节点 ────────────────────────────────────────────
// Cooldown：子节点失败后冷却 N tick（期间直接返回 failure，让上层 Selector
//   降级到兜底分支）——用于"扫描未找到"等场景防每 tick 重试抖动。

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

/** 失败冷却：子节点 failure 后，冷却期内直接返回 failure */
export class Cooldown implements Node {
  private failedAtTick = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly child: Node,
    private readonly ticks: number,
  ) {}

  async tick(ctx: AiContext): Promise<Status> {
    if (ctx.tick - this.failedAtTick < this.ticks) return "failure";
    const status = await this.child.tick(ctx);
    if (status === "failure") this.failedAtTick = ctx.tick;
    return status;
  }
}
