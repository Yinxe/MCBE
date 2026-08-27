// DEPRECATED: 辅助域已完全内聚至 lifecycle（TickingAreaComponent + SharedTickingQueue + TickingAreaService）
// 此文件仅保留兼容 re-export，实际实现已迁移，避免“辅助”与“生命周期”两处各持一份队列/采样逻辑的重复

// 兼容：旧 isVaultMode 仍被外部引用，保留本地实现（与 TickingAreaComponent 逻辑一致）
import { TAG_VAULT_MODE as _TAG_VAULT_MODE } from "../../rules/tags/BotTags";
export function isVaultMode(record: import("../../rules/Types").BotRecord): boolean {
  return record.tags.includes(_TAG_VAULT_MODE.value);
}
// checkOnlineQuota 已由 lifecycle/QuotaComponent 接管，此处转发以兼容旧 import
export function checkOnlineQuota(record: import("../../rules/Types").BotRecord): string | undefined {
  // 动态转发，避免循环：auxiliary → bootstrap/context → lifecycle → auxiliary
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { botRegistry, configStore } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const { canOnlineBot, remainingOnlineQuota } = require("../../service/QuotaRules") as typeof import("../../service/QuotaRules");
    const { UNLIMITED_QUOTA } = require("../../rules/Types") as typeof import("../../rules/Types");
    const ownerName = record.ownerName;
    if (!ownerName) return undefined;
    const onlineCount = botRegistry.all().filter((r) => r.ownerName === ownerName && r.online).length;
    const quota = configStore.onlineQuotaFor(ownerName);
    let ownerIsAdmin = false;
    try {
      const { world } = require("@minecraft/server") as typeof import("@minecraft/server");
      const { isAdmin } = require("../../interaction/commands/auth") as typeof import("../../interaction/commands/auth");
      if (configStore.get().admins.includes(ownerName)) ownerIsAdmin = true;
      else {
        const p = world.getAllPlayers().find((pl) => pl.name === ownerName);
        if (p && isAdmin(p as any)) ownerIsAdmin = true;
      }
    } catch {}
    if (!canOnlineBot(onlineCount, quota, ownerIsAdmin)) {
      const left = remainingOnlineQuota(onlineCount, quota, ownerIsAdmin);
      const limitText = quota >= UNLIMITED_QUOTA ? "无限" : `${quota}`;
      return `同时在线已达上限（${limitText}个）${left >= 0 ? `，剩余 ${left} 个` : ""}，请先下线部分假人`;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function getAuxAreaName(name: string): string {
  return `mockplayer:aux:${name}`;
}

// per-bot 队列已由 BotLifecycle.withQueue 接管，此处保留空壳以兼容旧 import
const perBotQueues = new Map<string, Promise<void>>();
export function getPerBotQueue(name: string): Promise<void> {
  return perBotQueues.get(name) ?? Promise.resolve();
}
export function setPerBotQueue(name: string, p: Promise<void>): void {
  perBotQueues.set(name, p);
  p.finally(() => {
    if (perBotQueues.get(name) === p) perBotQueues.delete(name);
  });
}

export function getCooldownTicks(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configStore } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const { TICKS_PER_SECOND } = require("../../rules/Types") as typeof import("../../rules/Types");
    return configStore.getSafeCooldownSeconds() * TICKS_PER_SECOND;
  } catch {
    return 20;
  }
}
export function delayTicks(ticks: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { system } = require("@minecraft/server") as typeof import("@minecraft/server");
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}

// 在线配额强制执行已由 QuotaComponent + TickingAreaService 接管，保留转发
export async function enforceOnlineQuotaForOwner(ownerName: string): Promise<number> {
  try {
    const { botRegistry } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const { configStore } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const { UNLIMITED_QUOTA } = require("../../rules/Types") as typeof import("../../rules/Types");
    const { world } = require("@minecraft/server") as typeof import("@minecraft/server");
    const { isAdmin } = require("../../interaction/commands/auth") as typeof import("../../interaction/commands/auth");
    const allOnline = botRegistry.all().filter((r: import("../../rules/Types").BotRecord) => r.ownerName === ownerName && r.online);
    if (allOnline.length === 0) return 0;
    const quota = configStore.onlineQuotaFor(ownerName);
    let isAdminOwner = false;
    if (configStore.get().admins.includes(ownerName)) isAdminOwner = true;
    else {
      const p = world.getAllPlayers().find((pl) => pl.name === ownerName);
      if (p && isAdmin(p as any)) isAdminOwner = true;
    }
    if (isAdminOwner || quota >= UNLIMITED_QUOTA) return 0;
    if (allOnline.length <= quota) return 0;
    const sorted = [...allOnline].sort((a, b) => a.name.localeCompare(b.name));
    const toKeep = new Set(sorted.slice(0, quota).map((r) => r.name));
    const toOffline = sorted.filter((r) => !toKeep.has(r.name));
    let count = 0;
    for (const rec of toOffline) {
      try {
        const { safeOffline } = await import("./offlineBot");
        const res = await safeOffline(rec);
        if (res.ok) count++;
      } catch {}
    }
    return count;
  } catch {
    return 0;
  }
}
export async function enforceAllOnlineQuotas(): Promise<number> {
  try {
    const { botRegistry } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const owners = new Set(
      botRegistry
        .all()
        .filter((r) => r.online && r.ownerName)
        .map((r) => r.ownerName!)
    );
    let total = 0;
    for (const owner of owners) total += await enforceOnlineQuotaForOwner(owner);
    return total;
  } catch {
    return 0;
  }
}

