// ─── 动作节点（叶子） ────────────────────────────────────
// 执行一个动作：同步返回 Status，或返回 Promise<Status>（协程式异步叶子，
// 长时间动作内部自行检查取消条件）。

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

export type ActionFn = (ctx: AiContext) => Status | Promise<Status>;

export class Action implements Node {
  constructor(private readonly run: ActionFn) {}

  tick(ctx: AiContext): Status | Promise<Status> {
    return this.run(ctx);
  }
}
