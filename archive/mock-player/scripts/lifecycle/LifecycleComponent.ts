// ─── 生命周期组件接口（OOP 核心契约） ───────────────
// 每个生命周期能力以组件形式注入 BotLifecycle 编排器。
// 组件实现关注单一职责，通过优先级控制执行顺序，
// 通过抛错可中断前置守卫（before*），后置钩子异常被隔离不影响主流程。
// 支持两种集成方式：
//   1. 实现接口 hook（被编排器主动调用）
//   2. 订阅 LifecycleEvents / BotEvents（事件驱动被动响应）
// 推荐前者处理强依赖编排（配额校验、落库），后者处理弱联动（通知、统计）。

import type { BotRecord } from "../rules/Types";
import type { LifecycleContext } from "./LifecycleContext";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

// ─── 组件接口 ────────────────────────────────────────

export interface LifecycleComponent {
  /** 组件唯一 id，用于去重/卸载/日志 */
  readonly id: string;
  /** 优先级越小越先执行（默认 100）；守卫类 10，核心 50，通知类 200 */
  readonly priority?: number;

  // ── 注册周期 ──
  onRegister?(ctx: LifecycleContext): void;
  onUnregister?(ctx: LifecycleContext): void;

  // ── 创建 ──
  /** 创建前守卫（可抛错中断创建） */
  onBeforeCreate?(ctx: LifecycleContext, options: CreateOptions): Promise<void> | void;
  /** 创建成功后（实体已生成并完成 finalize） */
  onAfterCreate?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;

  // ── 上线 ──
  onBeforeOnline?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;
  onAfterOnline?(ctx: LifecycleContext, record: BotRecord, bot: SimulatedPlayer): Promise<void> | void;

  // ── 下线 ──
  onBeforeOffline?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;
  onAfterOffline?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;

  // ── 删除 ──
  onBeforeDelete?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;
  onAfterDelete?(ctx: LifecycleContext, botName: string): Promise<void> | void;

  // ── 击杀 / 死亡 / 复活 ──
  onBeforeKill?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;
  onDeath?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;
  onRespawn?(ctx: LifecycleContext, record: BotRecord): Promise<void> | void;

  // ── 世界加载 ──
  onWorldLoad?(ctx: LifecycleContext, records: BotRecord[]): Promise<void> | void;
}

// ─── 创建选项（供组件校验用，与 features/manage/createBot.CreateBotOptions 对齐但解耦 mc 类型） ─

export interface CreateOptions {
  /** 原始输入名（未规范化） */
  rawName: string;
  /** 规范化后完整名 */
  name: string;
  ownerName: string;
  location: { x: number; y: number; z: number };
  dimensionId: string;
  initialTags: string[];
  rotation: { x: number; y: number };
  lookTarget: { x: number; y: number; z: number };
  isSneaking: boolean;
  spawnMode?: "normal" | "chunkload";
}
