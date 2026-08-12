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

import { EventSignal } from "../events/EventSignal";

/** 工作流整体状态 */
export type WorkflowStatus = "idle" | "running" | "stopped";

/** 工作流对外事件（可序列化负载） */
export interface WorkflowEvent {
  /** 工作流名（如 "raid-mode"） */
  workflow: string;
  /** 事件类型（如 "raid-victory"、"vault-opened"） */
  type: string;
  /** 关联假人名（无则省略） */
  botName?: string;
  /** 附加数据（只用可序列化 string/number/数组/对象） */
  data?: unknown;
}

/**
 * 工作流生命周期接口。
 * 每个工作流一个实现文件，导出单例（如 `export const raidWorkflow: Workflow`）。
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
  /** 工作流对外事件总线（其他模块订阅联动） */
  readonly events: EventSignal<WorkflowEvent>;
}

/** 工作流管理器：统一注册 / 初始化 / 启停 / 查询 */
export class WorkflowManager {
  private readonly workflows = new Map<string, Workflow>();

  /** 注册工作流（重名抛错，防重复注册） */
  register(workflow: Workflow): void {
    if (this.workflows.has(workflow.name)) {
      throw new Error(`工作流重复注册: ${workflow.name}`);
    }
    this.workflows.set(workflow.name, workflow);
  }

  /** 初始化全部工作流（worldLoad 后调用一次；单工作流失败隔离） */
  initAll(): void {
    for (const wf of this.workflows.values()) {
      try {
        wf.init();
        console.info(`[Workflow] ${wf.name} 已初始化`);
      } catch (e) {
        console.warn(`[Workflow] ${wf.name} 初始化失败: ${e}`);
      }
    }
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
