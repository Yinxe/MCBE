// ─── 辅助域公共能力 ────────────────────────────────
// 供上线后刷新模拟4 / 下线单区块 / 采样 ASCII 共用：
//   - vault 判定（宝库模式跳过辅助）
//   - per-bot 辅助区块名（mockplayer:aux:<name>）
//   - per-bot 串行队列（防同名并发）
//   - 采样图生成（9×9 网格中圆形 49 块，以假人为中心）

import { world, type Dimension, type Vector3 } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import { system } from "@minecraft/server";

import type { BotRecord } from "../../rules/Types";
import { SIM4_TICKING_RADIUS_CHUNKS, TICKS_PER_SECOND, UNLIMITED_QUOTA } from "../../rules/Types";
import { TAG_VAULT_MODE } from "../../rules/tags/BotTags";
import { botRegistry, configStore } from "../../bootstrap/context";
import { canOnlineBot, remainingOnlineQuota } from "../../service/QuotaRules";
import { isAdmin } from "../../interaction/commands/auth";
import { removeSim4Area, syncCommandAreasFromWorld } from "./tickingArea/sim4";

export function isVaultMode(record: BotRecord): boolean {
  return record.tags.includes(TAG_VAULT_MODE.value);
}

export function checkOnlineQuota(record: BotRecord): string | undefined {
  const ownerName = record.ownerName;
  if (!ownerName) return undefined;
  const onlineCount = botRegistry.all().filter((r) => r.ownerName === ownerName && r.online).length;
  const quota = configStore.onlineQuotaFor(ownerName);
  let ownerIsAdmin = false;
  if (configStore.get().admins.includes(ownerName)) ownerIsAdmin = true;
  else {
    const ownerPlayer = world.getAllPlayers().find((p) => p.name === ownerName);
    if (ownerPlayer && isAdmin(ownerPlayer)) ownerIsAdmin = true;
  }
  if (!canOnlineBot(onlineCount, quota, ownerIsAdmin)) {
    const left = remainingOnlineQuota(onlineCount, quota, ownerIsAdmin);
    const limitText = quota >= UNLIMITED_QUOTA ? "无限" : `${quota}`;
    return `同时在线已达上限（${limitText}个）${left >= 0 ? `，剩余 ${left} 个` : ""}，请先下线部分假人`;
  }
  return undefined;
}

export function getAuxAreaName(name: string): string {
  return `mockplayer:aux:${name}`;
}

// ─── per-bot 串行队列 ──────────────────────────────
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

// ─── 冷却与延迟（上线/下线共用） ───────────────────
export function getCooldownTicks(): number {
  return configStore.getSafeCooldownSeconds() * TICKS_PER_SECOND;
}

export function delayTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(() => resolve(), ticks));
}

// ─── 在线配额强制执行 ─────────────────────────────
export async function enforceOnlineQuotaForOwner(ownerName: string): Promise<number> {
  const allOnline = botRegistry.all().filter((r) => r.ownerName === ownerName && r.online);
  if (allOnline.length === 0) return 0;
  const quota = configStore.onlineQuotaFor(ownerName);
  let isAdminOwner = false;
  if (configStore.get().admins.includes(ownerName)) isAdminOwner = true;
  else {
    const p = world.getAllPlayers().find((pl) => pl.name === ownerName);
    if (p && isAdmin(p)) isAdminOwner = true;
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
      else console.warn(`[MockPlayer] 强制下线 ${rec.name} 失败: ${res.reason}`);
    } catch (e: any) {
      console.warn(`[MockPlayer] 强制下线 ${rec.name} 异常: ${e?.message ?? e}`);
    }
  }
  if (count > 0) console.info(`[MockPlayer] 已对 ${ownerName} 强制下线 ${count} 个超出配额的假人（保留 ${quota} 个）`);
  return count;
}

export async function enforceAllOnlineQuotas(): Promise<number> {
  const owners = new Set(
    botRegistry
      .all()
      .filter((r) => r.online && r.ownerName)
      .map((r) => r.ownerName!)
  );
  let total = 0;
  for (const owner of owners) total += await enforceOnlineQuotaForOwner(owner);
  return total;
}

// ─── 辅助区块生命周期增强（合规优化） ────────────────

/** 同步内存 Set ← 世界 Manager（worldLoad 时修复重启后 Set 丢失） */
export function syncAuxFromWorld(): void {
  try {
    syncCommandAreasFromWorld();
  } catch {}
}

/**
 * 清理孤儿辅助区块（worldLoad 时调用）：
 * 遍历世界全部 tickingArea，移除 `mockplayer:aux:*` 中对应假人已离线/不存在的孤儿
 * @returns 清理数量
 */
