// ─── 生命周期模块 Barrel ─────────────────────
export * from "./LifecycleEvents";
export * from "./LifecycleComponent";
export * from "./LifecycleContext";
export * from "./BotLifecycle";
export * from "./components/QuotaComponent";
export * from "./components/NameGuardComponent";
export * from "./components/TickingAreaComponent";
export * from "./components/InventoryComponent";
export * from "./components/CleanupComponent";
export * from "./components/LoggingComponent";
export * from "./components/SessionComponent";
export * from "./components/DeathComponent";
export * from "./components/PositionComponent";
export * from "./components/SpawnComponent";
export * from "./components/AutoOnlineComponent";

// 快捷工厂：基于给定上下文创建并注册默认组件的生命周期实例
import { BotLifecycle } from "./BotLifecycle";
import type { LifecycleContext } from "./LifecycleContext";
import { QuotaComponent } from "./components/QuotaComponent";
import { NameGuardComponent } from "./components/NameGuardComponent";
import { TickingAreaComponent } from "./components/TickingAreaComponent";
import { InventoryComponent } from "./components/InventoryComponent";
import { CleanupComponent } from "./components/CleanupComponent";
import { LoggingComponent } from "./components/LoggingComponent";
import { SessionComponent } from "./components/SessionComponent";
import { DeathComponent } from "./components/DeathComponent";
import { PositionComponent } from "./components/PositionComponent";
import { SpawnComponent } from "./components/SpawnComponent";
import { AutoOnlineComponent } from "./components/AutoOnlineComponent";

/**
 * 创建带默认组件的 BotLifecycle 实例（开箱即用）。
 * 调用方（bootstrap/context）只需提供 ctx，即可得到完整编排器。
 * 组件按 priority 升序执行：
 *  守卫10 → 校验11 → 生成20 → 会话30 → 死亡40 → 库存60 → 位置70 → 辅助80 → 自动上线85 → 清理90 → 日志200
 */
export function createDefaultLifecycle(ctx: LifecycleContext): BotLifecycle {
  const lc = new BotLifecycle(ctx);
  lc.use(new QuotaComponent(ctx));
  lc.use(new NameGuardComponent());
  lc.use(new SpawnComponent());
  lc.use(new SessionComponent());
  lc.use(new DeathComponent());
  lc.use(new InventoryComponent());
  lc.use(new PositionComponent());
  lc.use(new TickingAreaComponent());
  lc.use(new AutoOnlineComponent());
  lc.use(new CleanupComponent());
  lc.use(new LoggingComponent());
  return lc;
}

/**
 * 扩展示例：如何注入自定义组件丰富生命周期
 * @example
 * ```ts
 * import { botLifecycle } from "./bootstrap/context";
 * import type { LifecycleComponent } from "./lifecycle/LifecycleComponent";
 *
 * class MyMetricsComponent implements LifecycleComponent {
 *   readonly id = "metrics";
 *   readonly priority = 150;
 *   async onAfterOnline(ctx, record, bot) {
 *     // 上报指标、统计在线时长等
 *   }
 * }
 * botLifecycle.use(new MyMetricsComponent());
 * ```
 */
