// ─── 动作节点（叶子） ────────────────────────────────────
// 执行一个动作（控制语义，三态）：同步返回 Status，或返回 Promise<Status>
// （协程式异步叶子，长时间动作内部自行检查取消条件）。
//   Success  动作已完成
//   Failure  动作失败（父节点降级）
//   Running  动作进行中（父节点挂住等待，防重复启动）

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

export type ActionFn = (ctx: AiContext) => Status | Promise<Status>;

export class Action implements Node {
  constructor(private readonly run: ActionFn) {}

  tick(ctx: AiContext): Status | Promise<Status> {
    return this.run(ctx);
  }
}
