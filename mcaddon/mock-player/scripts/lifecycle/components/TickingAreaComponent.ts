// ─── 辅助常加载组件（共享瞬时 + 下线保活） ─────
// 重构后约束（用户拍板）：
//   上线：单一共享常加载 mockplayer:aux:shared，全假人排队复用，用完即释，永不独占
//         上线不被阻塞：onAfterOnline 仅异步入队后立即返回
//         批量上线可并发，请求在 SharedTickingQueue 中 FIFO 串行：申请(49块) → 2t采样 → 卸载 → auxCompleted事件
//   下线：单区块常加载保活2秒（tickManager，支持30并发，不限流）
//         下线前申请单区块 → 下线成功后2秒卸载 → 4秒强制卸载
//         宝库模式不参与任何常加载申请

import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";
import type { BotRecord } from "../../rules/Types";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { BOT_TAG, TAG_VAULT_MODE } from "../../rules/tags/BotTags";
import { LifecycleEvents } from "../LifecycleEvents";

import { enqueueAuxRequest, getQueueLength } from "./SharedTickingQueue";

export class TickingAreaComponent implements LifecycleComponent {
  readonly id = "tickingArea";
  readonly priority = 80;

  private ctx!: LifecycleContext;
  private offAuxCompleted?: () => void;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;
    this.offAuxCompleted = LifecycleEvents.auxCompleted.subscribe((e) => {
      try { this.notifyOwner(e); } catch (err: any) { console.warn(`[TickingArea] 通知失败 ${e.botName}: ${err?.message ?? err}`); }
    });
    console.info(`[TickingArea] 已注册共享队列(上线) + 单区块保活(下线) + auxCompleted通知`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    if (this.offAuxCompleted) try { this.offAuxCompleted(); } catch {}
    this.offAuxCompleted = undefined;
  }

  private isVaultMode(record: BotRecord): boolean {
    return record.tags.includes(TAG_VAULT_MODE.value);
  }

  // ── 上线后：仅入队共享队列，不阻塞上线（半径0则关闭） ──
  async onAfterOnline(_ctx: LifecycleContext, record: BotRecord, bot: SimulatedPlayer): Promise<void> {
    if (this.isVaultMode(record)) {
      console.info(`[TickingArea] 宝库 ${record.name} 跳过上线辅助`);
      return;
    }
    try {
      const radius = (()=>{ try { return this.ctx.configStore.getAuxTickingRadius(); } catch { return 4; } })();
      if (radius === 0) {
        console.info(`[TickingArea] 辅助已关闭(半径0)，跳过 ${record.name}`);
        return;
      }
      const loc = (bot as any).location;
      const dim = (bot as any).dimension;
      if (!loc || !dim) {
        console.warn(`[TickingArea] ${record.name} 无位置/维度，跳过入队`);
        return;
      }
      enqueueAuxRequest(record.name, record.ownerName, loc, dim);
      console.info(`[TickingArea] ${record.name} 已入队共享辅助 r=${radius} 队列（排队 ${this.getQueueLenForLog()}）`);
    } catch (e: any) {
      console.warn(`[TickingArea] 入队异常 ${record.name}: ${e?.message ?? e}`);
    }
  }

  private getQueueLenForLog(): number {
    try { return getQueueLength(); } catch { return -1; }
  }

  // ── 下线前：申请单区块保活（tickManager，配套创建/销毁） ──
  async onBeforeOffline(_ctx: LifecycleContext, record: BotRecord): Promise<void> {
    if (this.isVaultMode(record)) {
      console.info(`[TickingArea] 宝库 ${record.name} 跳过下线保活`);
      return;
    }
    try {
      const { world } = await import("@minecraft/server");
      const { getAuxAreaName } = await import("../../features/manage/auxiliary");
      const { createSingleChunk } = await import("../../features/manage/tickingArea/TickingAreaService");

      let center: any = undefined;
      let targetDim: any = undefined;
      if (record.entityId) {
        try {
          const e = world.getEntity(record.entityId) as any;
          if (e && e.hasTag?.(BOT_TAG)) {
            center = e.location;
            targetDim = e.dimension;
          }
        } catch {}
        if (!center || !targetDim) {
          try {
            const e2 = world.getEntity(record.entityId) as any;
            if (e2) { center = e2.location; targetDim = e2.dimension; }
          } catch {}
        }
      }
      if (!center || !targetDim) {
        const state = record.lastPoint ?? record.respawnPoint;
        if (!state) {
          console.warn(`[TickingArea] ${record.name} 下线前无可用位置，跳过保活`);
          return;
        }
        center = state.location;
        try { targetDim = world.getDimension(state.dimension); } catch { return; }
      }

      const areaName = getAuxAreaName(record.name);
      console.info(`[TickingArea] 下线前申请单区块保活 ${areaName} @ ${targetDim.id} ${Math.floor(center.x)},${Math.floor(center.z)} for ${record.name}`);
      const cr = await createSingleChunk(center as any, targetDim as any, areaName);
      if (!(cr as any).ok) console.warn(`[TickingArea] 下线前保活失败 ${record.name}: ${(cr as any).reason}（仍继续下线）`);
      else console.info(`[TickingArea] 下线前保活成功 ${areaName} for ${record.name} via ${(cr as any).kind}`);
    } catch (e: any) {
      console.warn(`[TickingArea] 下线前保活异常 ${record.name}: ${e?.message ?? e}`);
    }
  }

