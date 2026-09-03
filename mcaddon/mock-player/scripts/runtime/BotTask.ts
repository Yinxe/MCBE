// ─── 假人任务运行时（事件驱动，替代旧 10 tick 生物 AI 引擎） ──
// 设计动机（用户拍板 2026-08-30）：生物 AI 方案（感知-决策每 10 tick 高频
// 计算）易导致游戏挂起崩溃，整体放弃。改为「任务运行时」：
//   - 任务 = 纯 async 协程（CancelToken 协作式取消），不轮询决策；
//   - 生命周期**事件驱动**：setWorkMode 发布 botWorkModeChanged / 上下线
//     事件 → 启动/停止/切换对应任务；无任何常驻轮询循环；
//   - 每假人至多一个活动任务（workMode 单选互斥天然保证）；
//   - 跨假人共享数据走 SharedMemory 单例（共享钓鱼点池/树资源池）。
//
// 任务类型（features/flow/tasks，见 flow 模块 AGENTS）：
//   timed   定时触发的循环任务（挖掘/放置/攻击——间隔 tick 反复执行动作）
//   event   基于事件的循环任务（劫掠模式——模块自订阅事件，不占本运行时轮询）
//   natural 基于自然复杂流程的循环任务（钓鱼/砍树/闲逛——while(true) 循环
//           运行一个单次流程）

import { system } from "@minecraft/server";

import { describeError, isCancelledError } from "../errors";
import { BotEvents } from "../events/DomainEvents";
import { createCancelToken } from "../rules/utils/CancelToken";
import type { CancelToken } from "../rules/utils/CancelToken";
import { botRegistry, configStore } from "../bootstrap/context";
import { SharedMemory } from "./SharedMemory";

// ─── 任务契约 ──────────────────────────────────────────

/** 任务类型：timed=定时循环 / event=事件驱动 / natural=自然流程循环 */
export type BotTaskKind = "timed" | "event" | "natural";

/** 任务运行上下文（运行时注入；token 取消即停止信号） */
export interface BotTaskContext {
  /** 假人名 */
  readonly botName: string;
  /** 取消令牌：运行时 stop/切换时 cancel()，任务在检测点退出 */
  readonly token: CancelToken;
  /** 跨假人共享记忆（全局单例） */
  readonly shared: SharedMemory;
}

/** 假人任务：一个 workMode 值对应一个任务实现 */
export interface BotTask {
  /** 认领的工作模式值（record.workMode；与 WORK_MODES 对齐） */
  readonly workMode: string;
  /** 任务类型（timed/event/natural） */
  readonly kind: BotTaskKind;
  /** 展示名（日志/告警用，中文） */
  readonly label: string;
  /**
   * 任务主体：token.cancelled 后尽快返回；自然完成（如砍树扫完全图无树）
   * 也直接 return——运行时以协程退出为任务结束标志。
   * @throws 实现内部应消化可恢复异常；未消化异常由运行时兜底记日志并终止任务
   */
  run(ctx: BotTaskContext): Promise<void>;
}

/** 运行中任务（占位 + 收尾句柄） */
interface ActiveTask {
  readonly botName: string;
  readonly workMode: string;
  readonly label: string;
  readonly token: CancelToken;
  /** 协程完成句柄（catch 已内联，永不 reject） */
  readonly done: Promise<void>;
}

// ─── 任务管理器 ────────────────────────────────────────

/** 假人任务管理器：注册任务 + 事件驱动对账（启动/停止/切换，幂等） */
export class BotTaskManager {
  /** workMode → 任务实现 */
  private readonly tasks = new Map<string, BotTask>();
  /** botName → 运行中任务 */
  private readonly active = new Map<string, ActiveTask>();
  /** botName → 收尾链（保证同假人停止/启动串行，避免切换竞态） */
  private readonly chains = new Map<string, Promise<void>>();

  /** 跨假人共享记忆（全局单例，注入任务 ctx.shared） */
  readonly shared = new SharedMemory();

  /** 注册任务（重复 workMode 视为定义错误，直接抛出） */
  register(task: BotTask): void {
    if (this.tasks.has(task.workMode)) {
      throw new Error(`任务注册冲突：workMode "${task.workMode}" 已有实现`);
    }
    this.tasks.set(task.workMode, task);
  }

  /** 已注册任务表（只读视图） */
  get registered(): readonly BotTask[] {
    return [...this.tasks.values()];
  }

  /** 假人是否有运行中任务 */
  isRunning(botName: string): boolean {
    return this.active.has(botName);
  }

  /** 假人当前运行任务（无则 undefined） */
  runningTaskOf(botName: string): { workMode: string; label: string } | undefined {
    const t = this.active.get(botName);
    return t ? { workMode: t.workMode, label: t.label } : undefined;
  }

