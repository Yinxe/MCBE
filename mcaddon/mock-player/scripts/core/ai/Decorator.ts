// ─── 装饰节点 ────────────────────────────────────────────
// 装饰器 = 包装一个子节点，改变其结果/执行语义。
// 组合示例：
//   new Cooldown(new Sequence([...]), 40)      —— 扫描失败后 40 tick 冷却防抖动
//   new Inverter(new Condition(cond))          —— 条件取反
//   new AlwaysSucceed(new Action(fn))          —— 可选步骤（失败不中断整体）
//   new RepeatUntilSuccess(child, 3)           —— 重试直到成功（最多 3 次）

import type { AiContext, Node } from "./Node";
import { Status } from "./Status";

/** 失败冷却：子节点 Failure 后，冷却期内直接返回 Failure（上层 Selector 降级） */
export class Cooldown implements Node {
  private failedAtTick = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly child: Node,
    private readonly ticks: number,
  ) {}

  async tick(ctx: AiContext): Promise<Status> {
    if (ctx.tick - this.failedAtTick < this.ticks) return Status.Failure;
    const status = await this.child.tick(ctx);
    if (status === Status.Failure) this.failedAtTick = ctx.tick;
    return status;
  }
}

/** 取反：Success ↔ Failure（Running 保持） */
export class Inverter implements Node {
  constructor(private readonly child: Node) {}

  async tick(ctx: AiContext): Promise<Status> {
    const status = await this.child.tick(ctx);
    if (status === Status.Success) return Status.Failure;
    if (status === Status.Failure) return Status.Success;
    return Status.Running;
  }
}

/** 强制成功：包装可选步骤——子节点失败不影响整体（如"尽力而为"的清理动作） */
export class AlwaysSucceed implements Node {
  constructor(private readonly child: Node) {}

  async tick(ctx: AiContext): Promise<Status> {
    await this.child.tick(ctx);
    return Status.Success;
  }
}

/** 强制失败：包装必败步骤（测试/占位用） */
export class AlwaysFail implements Node {
  constructor(private readonly child: Node) {}

  async tick(ctx: AiContext): Promise<Status> {
    await this.child.tick(ctx);
    return Status.Failure;
  }
}

/**
 * 重试直到成功：每次 tick 执行一次子节点——
 * Success → Success（完成）；Failure → Running（保持，下次 tick 再试）；
 * Running → Running（子节点自身进行中）。
 * ⚠️ 注意与"同 tick 内循环"不同：本节点跨 tick 重试，天然防 CPU 风暴；
 *   maxAttempts 到达仍失败 → Failure。
 */
export class RepeatUntilSuccess implements Node {
  private attempts = 0;

  constructor(
    private readonly child: Node,
    private readonly maxAttempts: number = Infinity,
  ) {}

  async tick(ctx: AiContext): Promise<Status> {
    if (this.attempts >= this.maxAttempts) return Status.Failure;
    this.attempts++;
    const status = await this.child.tick(ctx);
    if (status === Status.Failure) {
      // 尝试次数已用完 → Failure；否则 Running（下次 tick 再试）
      return this.attempts >= this.maxAttempts ? Status.Failure : Status.Running;
    }
    return status;
  }
}
