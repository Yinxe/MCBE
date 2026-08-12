// ─── 工作流框架（core 层，零 @minecraft） ──────────────
// 工作流 vs 普通 feature 的区别：
//   - feature：基本简单原子功能（如 setSneaking / tpBotToPlayer / saveSlot）
//   - 工作流：复杂组合功能——有生命周期（init/start/stop）+ 运行状态 + 事件机制
//             （如劫掠模式：喝瓶 → 袭击 → 胜利 → 下一瓶 的循环组合；
//              宝库模式：钥匙消耗 → 重连 → 再开 的组合）
// 每个工作流单独定义一份实现文件（如 raidWorkflow.ts / vaultWorkflow.ts），
// 实现 Workflow 接口，由 WorkflowManager 统一注册/初始化/启停。
// 事件机制复用 core/events/EventSignal（订阅者异常隔离）；事件负载只用
// 可序列化的 string/number——保持 core 纯净可单测。

import type { IntervalScheduler } from "../storage/IntervalScheduler";

/** 工作流整体状态 */
export type WorkflowStatus = "idle" | "running" | "stopped";

/**
 * 工作流独立引擎：每个工作流自带周期调度（不共享统一行为引擎）。
 * 由 WorkflowManager 在 initAll 时按 intervalTicks 创建独立 interval，
 * 单工作流 tick 异常隔离（不影响其他工作流与引擎本身）。
 */
export interface WorkflowEngine {
  /** 引擎周期（tick） */
  intervalTicks: number;
  /** 每周期处理逻辑（遍历本工作流关联的假人并推进） */
  tick(): void;
}

/**
 * 工作流生命周期接口。
 * 每个工作流一个实现文件，导出单例（如 `export const raidWorkflow: Workflow`）。
 * 简单重复功能（autoMine 等）留在统一行为引擎（feature 层）；
 * 复杂组合功能（劫掠/宝库循环）封装为工作流，**自带独立引擎**（engine 可选）。
 * 工作流对外事件走**领域事件模式**（core/events/WorkflowEvents，BotWorkflowEvent.xxx
 * 每个事件一个独立信号），不在接口内合并总线。
 */
export interface Workflow {
  /** 工作流唯一名（注册键，如 "raid-mode"） */
  readonly name: string;
  /** 工作流简述（日志/调试用） */
  readonly description?: string;
  /**
   * 初始化：注册全局事件监听、准备资源。
   * worldLoad 后由 WorkflowManager.initAll 调用一次（幂等）。
   */
  init(): void;
  /** 开始：进入运行状态（开启开关/上线/重生时；botName 缺省 = 全局工作流） */
  start(botName?: string): void;
  /** 停止：结束运行状态（关开关/下线/删除时） */
  stop(botName?: string): void;
  /** 是否处于运行状态 */
  isRunning(botName?: string): boolean;
  /** 独立引擎（可选）：由 WorkflowManager 统一调度，每个工作流独立 interval */
  readonly engine?: WorkflowEngine;
}

/**
 * 工作流管理器：统一注册 / 初始化 / 启停 / 查询 + 独立引擎调度。
 * 引擎调度经 IntervalScheduler 端口注入（mc 层用 system.runInterval 后端，
 * 测试用 MemoryIntervalScheduler 手动推进）；未注入 scheduler 时不启动引擎。
 */
export class WorkflowManager {
  private readonly workflows = new Map<string, Workflow>();
  private readonly engineHandles = new Map<string, { clear(): void }>();

  constructor(private readonly scheduler?: IntervalScheduler) {}

  /** 注册工作流（重名抛错，防重复注册） */
  register(workflow: Workflow): void {
    if (this.workflows.has(workflow.name)) {
      throw new Error(`工作流重复注册: ${workflow.name}`);
    }
    this.workflows.set(workflow.name, workflow);
  }

  /** 初始化全部工作流（worldLoad 后调用一次；单工作流失败隔离）；带引擎的工作流启动独立 interval */
  initAll(): void {
    for (const wf of this.workflows.values()) {
      try {
        wf.init();
        // 独立引擎：每个工作流自己的周期调度（不共享统一行为引擎）
        if (wf.engine && this.scheduler) {
          const handle = this.scheduler.createInterval(() => {
            try {
              wf.engine!.tick();
            } catch (e) {
              console.warn(`[Workflow] ${wf.name} 引擎 tick 异常: ${e}`);
            }
          }, wf.engine.intervalTicks);
          this.engineHandles.set(wf.name, handle);
        }
        console.info(`[Workflow] ${wf.name} 已初始化${wf.engine ? `（引擎 ${wf.engine.intervalTicks}tick）` : ""}`);
      } catch (e) {
        console.warn(`[Workflow] ${wf.name} 初始化失败: ${e}`);
      }
    }
  }

  /** 停止全部工作流引擎（世界卸载/清理时） */
  shutdown(): void {
    for (const handle of this.engineHandles.values()) {
      try {
        handle.clear();
      } catch {
        /* 忽略 */
      }
    }
    this.engineHandles.clear();
  }

  /** 启动工作流（不存在的名字仅告警，不抛错——多模组共存的容错） */
  start(name: string, botName?: string): void {
    const wf = this.workflows.get(name);
    if (!wf) {
      console.warn(`[Workflow] 未知工作流: ${name}`);
      return;
    }
    wf.start(botName);
  }

  /** 停止工作流 */
  stop(name: string, botName?: string): void {
    const wf = this.workflows.get(name);
    if (!wf) {
      console.warn(`[Workflow] 未知工作流: ${name}`);
      return;
    }
    wf.stop(botName);
  }

  /** 查询工作流运行状态 */
  isRunning(name: string, botName?: string): boolean {
    return this.workflows.get(name)?.isRunning(botName) ?? false;
  }

  /** 取工作流实例 */
  get(name: string): Workflow | undefined {
    return this.workflows.get(name);
  }

  /** 已注册工作流名列表 */
  list(): string[] {
    return [...this.workflows.keys()];
  }
}