export function syncAuxFromWorld(): void {
  try {
    const { syncTickingAreas } = require("./tickingArea/TickingAreaService") as typeof import("./tickingArea/TickingAreaService");
    syncTickingAreas();
  } catch {}
  try {
    const { syncCommandAreasFromWorld } = require("./tickingArea/sim4") as typeof import("./tickingArea/sim4");
    syncCommandAreasFromWorld();
  } catch {}
}

export function cleanupOrphanAuxAreas(): number {
  // 委托新统一服务 + 旧 per-bot 清理（双重保障，兼容重启后 Map 丢失）
  try {
    const { world } = require("@minecraft/server") as typeof import("@minecraft/server");
    const { botRegistry } = require("../../bootstrap/context") as typeof import("../../bootstrap/context");
    const { removeSim4Area } = require("./tickingArea/sim4") as typeof import("./tickingArea/sim4");
    let removed = 0;
    try {
      const all = (world.tickingAreaManager as any).getAllTickingAreas?.() as any[] | undefined;
      if (all) {
        for (const a of all) {
          const id = (a as any).identifier ?? (a as any).name;
          if (typeof id !== "string" || !id.startsWith("mockplayer:aux:")) continue;
          if (id === "mockplayer:aux:shared") continue; // 共享由 SharedQueue 自行管理，此处不误删
          const botName = id.replace("mockplayer:aux:", "");
          const rec = botRegistry.get(botName);
          if (rec?.online) continue;
          try {
            world.tickingAreaManager.removeTickingArea(id);
            removed++;
          } catch {}
          try {
            removeSim4Area(id);
          } catch {}
        }
      }
    } catch {}
    return removed;
  } catch {
    return 0;
  }
}

export async function createAuxWithFallback(
  center: import("@minecraft/server").Vector3,
  dimension: import("@minecraft/server").Dimension,
  areaName: string
): Promise<{ ok: boolean; reason?: string; fallback?: boolean }> {
  try {
    const { createCircleWithFallback } = await import("./tickingArea/TickingAreaService");
    const r = await createCircleWithFallback(center as any, dimension as any, areaName);
    if ((r as any).ok) return { ok: true, fallback: !!(r as any).fallback } as const;
    return { ok: false, reason: (r as any).reason } as const;
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) } as const;
  }
}

export function sampleAndSendAscii(bot: import("@minecraft/server-gametest").SimulatedPlayer, record: import("../../rules/Types").BotRecord): void {
  // 委托新 TickingArea 的几何渲染（零世界查询）
  try {
    const { world } = require("@minecraft/server") as typeof import("@minecraft/server");
    const { color } = require("@yinxe/toolkit") as typeof import("@yinxe/toolkit");
    const { SIM4_TICKING_RADIUS_CHUNKS } = require("../../rules/Types") as typeof import("../../rules/Types");
    const dimId = (bot.dimension as any).id;
    const center = (bot as any).location as import("@minecraft/server").Vector3;
    const r = SIM4_TICKING_RADIUS_CHUNKS;
    const lines: string[] = [];
    lines.push(
      `${color.accent}┌─ 模拟${r}覆盖 ${r * 2 + 1}×${r * 2 + 1} 区块（${record.name} @ ${dimId} ${Math.floor(center.x)},${Math.floor(center.z)} r=${r}）─┐`
    );
    for (let dz = -r; dz <= r; dz++) {
      let row = "│ ";
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0) row += "◎ ";
        else row += dx * dx + dz * dz <= r * r ? "■ " : "· ";
      }
      row += "│";
      lines.push(row);
    }
    lines.push(`${color.muted}└─ ◎=假人区块 ■=模拟${r}覆盖 ·=圆外未申请 ─┘`);
    const msg = lines.join("\n");
    console.info(`[MockPlayer] 模拟${r}采样 ${record.name}\n${msg.replace(/§./g, "")}`);
    const ownerName = record.ownerName;
    if (ownerName) {
      const owner = world.getAllPlayers().find((p) => p.name === ownerName);
      if (owner) owner.sendMessage(`${color.accent}【${record.name}】模拟${r}已刷新\n${msg}`);
    }
  } catch {}
}