  /**
   * 对账单个假人（幂等，事件驱动入口）：
   * 记录不可用/模式为 none/无注册任务/被管理员禁用 → 确保停止；
   * 已在跑同一模式 → 不动；否则停止旧任务后启动新任务。
   * @param botName 假人名
   */
  reconcile(botName: string): void {
    const record = botRegistry.get(botName);
    const mode = record && record.online && !record.death ? record.workMode : "none";
    const current = this.active.get(botName);
    if (current && current.workMode === mode) return; // 幂等：同模式运行中
    const runnable = !!mode && mode !== "none" && this.tasks.has(mode) && configStore.isWorkModeEnabled(mode);
    if (!runnable) {
      if (current) this.enqueue(botName, () => this.stop(botName));
      return;
    }
    this.enqueue(botName, async () => {
      await this.stop(botName);
      await this.start(botName, mode);
    });
  }

  /** 对账全部已记录假人（世界加载/运行时启动时一次性补启） */
  reconcileAll(): void {
    for (const record of botRegistry.all()) {
      this.reconcile(record.name);
    }
  }

  /** 停止假人任务（取消令牌 + 等待协程收尾；无任务则空操作） */
  async stop(botName: string): Promise<void> {
    const current = this.active.get(botName);
    if (!current) return;
    current.token.cancel(); // 幂等
    await current.done;
  }

  /** 停止全部任务（世界卸载/整体关停用） */
  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((name) => this.stop(name)));
  }

  // ─── 私有方法 ────────────────────────────────────────

  /** 串行化同假人的停止/启动操作（前序失败不阻塞后继） */
  private enqueue(botName: string, op: () => Promise<void>): void {
    const prev = this.chains.get(botName) ?? Promise.resolve();
    const next = prev.then(op, op);
    this.chains.set(
      botName,
      next.catch(() => undefined),
    );
  }

  /** 启动任务协程（调用方保证前置已停止/模式合法） */
  private async start(botName: string, mode: string): Promise<void> {
    const task = this.tasks.get(mode);
    if (!task) return;
    if (this.active.has(botName)) return; // 并发保护：已在跑（不该发生）

    const token = createCancelToken();
    const done = task
      .run({ botName, token, shared: this.shared })
      .catch((e: unknown) => {
        if (token.cancelled || isCancelledError(e)) return; // 取消属正常收尾
        console.warn(`[MockPlayer] 任务异常终止 ${botName}[${task.label}]: ${describeError(e)}`);
      })
      .finally(() => {
        // 仅当占位仍是本任务时清理（防误删切换后的新任务）
        const cur = this.active.get(botName);
        if (cur && cur.token === token) this.active.delete(botName);
      });
    this.active.set(botName, { botName, workMode: mode, label: task.label, token, done });
    console.info(`[MockPlayer] 任务启动 ${botName}[${task.label}]（${task.kind}）`);
  }
}

// ─── 共享记忆过期扫描 ──────────────────────────────────

/** 扫描间隔（tick）：每秒一次（20 tick = 1 秒） */
const SHARED_MEMORY_SWEEP_TICKS = 20;

/**
 * 启动共享记忆过期扫描（独立计时器，每秒一次，幂等）——
 * 过期键直接删除（sweepExpired 推进内部时钟 + 物理清理）。
 * @param memory 共享记忆实例
 */
export function startSharedMemorySweeper(memory: SharedMemory): void {
  system.runInterval(() => {
    const removed = memory.sweepExpired(system.currentTick);
    if (removed > 0) {
      console.warn(`[MockPlayer] 共享记忆过期清理 ${removed} 键（tick ${system.currentTick}）`);
    }
  }, SHARED_MEMORY_SWEEP_TICKS);
}

// ─── 全局运行时（模块级单例 + 事件装配） ────────────────

/** 全局任务管理器单例 */
export const taskManager = new BotTaskManager();

let runtimeStarted = false;

/**
 * 启动任务运行时（幂等；worldLoad 装配调用）：
 *   ① 共享记忆过期扫描  ② 订阅工作模式/上下线/死亡事件 → 事件驱动对账
 *   ③ 对全部记录做一次初始对账（重启恢复补启）
 */
export function startBotTaskRuntime(): void {
  if (runtimeStarted) return;
  runtimeStarted = true;

  startSharedMemorySweeper(taskManager.shared);

  // 工作模式变更（setWorkMode 落库后发布）→ 对账启动/停止/切换
  BotEvents.botWorkModeChanged.subscribe((e) => taskManager.reconcile(e.botName));
  // 上线（加入世界/重生实体重建）→ 补启
  BotEvents.botOnline.subscribe((e) => taskManager.reconcile(e.botName));
  // 下线/死亡 → 停止（下线事件由生命周期发布，任务令牌取消 → 协程退出）
  BotEvents.botOffline.subscribe((e) => {
    void taskManager.stop(e.botName);
  });
  BotEvents.botDeath.subscribe((e) => {
    void taskManager.stop(e.botName);
  });

  // 初始对账（重启恢复：记录已还原但事件已错过）
  taskManager.reconcileAll();
  console.info(
    `[MockPlayer] 任务运行时启动（事件驱动；任务: ${taskManager.registered.map((t) => t.workMode).join("/") || "无"}）`,
  );
}
