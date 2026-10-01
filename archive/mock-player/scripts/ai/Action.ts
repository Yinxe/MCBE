// ─── 动作节点（叶子） ────────────────────────────────────
// 执行一个动作（控制语义，三态）：同步返回 Status，或返回 Promise<Status>
// （协程式异步叶子，长时间动作内部自行检查取消条件）。
//   Success  动作已完成
//   Failure  动作失败（父节点降级）
//   Running  动作进行中（父节点挂住等待，防重复启动）
// ⚠️ 防重入（3.3.8）：协程未完成时再次 tick → 返回 Running，不重复启动
//   （引擎每 10 tick 推进一次树，工作流协程挂起在 await 期间必须有此
//   守卫，否则每 tick 都会启动一个新协程并发执行）。

import type { AiContext, Node } from "./Node";
import { Status } from "./Status";

export type ActionFn = (ctx: AiContext) => Status | Promise<Status>;

export class Action implements Node {
  private inflight: Promise<Status> | undefined;

  constructor(private readonly run: ActionFn) {}

  tick(ctx: AiContext): Status | Promise<Status> {
    if (this.inflight) return Status.Running; // 防重入：上次协程未完成 → 挂起等待
    const result = this.run(ctx);
    if (result instanceof Promise) {
      this.inflight = result.finally(() => {
        this.inflight = undefined;
      });
      return this.inflight;
    }
    return result;
  }
}
