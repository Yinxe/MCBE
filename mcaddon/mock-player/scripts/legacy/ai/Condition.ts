// ─── 条件节点 ────────────────────────────────────────────
// 谓词包装（查询语义，二态即可）：true → Success，false → Failure
// （纯同步，无副作用）。
// ⚠️ 取反请用 not()（节点级取反，等价 new Inverter(this)）——切勿在谓词里
//    写 !condition 对象（对象取反恒 false，类型合法但逻辑恒错）。

import type { AiContext, Node } from "./Node";
import { Status } from "./Status";
import { Inverter } from "./Decorator";

export class Condition implements Node {
  constructor(private readonly test: (ctx: AiContext) => boolean) {}

  tick(ctx: AiContext): Status {
    return this.test(ctx) ? Status.Success : Status.Failure;
  }

  /** 取反便捷方法：等价 new Inverter(this)（"没目标" = hasTarget.not()） */
  not(): Node {
    return new Inverter(this);
  }
}
