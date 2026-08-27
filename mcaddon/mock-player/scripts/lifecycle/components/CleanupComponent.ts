// ─── 清理组件 ───────────────────────────────
// 删除/离线后清理各模块的内存残留（劫掠状态、三叉戟追踪等），
// 防止同名重建假人继承旧状态。

import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import type { BotRecord } from "../../rules/Types";

export class CleanupComponent implements LifecycleComponent {
  readonly id = "cleanup";
  readonly priority = 90;

  async onAfterDelete(_ctx: LifecycleContext, botName: string): Promise<void> {
    try {
      const { cleanupRaidMode } = await import("../../features/flow/raidMode");
      cleanupRaidMode(botName);
    } catch {}
    // 三叉戟第二任悬空已在 delete 核心通过 botOffline 事件触发回退
  }

  async onAfterOffline(_ctx: LifecycleContext, record: BotRecord): Promise<void> {
    // 下线后清理：若未来有 per-bot 缓存需清，可在此追加
    void record;
  }
}
