// ─── 假人独立引擎（core 层零依赖，可 node 单测） ──────
// 每个 MockBot 一个 BotEngine 实例：注册式持续能力（Capability）+
// 复杂任务（Task）独立调度。mc 层由 BotManager 全局驱动器每 tick 调
// engine.tick(ctx)。
//
// 设计约定（试错分支教训）：
// - 能力由**标签状态**驱动（enabled 判定），标签是状态不是动作信号——
//   setTags 唯一渠道落库后引擎自然启停，无重复发布/重复执行
// - 任务一次一活跃（互斥），队列预留后续扩展
// - 单能力/单任务异常隔离（崩溃不影响其他能力与其他假人）

/** 引擎执行上下文（mc 层实现：tags 读 record、entity 全守卫解析） */
export interface BotContext {
  /** 当前假人标签（能力启停判定；只读） */
  readonly tags: readonly string[];
  /** 引擎已推进的 tick 数 */
  readonly tick: number;
}

/** 持续能力：注册后按 tickInterval 周期执行；enabled 由标签等状态驱动 */
export interface BotCapability {
  /** 唯一 ID（注册/启停判定用） */
  id: string;
  /** 执行间隔（tick；>=1） */
  tickInterval: number;
  /** 是否启用（默认 true；标签驱动） */
  enabled?: (ctx: BotContext) => boolean;
  /** 周期执行（引擎异常隔离） */
  tick(ctx: BotContext): void;
  /** 停用清理（如 stopBreakingBlock；引擎在启用→停用切换时调用一次） */
  onDisabled?: (ctx: BotContext) => void;
}

/** 复杂任务：一次一活跃任务，start → tick 推进 → isDone 完成 */
export interface BotTask {
  /** 唯一 ID */
  id: string;
  /** 进入活跃时调用一次（如启动导航） */
  start?: (ctx: BotContext) => void;
  /** 每 tick 推进（引擎异常隔离） */
  tick(ctx: BotContext): void;
  /** 是否完成（完成 → 移除 + onTaskComplete 回调） */
  isDone(ctx: BotContext): boolean;
  /** 取消时调用（移除 + onTaskCancel 回调） */
  cancel?: (ctx: BotContext) => void;
}

/** 能力内部状态（间隔计数 + 启用状态跟踪） */
interface CapabilityState {
  cap: BotCapability;
  counter: number;
  wasEnabled: boolean;
}

/**
 * 假人独立引擎：每 tick 推进能力调度（counter 累计到间隔触发，
 * enabled 状态切换自动 onDisabled 清理）→ 活跃任务推进（isDone → 完成）。
 */
export class BotEngine {
  private readonly capabilities = new Map<string, CapabilityState>();
  private readonly taskQueue: BotTask[] = [];
  private tickCount = 0;

  /** 任务完成回调（负载：任务 id） */
  onTaskComplete: ((taskId: string) => void) | undefined;
  /** 任务取消回调（负载：任务 id） */
  onTaskCancel: ((taskId: string) => void) | undefined;

  /** 每 tick 推进（由 BotManager 驱动器对在线假人调用） */
  tick(ctx: BotContext): void {
    this.tickCount++;

    // ── 1. 能力调度：enabled 切换 → 周期触发 / 停用清理 ──
    for (const state of this.capabilities.values()) {
      const enabled = state.cap.enabled ? state.cap.enabled(ctx) : true;
      if (enabled) {
        state.counter++;
        if (state.counter >= state.cap.tickInterval) {
          state.counter = 0;
          try {
            state.cap.tick(ctx);
          } catch (e: any) {
            console.warn(`[BotEngine] 能力 ${state.cap.id} 异常: ${e?.message ?? e}`);
          }
        }
      } else if (state.wasEnabled) {
        // 启用 → 停用：清理残留（只调用一次）
        try {
          state.cap.onDisabled?.(ctx);
        } catch (e: any) {
          console.warn(`[BotEngine] 能力 ${state.cap.id} 停用清理异常: ${e?.message ?? e}`);
        }
      }
      state.wasEnabled = enabled;
    }

    // ── 2. 活跃任务推进（一次一任务） ──
    const task = this.taskQueue[0];
    if (task) {
      try {
        task.tick(ctx);
      } catch (e: any) {
        console.warn(`[BotEngine] 任务 ${task.id} 异常: ${e?.message ?? e}`);
      }
      if (task.isDone(ctx)) {
        this.taskQueue.shift();
        this.onTaskComplete?.(task.id);
      }
    }
  }

  // ── 能力注册 ──

  /** 注册持续能力（重复 id 覆盖旧定义，计数清零） */
  addCapability(cap: BotCapability): void {
    this.capabilities.set(cap.id, { cap, counter: 0, wasEnabled: false });
  }

  /** 移除能力 */
  removeCapability(id: string): void {
    this.capabilities.delete(id);
  }

  /** 是否已注册 */
  hasCapability(id: string): boolean {
    return this.capabilities.has(id);
  }

  // ── 任务调度 ──

  /** 启动任务（一次一活跃任务；已有活跃 → 拒绝并返回 false） */
  startTask(task: BotTask, ctx: BotContext): boolean {
    if (this.taskQueue.length > 0) return false;
    this.taskQueue.push(task);
    try {
      task.start?.(ctx);
    } catch (e: any) {
      console.warn(`[BotEngine] 任务 ${task.id} 启动异常: ${e?.message ?? e}`);
    }
    return true;
  }

  /** 取消当前活跃任务（无活跃 → false） */
  cancelTask(ctx: BotContext): boolean {
    const task = this.taskQueue.shift();
    if (!task) return false;
    try {
      task.cancel?.(ctx);
    } catch (e: any) {
      console.warn(`[BotEngine] 任务 ${task.id} 取消异常: ${e?.message ?? e}`);
    }
    this.onTaskCancel?.(task.id);
    return true;
  }

  /** 当前活跃任务 id（无 → undefined） */
  get activeTaskId(): string | undefined {
    return this.taskQueue[0]?.id;
  }

  /** 引擎已推进的 tick 数（能力/任务可读） */
  get currentTick(): number {
    return this.tickCount;
  }
}
