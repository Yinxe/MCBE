// ─── 认主变更集中汇报（mc 层） ────────────────────────
// 认主 / 回退 / 被覆盖等投掷物认主变更，按目标真实玩家聚合明细，
// 同一批变更（同一 tick 内所有 queue 调用）汇总为一条带 [模拟玩家] 前缀的消息，
// 避免每把投掷物一条消息刷屏（此前变更只在 console 日志里）。
//
// 汇报行（按认领/被降级假人逐行，接收者视角）：
//   · 假人A 认领 2 把三叉戟、1 支箭              —— 名下假人获得/夺回认主
//   · 假人B 回退 3 把三叉戟 → Steve              —— 名下假人下线降级回退第一任（→ 你 = 接收者重新获得）
//   · 你的 2 把三叉戟被 假人C 认领（第二任）      —— 玩家的投掷物被假人认走
//   · 假人D 的 1 把被 假人E 覆盖（第二任）        —— 名下假人被其他假人顶替
//
// 调用点：tridentTracker（load 认主 / rebind 夺回 / offline 回退）、
//        tridentClaim（UI 认主与覆盖）。投掷即标记（entitySpawn）不算认主变更，不汇报。

import { world, system } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

/** 类型 → 数量（typeId 细分三叉戟/箭） */
type TypeCounts = Record<string, number>;

/** 单个假人的聚合明细 */
interface BotClaimCounts {
  /** 认领成功（获得/夺回） */
  claimed: TypeCounts;
  /** 回退第一任（降级） */
  returned: TypeCounts;
  /** 回退目标第一任名 → 类型数量 */
  returnedTo: Record<string, TypeCounts>;
  /** 被覆盖：受害方（""=接收者自己的投掷物）→ 类型数量 */
  covered: Record<string, TypeCounts>;
}

export type ClaimReportKind = "claimed" | "returned" | "covered";

/** 单条认主变更汇报（入队后按玩家 + 假人聚合） */
export interface ClaimReport {
  /** 目标真实玩家名 */
  to: string;
  /** 认领 / 被降级假人名 */
  bot: string;
  kind: ClaimReportKind;
  /** 投掷物 typeId（细分"把三叉戟 / 支箭"） */
  typeId: string;
  /** returned：回退到的第一任名（等于 to 时显示"你"） */
  target?: string;
  /** covered：被顶替的假人名（玩家自己的投掷物被认走时不传） */
  victim?: string;
}

/** 待发送批次（玩家名 → 假人名 → 明细） */
const pending = new Map<string, Map<string, BotClaimCounts>>();
let flushScheduled = false;

/**
 * 排队一条认主汇报（按目标玩家 + 假人聚合，本 tick 末集中发送一条汇总）。
 * 空目标玩家忽略。
 */
export function queueClaimReport(report: ClaimReport): void {
  if (!report.to) return;
  let perBot = pending.get(report.to);
  if (!perBot) {
    perBot = new Map();
    pending.set(report.to, perBot);
  }
  let counts = perBot.get(report.bot);
  if (!counts) {
    counts = { claimed: {}, returned: {}, returnedTo: {}, covered: {} };
    perBot.set(report.bot, counts);
  }

  if (report.kind === "claimed") {
    counts.claimed[report.typeId] = (counts.claimed[report.typeId] ?? 0) + 1;
  } else if (report.kind === "returned") {
    counts.returned[report.typeId] = (counts.returned[report.typeId] ?? 0) + 1;
    const target = report.target ?? "";
    const byType = counts.returnedTo[target] ?? {};
    byType[report.typeId] = (byType[report.typeId] ?? 0) + 1;
    counts.returnedTo[target] = byType;
  } else {
    const victim = report.victim ?? "";
    const byType = counts.covered[victim] ?? {};
    byType[report.typeId] = (byType[report.typeId] ?? 0) + 1;
    counts.covered[victim] = byType;
  }

  if (!flushScheduled) {
    flushScheduled = true;
    system.run(() => {
      flushScheduled = false;
      flush();
    });
  }
}

/** 汇总发送全部待汇报批次 */
function flush(): void {
  const items = [...pending.entries()];
  pending.clear();
  for (const [name, perBot] of items) {
    const lines: string[] = [];
    for (const [bot, c] of perBot) {
      if (Object.keys(c.claimed).length > 0) {
        lines.push(`${color.muted}· ${color.playerName}${bot}${color.muted} 认领 ${formatTypeCounts(c.claimed, color.success)}`);
      }
      if (Object.keys(c.returned).length > 0) {
        const targets = Object.keys(c.returnedTo)
          .map((t) => (t === name ? `${color.playerName}你` : `${color.playerName}${t}`))
          .join("、");
        lines.push(`${color.muted}· ${color.playerName}${bot}${color.muted} 回退 ${formatTypeCounts(c.returned, color.warn)}${targets ? ` ${color.muted}→ ${targets}` : ""}`);
      }
      for (const [victim, byType] of Object.entries(c.covered)) {
        const who = victim ? `${color.playerName}${victim}${color.muted} 的` : `${color.muted}你的`;
        lines.push(`${color.muted}· ${who} ${formatTypeCounts(byType, color.error)} ${color.muted}被 ${color.playerName}${bot}${color.muted} 认领（第二任）`);
      }
    }
    if (lines.length === 0) continue;
    sendToPlayer(name, `${color.muted}[${color.accent}模拟玩家${color.muted}] ${color.accent}认主汇报${color.reset}\n${lines.join("\n")}`);
  }
}

/** 类型数量 → "2 把三叉戟、1 支箭"（颜色已由调用方指定） */
function formatTypeCounts(byType: TypeCounts, textColor: string): string {
  return Object.entries(byType)
    .map(([typeId, n]) => `${textColor}${n} ${color.muted}${typeUnit(typeId)}`)
    .join("、");
}

/** 投掷物 typeId → 量词 + 中文名 */
function typeUnit(typeId: string): string {
  if (typeId === "minecraft:thrown_trident") return "把三叉戟";
  if (typeId === "minecraft:arrow") return "支箭";
  return "件投掷物";
}

/** 向在线玩家发送消息（找不到或不可达静默跳过） */
function sendToPlayer(name: string, msg: string): void {
  try {
    const player = world.getPlayers({ name })[0];
    player?.sendMessage(msg);
  } catch {
    // 玩家不可达时忽略（离线消息无需缓存）
  }
}