// ─── 等待节点 ────────────────────────────────────────────
// 等待 N tick 后返回 success（期间 running 保持）。
// 计时基于 ctx.tick（引擎注入），无定时器、无副作用——纯决策层语义，
// 用于"冷却后再试""阶段间停顿"等场景。
// ⚠️ 黑板键按实例唯一（模块级自增 id），多实例并存互不干扰。

import type { AiContext, Node } from "./Node";
import type { Status } from "./Status";

let waitInstanceId = 0;

export class WaitForTicks implements Node {
  private readonly key: string;

  constructor(private readonly ticks: number) {
    this.key = `waitStart:${waitInstanceId++}`;
  }

  tick(ctx: AiContext): Status {
    const started = ctx.blackboard.get<number>(this.key) ?? ctx.tick;
    ctx.blackboard.set(this.key, started);
    if (ctx.tick - started >= this.ticks) {
      ctx.blackboard.delete(this.key); // 完成即清理，下次重新计时
      return "success";
    }
    return "running";
  }
}
