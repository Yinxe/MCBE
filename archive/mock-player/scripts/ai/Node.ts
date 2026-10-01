// ─── 行为树节点基座 ──────────────────────────────────────
// AiContext：每次 tick 注入的上下文（引擎 tick 计数；共享记忆由
// AiBrainContext 扩展——能力工作流经 GoalSelector 注入）。
// Node.tick：同步返回或异步（Promise）返回 Status。
//   - 异步叶子采用"协程式"：await 期间整棵树挂起（防重入由引擎层负责），
//     长时间动作需在动作内部自行检查取消条件提前返回。

import type { Status } from "./Status";

export interface AiContext {
  /** 假人名（树按假人隔离，动作端口据此取实体/记录） */
  readonly botName: string;
  /** 引擎 tick 计数（冷却/节流判定用） */
  readonly tick: number;
}

export interface Node {
  tick(ctx: AiContext): Status | Promise<Status>;
}