export function cleanupOrphanAuxAreas(): number {
  let removed = 0;
  try {
    const all = (world.tickingAreaManager as any).getAllTickingAreas?.() as any[] | undefined;
    if (!all) return 0;
    for (const a of all) {
      const id = (a as any).identifier ?? (a as any).name;
      if (typeof id !== "string" || !id.startsWith("mockplayer:aux:")) continue;
      const botName = id.replace("mockplayer:aux:", "");
      const rec = botRegistry.get(botName);
      if (rec?.online) continue; // 在线假人的辅助保留
      try {
        world.tickingAreaManager.removeTickingArea(id);
        removed++;
        console.info(`[MockPlayer] 清理孤儿辅助区块 ${id}`);
      } catch {}
      try {
        removeSim4Area(id);
      } catch {}
    }
    if (removed > 0) console.info(`[MockPlayer] 孤儿辅助区块清理完成 ${removed} 个`);
  } catch (e: any) {
    console.warn(`[MockPlayer] 孤儿辅助清理异常: ${e?.message ?? e}`);
  }
  return removed;
}

/**
 * 带回退的辅助创建（上线优化）：
 * 先尝试 Sim4（圆形 49 块，体验最好），若容量不足失败则自动回退单区块（1 块列，保底）
 * @returns 创建结果 + 是否回退
 */
export async function createAuxWithFallback(
  center: Vector3,
  dimension: Dimension,
  areaName: string
): Promise<{ ok: boolean; reason?: string; fallback?: boolean }> {
  const { createSim4Area } = await import("./tickingArea/sim4");
  const sim4Res = await createSim4Area(center as any, dimension as any, areaName);
  if (sim4Res.ok) return sim4Res;
  // 仅容量不足时回退单区块，其余错误直接返回
  if (!String(sim4Res.reason ?? "").includes("容量不足")) return sim4Res;
  console.warn(`[MockPlayer] Sim4 容量不足 ${areaName}: ${sim4Res.reason}，回退单区块`);
  const { createSingleChunkArea } = await import("./tickingArea/singleChunk");
  const fallbackRes = await createSingleChunkArea(center as any, dimension as any, areaName);
  if (fallbackRes.ok) {
    console.info(`[MockPlayer] 回退单区块成功 ${areaName}（Sim4 降级）`);
    return { ok: true, fallback: true } as const;
  }
  return { ok: false, reason: `Sim4 失败: ${sim4Res.reason}；回退单区块也失败: ${fallbackRes.reason}` } as const;
}

// ─── 采样 ASCII（几何渲染版，零世界查询，49 块圆形） ──────────
// ⚠️ 审查修正：旧实现用 isChunkLoaded（内部 dimension.getBlock）逐块探测，
//    但 getBlock 会**强制加载区块**——探针自身污染测量对象（圆外角落被强拉载 +
//    结果恒为全■）。现按 `tickingarea add circle r=4` 的几何定义直接渲染
//    预期覆盖范围（命令成功 ⇒ 覆盖成立），不再触碰世界。
export function sampleAndSendAscii(bot: SimulatedPlayer, record: BotRecord): void {
  try {
    const dimId = (bot.dimension as Dimension).id;
    const center = bot.location as Vector3;
    const r = SIM4_TICKING_RADIUS_CHUNKS;
    const lines: string[] = [];
    lines.push(
      `${color.accent}┌─ 模拟4覆盖 ${r * 2 + 1}×${r * 2 + 1} 区块（${record.name} @ ${dimId} ${Math.floor(center.x)},${Math.floor(center.z)} r=${r}）─┐`
    );
    for (let dz = -r; dz <= r; dz++) {
      let row = "│ ";
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0) {
          row += "◎ "; // 假人所在区块（圆心）
        } else {
          // 圆形判定：与圆心的区块距离 ≤ r 视为覆盖
          row += dx * dx + dz * dz <= r * r ? "■ " : "· ";
        }
      }
      row += "│";
      lines.push(row);
    }
    lines.push(`${color.muted}└─ ◎=假人区块 ■=模拟4覆盖 ·=圆外未申请 ─┘`);
    const msg = lines.join("\n");
    console.info(`[MockPlayer] 模拟4采样 ${record.name}\n${msg.replace(/§./g, "")}`);
    const ownerName = record.ownerName;
    if (ownerName) {
      const owner = world.getAllPlayers().find((p) => p.name === ownerName);
      if (owner) owner.sendMessage(`${color.accent}【${record.name}】模拟4已刷新\n${msg}`);
    }
  } catch (e: any) {
    console.warn(`[MockPlayer] 采样 ASCII 失败 ${record.name}: ${e?.message ?? e}`);
  }
}
