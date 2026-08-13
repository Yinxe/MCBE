// ─── 条件节点 ────────────────────────────────────────────
// 谓词包装：true → success，false → failure（纯同步，无副作用）。

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

export class Condition implements Node {
  constructor(private readonly test: (ctx: AiContext) => boolean) {}

  tick(ctx: AiContext): Status {
    return this.test(ctx) ? "success" : "failure";
  }
}
