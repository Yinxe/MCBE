// ─── 异步任务框架（core 层零依赖，可 node 单测） ──────
// 用户拍板：复杂流程（宝库持续交互等）采用 **Promise + await 异步阻塞式**——
// 流程线性清晰、可阻塞等待、超时异常感知与重试，不再用每 tick 状态机分支。
//
// BotAsyncTask：async 主流程（内部 await waitTicks/waitUntil/事件信号阻塞），
// 每轮循环检查 ctx.cancelled（取消标志）退出；AsyncTaskRunner 管理
// 互斥（一次一活跃任务）+ 取消（onCancel 回调让挂起的 await 立即 resolve）。
//
// ⚠️ async 协程由 JS 事件循环自推进（await system.runTimeout 的 Promise 真实
//    阻塞），不需要 BotEngine 每 tick 驱动；BotEngine 只保留持续能力（Capability）
//    的 tick 调度。

/** 异步任务执行上下文 */
export interface BotAsyncTaskContext {
  /** 取消标志（stop/关闭时置位；循环每轮检查退出） */
  readonly cancelled: boolean;
  /** 注册取消回调（挂起的 await 事件/定时器据此立即 resolve） */
  onCancel(callback: () => void): void;
  /** 请求取消（仅 AsyncTaskRunner 调用；任务内部不应自行取消） */
  cancel(): void;
}

/** 异步任务：run 为线性 async 主流程 */
export interface BotAsyncTask {
  /** 唯一 ID（互斥/查询用） */
  id: string;
  /** 异步主流程（内部 await 阻塞；检查 ctx.cancelled 退出；异常由调用方隔离） */
  run(ctx: BotAsyncTaskContext): Promise<void>;
}

/** 任务完成回调（负载：任务 id） */
export type AsyncTaskCallback = (taskId: string) => void;

/**
 * 异步任务运行器：一次一活跃任务（互斥）+ 取消 + 完成回调。
 * start 返回 false = 已有活跃任务（调用方提示/等待）。
 */
export class AsyncTaskRunner {
  private active: { task: BotAsyncTask; ctx: BotAsyncTaskContext } | undefined;

  /** 任务完成回调（完成或取消都触发） */
  onTaskDone: AsyncTaskCallback | undefined;

  /**
   * 启动异步任务（一次一活跃；已有活跃 → false）。
   * 任务异常被隔离（console.warn），完成后触发 onTaskDone。
   */
  start(task: BotAsyncTask, ctx: BotAsyncTaskContext, onDone?: AsyncTaskCallback): boolean {
    if (this.active) return false;
    this.active = { task, ctx };
    const prev = this.onTaskDone;
    this.onTaskDone = (id) => {
      prev?.(id);
      onDone?.(id);
    };
    task
      .run(ctx)
      .catch((e: any) => {
        console.warn(`[AsyncTask] ${task.id} 异常: ${e?.message ?? e}`);
      })
      .finally(() => {
        this.active = undefined;
        const done = this.onTaskDone;
        this.onTaskDone = undefined;
        done?.(task.id);
      });
    return true;
  }

  /** 取消当前活跃任务（无活跃 → false）；挂起的 await 经 onCancel 立即 resolve */
  cancel(): boolean {
    if (!this.active) return false;
    const { task, ctx } = this.active;
    ctx.cancel();
    console.info(`[AsyncTask] ${task.id} 已取消`);
    return true;
  }

  /** 当前活跃任务 id（无 → undefined） */
  get activeTaskId(): string | undefined {
    return this.active?.task.id;
  }

  /** 是否有活跃任务 */
  isRunning(): boolean {
    return this.active !== undefined;
  }
}

/** 取消上下文实现（cancelled 标志 + onCancel 回调集） */
export class CancellationToken implements BotAsyncTaskContext {
  private cancelledFlag = false;
  private readonly cancelCallbacks = new Set<() => void>();

  get cancelled(): boolean {
    return this.cancelledFlag;
  }

  onCancel(callback: () => void): void {
    if (this.cancelledFlag) {
      // 已取消 → 立即回调（挂起等待即刻放行）
      callback();
      return;
    }
    this.cancelCallbacks.add(callback);
  }

  /** 置取消标志 + 通知全部挂起等待 */
  cancel(): void {
    if (this.cancelledFlag) return;
    this.cancelledFlag = true;
    for (const cb of [...this.cancelCallbacks]) {
      try {
        cb();
      } catch {
        /* 单回调异常隔离 */
      }
    }
    this.cancelCallbacks.clear();
  }
}
