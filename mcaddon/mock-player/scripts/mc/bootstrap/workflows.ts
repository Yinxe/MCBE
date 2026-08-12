// ─── 工作流注册中心（mc 层装配） ───────────────────────
// 全部工作流的注册与统一生命周期入口。
// 每个工作流单独一份实现文件，在此注册进 WorkflowManager；
// worldLoad 后调用 initAll() 初始化全部工作流（main.ts Phase 4）。
//
// 工作流 vs feature：feature 是基本简单原子功能（setSneaking/tpBotToPlayer），
// 工作流是复杂组合功能（劫掠循环/宝库循环）——有生命周期与事件机制。

import { WorkflowManager } from "../../core/service/Workflow";
import { raidWorkflow } from "../features/raidMode";
import { vaultWorkflow } from "../features/vaultMode";

/** 工作流管理器（单例）：注册 / 初始化 / 启停 / 查询 */
export const workflowManager = new WorkflowManager();

workflowManager.register(raidWorkflow);
workflowManager.register(vaultWorkflow);
