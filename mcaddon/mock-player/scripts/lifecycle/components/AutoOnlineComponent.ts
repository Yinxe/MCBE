// ─── 自动上线组件（生命周期内聚） ───────────
// 职责：世界重启后自动恢复之前在线的假人（等待 GameTest 就绪后排队）。
// 原逻辑在 features/manage/autoOnline.ts，由 worldLoad.ts system.run 触发，
// 现收敛于此组件的 onWorldLoad 钩子，由 BotLifecycle.worldLoad 统一调度。

import { system } from "@minecraft/server";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import type { BotRecord } from "../../rules/Types";

export class AutoOnlineComponent implements LifecycleComponent {
  readonly id = "autoOnline";
  readonly priority = 85; // 在 TickingArea(80) 之后、Cleanup(90) 之前，确保辅助清理先完成

  private ctx!: LifecycleContext;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;
  }

  async onWorldLoad(_ctx: LifecycleContext, _records: BotRecord[]): Promise<void> {
    const toAutoOnline = this.ctx.registry.all().filter(r => r.online && !r.death && !r.entityId);
    if (toAutoOnline.length === 0) return;

    console.info(`[AutoOnline] 世界重启自动上线 ${toAutoOnline.length} 个假人（等待 GameTest 就绪后排队）`);
    // 等待 GameTest 装置就绪（40t 注册 + 4 区块 ticking 加载）
    await new Promise<void>(res => system.runTimeout(res, 60));

    for (const r of toAutoOnline) {
      try {
        // 通过编排器在线，享受队列、配额守卫、辅助等全部组件能力
        const { botLifecycle } = await import("../../bootstrap/context");
        const res = await botLifecycle.online(r);
        if (!res.ok) {
          console.warn(`[AutoOnline] 失败 ${r.name}: ${res.reason}，已置为离线`);
          try { r.online = false; (r as any).entityId = undefined; this.ctx.save.saveRecord(r); } catch {}
        } else {
          console.info(`[AutoOnline] 成功 ${r.name}`);
        }
      } catch (e: any) {
        console.warn(`[AutoOnline] 异常 ${r.name}: ${e?.message ?? e}`);
        try { r.online = false; (r as any).entityId = undefined; this.ctx.save.saveRecord(r); } catch {}
      }
      await new Promise<void>(resolve => system.runTimeout(resolve, 2));
    }
  }
}
