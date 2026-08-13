// ─── 条件节点 ────────────────────────────────────────────
// 谓词包装（查询语义，二态即可）：true → Success，false → Failure
// （纯同步，无副作用）。

import type { AiContext, Node } from "./Node";
import { Status } from "./Status";

export class Condition implements Node {
  constructor(private readonly test: (ctx: AiContext) => boolean) {}

  tick(ctx: AiContext): Status {
    return this.test(ctx) ? Status.Success : Status.Failure;
  }
}
