// ─── core/ai 行为树框架统一出口 ─────────────────────────
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。

export type { Status } from "./Status";
export { Blackboard } from "./Blackboard";
export type { AiContext, Node } from "./Node";
export { Sequence, Selector } from "./Composite";
export { Cooldown } from "./Decorator";
export { Condition } from "./Condition";
export { Action, type ActionFn } from "./Action";
export { BehaviorTree } from "./Tree";