  // ── 下线后：2秒卸载，4秒强制卸载（配套销毁，tickManager） ──
  async onAfterOffline(_ctx: LifecycleContext, record: BotRecord): Promise<void> {
    if (this.isVaultMode(record)) return;
    try {
      const { getAuxAreaName } = await import("../../features/manage/auxiliary");
      const areaName = getAuxAreaName(record.name);
      const { system } = await import("@minecraft/server");

      console.info(`[TickingArea] 已调度下线保活卸载 ${areaName} for ${record.name}（2s配套卸载/4s强卸）`);

      // 2秒后配套卸载（Manager对Manager）
      system.runTimeout(async () => {
        try {
          const { removeTickingArea } = await import("../../features/manage/tickingArea/TickingAreaService");
          const rr = await removeTickingArea(areaName);
          if (!(rr as any).ok) console.warn(`[TickingArea] 2s卸载失败 ${record.name}: ${(rr as any).reason}`);
          else console.info(`[TickingArea] 2s已配套卸载单区块保活 ${areaName} for ${record.name}`);
        } catch (e: any) {
          console.warn(`[TickingArea] 2s卸载异常 ${record.name}: ${e?.message ?? e}`);
        }
      }, 40);

      // 4秒后强制兜底（未知来源双试）
      system.runTimeout(async () => {
        try {
          const { removeTickingArea } = await import("../../features/manage/tickingArea/TickingAreaService");
          const r = await removeTickingArea(areaName);
          if ((r as any).ok) console.info(`[TickingArea] 4s强制配套卸载完成 ${areaName} for ${record.name}`);
        } catch (e: any) {
          console.warn(`[TickingArea] 4s强卸异常 ${record.name}: ${e?.message ?? e}`);
        }
      }, 80);
    } catch (e: any) {
      console.warn(`[TickingArea] 下线后调度异常 ${record.name}: ${e?.message ?? e}`);
    }
  }

  // 世界加载后：清理孤儿（旧 per-bot 独占 + 共享残留）
  async onWorldLoad(_ctx: LifecycleContext, _records: BotRecord[]): Promise<void> {
    try {
      const { system } = await import("@minecraft/server");
      system.run(async () => {
        try {
          const { cleanupOrphanAuxAreas } = await import("../../features/manage/auxiliary");
          const { syncCommandAreasFromWorld } = await import("../../features/manage/tickingArea/sim4");
          try { syncCommandAreasFromWorld?.(); } catch {}
          let removed = 0;
          try { removed = cleanupOrphanAuxAreas(); } catch {}
          try {
            const { world } = await import("@minecraft/server");
            const SHARED = "mockplayer:aux:shared";
            try {
              if ((world as any).tickingAreaManager?.hasTickingArea?.(SHARED)) {
                (world as any).tickingAreaManager.removeTickingArea(SHARED);
                console.info(`[TickingArea] 清理共享残留 ${SHARED}`);
                removed++;
              }
            } catch {}
            try {
              const { removeSim4Area } = await import("../../features/manage/tickingArea/sim4");
              removeSim4Area(SHARED);
            } catch {}
          } catch {}
          if (removed > 0) console.info(`[TickingArea] 孤儿辅助清理 ${removed} 个（含旧独占）`);
        } catch (e: any) {
          console.warn(`[TickingArea] 孤儿清理异常: ${e?.message ?? e}`);
        }
      });
    } catch (e: any) {
      console.warn(`[TickingArea] onWorldLoad 异常: ${e?.message ?? e}`);
    }
  }

  // ── 辅助完成通知（订阅 auxCompleted） ──
  private async notifyOwner(e: { botName: string; ownerName?: string; dimension: string; location: { x: number; y: number; z: number }; success: boolean; reason?: string; fallback?: boolean }): Promise<void> {
    const ownerName = e.ownerName;
    if (!ownerName) return;
    try {
      const { world } = await import("@minecraft/server");
      const owner = world.getAllPlayers().find((p: any) => p.name === ownerName);
      if (!owner) return;
      if (e.success) {
        try {
          const { sampleAndSendAscii } = await import("../../features/manage/auxiliary");
          const fakeBot = { location: e.location, dimension: { id: e.dimension } } as any;
          const fakeRecord = { name: e.botName, ownerName } as any;
          sampleAndSendAscii(fakeBot as any, fakeRecord as any);
        } catch {
          const { color } = await import("@yinxe/toolkit");
          const fallbackNote = e.fallback ? "（回退单区块）" : "（Sim4 49块）";
          owner.sendMessage(`${color.accent}【${e.botName}】常加载辅助完成 ${fallbackNote} @ ${e.dimension} ${Math.floor(e.location.x)},${Math.floor(e.location.z)} [共享排队，用完即释]`);
        }
      } else {
        const { color } = await import("@yinxe/toolkit");
        owner.sendMessage(`${color.warn}【${e.botName}】常加载辅助失败: ${e.reason ?? "未知"} @ ${e.dimension} ${Math.floor(e.location.x)},${Math.floor(e.location.z)}（不影响在线）`);
      }
    } catch (e2: any) {
      console.warn(`[TickingArea] notifyOwner 异常 ${e.botName}: ${e2?.message ?? e2}`);
    }
    console.info(`[TickingArea] auxCompleted ${e.botName} success=${e.success} ${e.reason ?? ""} @ ${e.dimension} ${Math.floor(e.location.x)},${Math.floor(e.location.z)}`);
  }
}
