// ─── core/ai 行为树框架统一出口 ─────────────────────────
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
// 分层约定：core/ai = 生物 AI 编排框架（节点/组合/装饰，不含具体任务）；
//   具体任务（宝库/砍树/钓鱼）在 core/tasks/。

export type { Status } from "./Status";
export { Blackboard } from "./Blackboard";
export type { AiContext, Node } from "./Node";
export { Sequence, Selector, RandomSelector } from "./Composite";
export { Cooldown, Inverter, AlwaysSucceed, AlwaysFail, RepeatUntilSuccess } from "./Decorator";
export { Condition } from "./Condition";
export { Action, type ActionFn } from "./Action";
export { WaitForTicks } from "./WaitForTicks";
export { BehaviorTree } from "./Tree";
