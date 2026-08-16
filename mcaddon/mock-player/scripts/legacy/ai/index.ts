// ─── ai 行为树体系统一出口（框架 + 任务） ────────────────
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
// 分层：框架（节点/组合/装饰，不含具体任务）+ 任务（VaultTask/RaidTask/
//   FishingTask：端口 + 树装配，构建于框架之上）+ 劫掠/钓鱼规则。
// 具体任务的 mc 适配（VaultPorts 等）在 features/task/。

export { Status } from "./Status"; // 字符串枚举（值 + 类型）
export { Blackboard } from "./Blackboard";
export type { AiContext, Node } from "./Node";
export { Sequence, Selector, RandomSelector } from "./Composite";
export { Cooldown, Inverter, AlwaysSucceed, AlwaysFail, RepeatUntilSuccess } from "./Decorator";
export { Condition } from "./Condition";
export { Action, type ActionFn } from "./Action";
export { WaitForTicks } from "./WaitForTicks";
export { BehaviorTree } from "./Tree";

// 任务型模块（构建于框架之上，端口 + 树装配）
export * from "./VaultTask";
export * from "./RaidTask";
export * from "./FishingTask";
export * from "../../rules/RaidRules";
export * from "../../rules/FishingRules";
