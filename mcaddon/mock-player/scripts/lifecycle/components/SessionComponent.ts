// ─── 会话组件（生命周期内聚：上下线会话） ────────
// 职责：假人会话的**唯一**管理者，集中处理
//   world.playerJoin  → 恢复背包/经验/效果 + markRestored + trackBotOnline + BotEvents.botOnline
//   world.playerLeave → 尽力保存 + offline + BotEvents.botOffline + 联动下线真实玩家名下假人
//
// 原逻辑分散于 events/playerJoin.ts / events/playerLeave.ts，
// 现全部内聚于此组件，外部不再直接订阅这两个世界事件。
// 组件在 onRegister 时集中订阅，onUnregister 时集中取消，集中维护。
// 为避免循环依赖（component → tridentTracker → bootstrap/context → component），
// 涉及跨模块的 track/reconnect 检查采用动态 import 懒加载，待所有模块初始化完毕后才解析。

import { world, system, type Player, type PlayerJoinAfterEvent, type PlayerLeaveAfterEvent } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { BOT_TAG } from "../../rules/tags/BotTags";
import { BotEvents } from "../../events/DomainEvents";
import { getTotalXpForLevels } from "../../rules/xp/XpMath";
import type { LifecycleComponent } from "../LifecycleComponent";
import type { LifecycleContext } from "../LifecycleContext";

export class SessionComponent implements LifecycleComponent {
  readonly id = "session";
  readonly priority = 30;

  private ctx!: LifecycleContext;
  private joinHandler?: (e: PlayerJoinAfterEvent) => void;
  private leaveHandler?: (e: PlayerLeaveAfterEvent) => void;

  onRegister(ctx: LifecycleContext): void {
    this.ctx = ctx;

    this.joinHandler = (event: PlayerJoinAfterEvent) => {
      void this.handleJoin(event).catch(e => console.warn(`[Session] playerJoin 异常 ${event.playerName}: ${e?.message ?? e}`));
    };
    this.leaveHandler = (event: PlayerLeaveAfterEvent) => {
      void this.handleLeave(event).catch(e => console.warn(`[Session] playerLeave 异常 ${event.playerName}: ${e?.message ?? e}`));
    };

    try { world.afterEvents.playerJoin.subscribe(this.joinHandler); } catch (e: any) { console.warn(`[Session] 订阅 playerJoin 失败: ${e?.message ?? e}`); }
    try { world.afterEvents.playerLeave.subscribe(this.leaveHandler); } catch (e: any) { console.warn(`[Session] 订阅 playerLeave 失败: ${e?.message ?? e}`); }

    console.info(`[Session] 已集中订阅 playerJoin / playerLeave（生命周期内聚）`);
  }

  onUnregister(_ctx: LifecycleContext): void {
    if (this.joinHandler) try { world.afterEvents.playerJoin.unsubscribe(this.joinHandler); } catch {}
    if (this.leaveHandler) try { world.afterEvents.playerLeave.unsubscribe(this.leaveHandler); } catch {}
    this.joinHandler = undefined;
    this.leaveHandler = undefined;
  }

  // ── playerJoin：上线恢复 ──
  private async handleJoin(event: PlayerJoinAfterEvent): Promise<void> {
    const record = this.ctx.registry.get(event.playerName);
    if (!record) return;

    console.info(`[Session] playerJoin ${event.playerName}`);
    record.online = true;
    this.ctx.save.saveRecord(record);

    const players = world.getPlayers({ name: event.playerName, tags: [BOT_TAG] });
    const player = players[0] as Player | undefined;
    if (player) {
      try {
        this.ctx.inventory.restoreInto(player, record);
        const exp = record.experience;
        if (exp.totalXp > 0) {
          try {
            const current = getTotalXpForLevels(player.level) + player.xpEarnedAtCurrentLevel;
            if (exp.totalXp > current) player.addExperience(exp.totalXp - current);
          } catch {}
        }
      } catch (e: any) {
        console.warn(`[Session] 恢复 ${record.name} 失败: ${e?.message ?? e}`);
      }
    }

    if (player) {
      this.ctx.registry.markRestored(record.name);
      record.entityId = player.id;
      // 动态导入以打破循环： SessionComponent → tridentTracker → bootstrap/context → SessionComponent
      try {
        const { trackBotOnline } = await import("../../features/trident/tridentTracker");
        trackBotOnline(player.id, record.name);
      } catch {}
      BotEvents.botOnline.trigger({ botName: record.name });
    }
    try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.success}${record.name} 加入了游戏`); } catch {}
  }

  // ── playerLeave：离开兜底 + 联动 ──
  private async handleLeave(event: PlayerLeaveAfterEvent): Promise<void> {
    let record = this.ctx.registry.get(event.playerName);
    if (!record) {
      for (const r of this.ctx.registry.all()) {
        if (r.entityId === event.playerId) { console.info(`[Session] playerLeave 反查命中 ${r.name}`); record = r; break; }
      }
    }
    if (!record) {
      await this.offlineOwnerBots(event.playerName);
      return;
    }
    console.info(`[Session] playerLeave ${event.playerName}`);

    const isReconnecting = this.ctx.reconnecting.has(record.name);

    if (!record.online) {
      if (isReconnecting) this.ctx.reconnecting.delete(record.name);
      return;
    }
    if (record.entityId && event.playerId !== record.entityId) {
      console.info(`[Session] 跳过旧实体离开 ${event.playerName}`);
      return;
    }

    if (record.entityId) {
      try {
        const bot = world.getEntity(record.entityId) as Player | undefined;
        if ((bot as any)?.hasTag?.(BOT_TAG)) this.ctx.save.saveFullState(bot as Player, record);
      } catch {}
    }

    record.online = false;
    record.entityId = undefined;
    this.ctx.save.saveRecord(record);
    BotEvents.botOffline.trigger({ botName: record.name });
    this.ctx.registry.removeRestored(record.name);

    if (isReconnecting) {
      this.ctx.reconnecting.delete(record.name);
      return;
    }
    try { world.sendMessage(`${color.muted}[${color.success}假人${color.muted}] ${color.playerName}${record.name} 离开了游戏`); } catch {}
  }

  private async offlineOwnerBots(ownerName: string): Promise<void> {
    try {
      if (!this.ctx.configStore.get().ownerOfflineAutoOffline) return;
    } catch { return; }
    const owned = this.ctx.registry.all().filter(r => r.ownerName === ownerName && r.online);
    if (owned.length === 0) return;
    console.info(`[Session] 玩家 ${ownerName} 下线，联动下线 ${owned.length} 个假人`);
    system.run(async () => {
      let offlineFn: any;
      try {
        const mod = await import("../../bootstrap/context");
        offlineFn = (mod as any).botLifecycle?.offline?.bind((mod as any).botLifecycle);
      } catch {}
      if (!offlineFn) {
        try {
          const { safeOffline } = await import("../../features/manage/offlineBot");
          offlineFn = safeOffline;
        } catch {}
      }
      for (const r of owned) {
        try {
          const res = await offlineFn(r);
          if (!res.ok) console.warn(`[Session] 联动下线失败 ${r.name}: ${res.reason}`);
        } catch (e: any) { console.warn(`[Session] 联动下线异常 ${r.name}: ${e?.message ?? e}`); }
      }
    });
  }
}
