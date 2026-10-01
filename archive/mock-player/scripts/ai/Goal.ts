// ─── 目标（索敌目标，core/ai） ───────────────────────
// 生物大脑的可插拔能力单元（wiki 意向系统的索敌目标 Goal）：
//   生命周期（3.3.8 补全，对齐官方 canUse/canContinueToUse/start/stop）：
//     - canActivate：开始条件（每 tick 评估，通常读共享记忆；≈官方 canUse）
//     - canContinue：延续条件（缺省 = canActivate；运行中条件失效 → 引擎
//       abort 中断，≈官方 canContinueToUse——"结束目标"的显式条件）
//     - 达成：执行体（tree）返回 Success/Failure = 本轮目标结束，下轮重评
//       （持续行为的工作流循环退出即达成；引擎不重复启动——Action 防重入）
//     - abort：被抢占/失效中断钩子（取消协程副作用）
//   priority 数字越小越优先（官方语义）；onActivate 启动钩子（如打断
//   导航）；flags 预留 wiki 旗标冲突机制（Move/Look/Jump），v1 单主目标
//   调度暂不并行。能力可插拔 = registerGoal/unregisterGoal。

import type { AiMemory } from "./Memory";
import type { BehaviorTree } from "./Tree";
import type { AiContext } from "./Node";

/** 行为树上下文 + 共享记忆（大脑级上下文） */
export interface AiBrainContext extends AiContext {
  /** 大脑共享记忆（跨目标感知） */
  memory: AiMemory;
}

/** 旗标（wiki：Move/Look/Jump 三类控制器，同旗标目标不能并行；v1 预留） */
export interface AiGoalFlags {
  move?: boolean;
  look?: boolean;
  jump?: boolean;
}

/** 索敌目标（能力单元） */
export interface AiGoal {
  name: string;
  /** 优先级：数字越小越优先（官方语义；高优先级打断低优先级） */
  priority: number;
  /** 旗标（预留 wiki 冲突机制；v1 单主目标调度暂不并行） */
  flags?: AiGoalFlags;
  /** 是否可启用（每 tick 评估；通常读共享记忆，如 hasTag/威胁存在） */
  canActivate(ctx: AiBrainContext): boolean;
  /**
   * 是否可延续（运行中每 tick 评估；缺省 = canActivate——开始条件持续
   * 满足则继续）。条件失效 → 引擎 abort 中断当前目标（"结束目标"的显式
   * 条件，≈官方 canContinueToUse）。达成（任务完成）不在此表达——执行体
   * 返回 Success/Failure 即本轮结束，下轮重新评估。
   */
  canContinue?(ctx: AiBrainContext): boolean;
  /** 启动钩子（高优先级抢占/首次启动时调用；如 stopNavigation 清理） */
  onActivate?(ctx: AiBrainContext): void;
  /** 中止钩子（被更高优先级目标抢占时调用；取消进行中的协程副作用，缺省 no-op） */
  abort?(): void;
  /** 执行体（行为树；Success/Failure 表示该轮目标结束，下轮重新评估） */
  tree?: BehaviorTree;
  /** 惰性建树（可选：首次激活时构建；树随 reconcile 清理重建） */
  ensureTree?(ctx: AiBrainContext): BehaviorTree;
  /** 释放回调（tag 移除/reconcile 时清理树） */
  dispose?(): void;
}
