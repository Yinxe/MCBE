// ─── core/ai 生物大脑框架统一出口 ─────────────────────────
// 零 @minecraft 依赖，可被 tsconfig.test.json 单独编译进 node 测试。
// 分层约定：core/ai = 生物 AI 编排框架（行为树基础 + 生物大脑：
//   共享记忆/感受器/目标/目标选择器，不含具体能力）；
//   能力决策规则与领域事件在 core/rules/。
// ⚠️ 3.2.1：旧任务编排遗留已清理（Sequence/Selector/装饰器/Condition/
//   WaitForTicks/Blackboard 随任务树架构退役——能力 = 扁平工作流，
//   仅用 Action/BehaviorTree/Status）。

export { Status } from "./Status"; // 字符串枚举（值 + 类型）
export type { AiContext, Node } from "./Node";
export { Action, type ActionFn } from "./Action";
export { BehaviorTree } from "./Tree";
export { AiMemory } from "./Memory";
export { SensorRunner, type AiSensor, type AiSensorContext } from "./Sensor";
export type { AiBrainContext, AiGoal, AiGoalFlags } from "./Goal";
export { GoalSelector } from "./GoalSelector";
export { ResourceLock } from "./ResourceLock";
export { BehaviorRunner, type Behavior, type BehaviorContext } from "./Behavior";
