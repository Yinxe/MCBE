// ─── 辅助域公共能力 ────────────────────────────────
// 供上线后刷新模拟4 / 下线单区块 / 采样 ASCII 共用：
//   - vault 判定（宝库模式跳过辅助）
//   - per-bot 辅助区块名（mockplayer:aux:<name>）
//   - per-bot 串行队列（防同名并发）
//   - 采样图生成（9×9 区块，以假人为中心）

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

// ─── 采样 ASCII（几何渲染版，零世界查询） ──────────
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
