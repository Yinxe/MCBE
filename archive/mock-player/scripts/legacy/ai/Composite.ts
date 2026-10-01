// ─── 组合节点 ────────────────────────────────────────────
// Sequence：按序执行，子节点 Success → 下一个；Failure/Running → 短路返回。
// Selector：按优先级（数组顺序）执行，子节点 Success/Running → 短路返回；
//   Failure → 降级下一个。无记忆：每 tick 从第一个子节点重新评估，
//   高优先级条件变化立即抢占（如"开箱"优于"寻路"）。
// RandomSelector：随机挑一个子节点执行（行为多样化/巡逻；非安全用途）。
//
// 抢占组合示例（goal 反应式选择，仿 Bedrock priority 组件）：
//   new Selector([
//     new Sequence([紧急条件, 逃跑动作]),      // 最高优先级：受击逃跑
//     new Sequence([任务条件, 任务动作]),      // 功能 goal
//     new Sequence([空闲条件, 空闲动作]),      // 兜底
//   ])——条件满足的分支胜出，条件变化下 tick 立即切换

import type { AiContext, Node } from "./Node";
import { Status } from "./Status";

/** 顺序执行：全部 Success 才 Success */
export class Sequence implements Node {
  constructor(private readonly children: Node[]) {}

  async tick(ctx: AiContext): Promise<Status> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status !== Status.Success) return status;
    }
    return Status.Success;
  }
}

/** 优先级选择：第一个非 Failure 的子树胜出（无记忆，每 tick 重评） */
export class Selector implements Node {
  constructor(private readonly children: Node[]) {}

  async tick(ctx: AiContext): Promise<Status> {
    for (const child of this.children) {
      const status = await child.tick(ctx);
      if (status !== Status.Failure) return status;
    }
    return Status.Failure;
  }
}

/** 随机选择：每次 tick 随机挑一个子节点执行（巡逻/行为多样化） */
export class RandomSelector implements Node {
  constructor(private readonly children: Node[]) {}

  async tick(ctx: AiContext): Promise<Status> {
    if (this.children.length === 0) return Status.Failure;
    const index = Math.floor(Math.random() * this.children.length);
    const child = this.children[index];
    if (!child) return Status.Failure;
    return child.tick(ctx);
  }
}
