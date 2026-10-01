// ─── 日志组件（示例：事件驱动增强） ───────────
// 演示如何通过订阅 LifecycleEvents 而非实现 hook 来丰富生命周期。
// 零侵入：仅监听事件做日志/监控，不干扰主流程。
// 优先级 200：最后执行，仅观察。

import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import { LifecycleEvents } from "../LifecycleEvents";

export class LoggingComponent implements LifecycleComponent {
  readonly id = "logging";
  readonly priority = 200;

  private unsubs: (() => void)[] = [];

  onRegister(_ctx: LifecycleContext): void {
    this.unsubs.push(
      LifecycleEvents.beforeCreate.subscribe((e) => console.info(`[Lifecycle:log] beforeCreate ${e.name} owner=${e.ownerName}`)),
      LifecycleEvents.afterCreate.subscribe((e) => console.info(`[Lifecycle:log] afterCreate ${e.record.name} online=${e.record.online}`)),
      LifecycleEvents.createFailed.subscribe((e) => console.warn(`[Lifecycle:log] createFailed ${e.botName}: ${e.error}`)),
      LifecycleEvents.beforeOnline.subscribe((e) => console.info(`[Lifecycle:log] beforeOnline ${e.botName}`)),
      LifecycleEvents.afterOnline.subscribe((e) => console.info(`[Lifecycle:log] afterOnline ${e.botName} @ ${e.dimension}`)),
      LifecycleEvents.onlineFailed.subscribe((e) => console.warn(`[Lifecycle:log] onlineFailed ${e.botName}: ${e.error}`)),
      LifecycleEvents.beforeOffline.subscribe((e) => console.info(`[Lifecycle:log] beforeOffline ${e.botName}`)),
      LifecycleEvents.afterOffline.subscribe((e) => console.info(`[Lifecycle:log] afterOffline ${e.botName}`)),
      LifecycleEvents.offlineFailed.subscribe((e) => console.warn(`[Lifecycle:log] offlineFailed ${e.botName}: ${e.error}`)),
      LifecycleEvents.beforeDelete.subscribe((e) => console.info(`[Lifecycle:log] beforeDelete ${e.botName}`)),
      LifecycleEvents.afterDelete.subscribe((e) => console.info(`[Lifecycle:log] afterDelete ${e.botName} reclaimed=${e.reclaimed}`)),
      LifecycleEvents.worldLoad.subscribe((e) => console.info(`[Lifecycle:log] worldLoad restored=${e.restoredCount}`)),
    );
    console.info(`[Lifecycle:log] 已订阅全部生命周期事件`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    for (const off of this.unsubs) try { off(); } catch {}
    this.unsubs = [];
  }
}
