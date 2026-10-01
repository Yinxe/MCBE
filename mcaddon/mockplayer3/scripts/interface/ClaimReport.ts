// ─── 投掷物认主变更集中汇报 ────────────────────────────────────────
// 认主事件按（接收玩家, 假人）聚合，system.run 同 tick 汇总一条消息防刷屏；行格式为既定文案。
// 派发纪律：via=spawn 不汇报；firstOwner===主人时只发主人一路防重复计数；
// UI 路操作者已有直接反馈不再发（经 setClaimOperator seam 注入）。

import { system } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import type { ClaimInfo } from "../engine/Hooks";
import { services } from "../Composition";
import { entityGateway } from "../engine/EntityGateway";

/** 类型 → 数量（typeId 细分三叉戟/箭） */
type TypeCounts = Record<string, number>;

/** 单个假人的聚合明细 */
interface BotClaimCounts {
  claimed: TypeCounts;
  returned: TypeCounts;
  returnedTo: Record<string, TypeCounts>;
  covered: Record<string, TypeCounts>;
}

type ClaimReportKind = "claimed" | "returned" | "covered";

interface ClaimReport {
  to: string;
  bot: string;
  kind: ClaimReportKind;
  typeId: string;
  target?: string;
  victim?: string;
}

// ─── 待发送批次（玩家名 → 假人名 → 明细） ──

const pending = new Map<string, Map<string, BotClaimCounts>>();
let flushScheduled = false;

/** UI 认主时的操作者（汇总中排除，其已有面板直接反馈） */
let uiOperator = "";

/**
 * 设置 UI 认主操作者。
 * @param name 操作者玩家名；claim 事件同步发出，返回后应清除
 */
export function setClaimOperator(name: string): void {
  uiOperator = name;
}

function queueClaimReport(report: ClaimReport): void {
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

// ─── 派发矩阵（按事件来源经路 → 接收者/种类） ──

/** 名字是否假人（名字索引命中即假人） */
function isBotName(name: string): boolean {
  return entityGateway.botIdOfName(name) !== undefined;
}

/** 假人名 → 主人名；无档/无主返回 "" */
function ownerNameOf(botName: string): string {
  const botId = entityGateway.botIdOfName(botName);
  if (botId === undefined) return "";
  return services.runtime.record(botId)?.ownerKey ?? "";
}

function dispatchClaimReport(info: ClaimInfo): void {
  // 投掷即标记不算认主变更，不汇报
  if (info.via === "spawn") return;
  const botName = info.claimedBy;
  const claimedByBot = isBotName(botName);
  const ownerName = claimedByBot ? ownerNameOf(botName) : "";
  const firstOwner = info.firstOwner ?? "";
  const previousSecond = info.previousSecond ?? "";

  if (info.via === "load") {
    // 目标假人 → 其主人收"认领"；目标玩家且原第二任存在 → 收"回退给你"
    if (claimedByBot) {
      queueClaimReport({ to: ownerName, bot: botName, kind: "claimed", typeId: info.typeId });
    } else if (previousSecond) {
      queueClaimReport({ to: botName, bot: previousSecond, kind: "returned", typeId: info.typeId, target: botName });
    }
    return;
  }

  if (info.via === "rebind") {
    // 主人收"认领"；第一任是玩家且非本假人主人 → 收"被认走"
    // firstOwner===ownerName（主人自己投的）只发主人一路，防重复计数
    queueClaimReport({ to: ownerName, bot: botName, kind: "claimed", typeId: info.typeId });
    if (firstOwner && !isBotName(firstOwner) && firstOwner !== ownerName) {
      queueClaimReport({ to: firstOwner, bot: botName, kind: "covered", typeId: info.typeId });
    }
    return;
  }

  if (info.via === "offline-fallback") {
    // 回退主体是下线假人（事件的 previousSecond），第一任=claimedBy：
    // 其主人收"降级回退"；第一任是玩家且非主人 → 收"重新获得（→ 你）"
    // firstOwner===ownerName 只发主人一路（回退通知翻倍防护）
    const offBot = previousSecond;
    if (!offBot) return;
    const offOwner = ownerNameOf(offBot);
    queueClaimReport({ to: offOwner, bot: offBot, kind: "returned", typeId: info.typeId, target: firstOwner });
    if (firstOwner && !isBotName(firstOwner) && firstOwner !== offOwner) {
      queueClaimReport({ to: firstOwner, bot: offBot, kind: "returned", typeId: info.typeId, target: firstOwner });
    }
    return;
  }

  // via === "ui"（操作者排除防重复）：
  // - 认主假人的主人：认领明细
  // - 旧第二任假人的主人：名下假人被顶替（victim）
  // - 第一任是玩家且非操作者非假人主人：玩家视角"被认领"
  if (!claimedByBot) return;
  if (ownerName && ownerName !== uiOperator) {
    queueClaimReport({ to: ownerName, bot: botName, kind: "claimed", typeId: info.typeId });
  }
  if (previousSecond && isBotName(previousSecond)) {
    const prevOwner = ownerNameOf(previousSecond);
    if (prevOwner && prevOwner !== uiOperator) {
      queueClaimReport({ to: prevOwner, bot: botName, kind: "covered", typeId: info.typeId, victim: previousSecond });
    }
  }
  if (firstOwner && !isBotName(firstOwner) && firstOwner !== uiOperator && firstOwner !== ownerName) {
    queueClaimReport({ to: firstOwner, bot: botName, kind: "covered", typeId: info.typeId });
  }
}

// ─── 汇总发送 ──

function flush(): void {
  const items = [...pending.entries()];
  pending.clear();
  for (const [name, perBot] of items) {
    const lines: string[] = [];
    for (const [bot, c] of perBot) {
      if (Object.keys(c.claimed).length > 0) {
        lines.push(
          `${color.muted}· ${color.playerName}${bot}${color.muted} 认领 ${formatTypeCounts(c.claimed, color.success)}`
        );
      }
      if (Object.keys(c.returned).length > 0) {
        const targets = Object.keys(c.returnedTo)
          .map((t) => (t === name ? `${color.playerName}你` : `${color.playerName}${t}`))
          .join("、");
        lines.push(
          `${color.muted}· ${color.playerName}${bot}${color.muted} 回退 ${formatTypeCounts(c.returned, color.warn)}${targets ? ` ${color.muted}→ ${targets}` : ""}`
        );
      }
      for (const [victim, byType] of Object.entries(c.covered)) {
        const who = victim ? `${color.playerName}${victim}${color.muted} 的` : `${color.muted}你的`;
        lines.push(
          `${color.muted}· ${who} ${formatTypeCounts(byType, color.error)} ${color.muted}被 ${color.playerName}${bot}${color.muted} 认领（第二任）`
        );
      }
    }
    if (lines.length === 0) continue;
    sendToPlayer(
      name,
      `${color.muted}[${color.accent}模拟玩家${color.muted}] ${color.accent}认主汇报${color.reset}\n${lines.join("\n")}`
    );
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

/** 向在线玩家发送消息；找不到或不可达静默跳过，离线消息不缓存 */
function sendToPlayer(name: string, msg: string): void {
  try {
    entityGateway.findRealPlayer(name)?.sendMessage(msg);
  } catch {
    /* 玩家不可达时忽略 */
  }
}

/**
 * 安装认主汇报订阅（装配末尾调用一次）。
 * @returns 退订函数
 */
export function installClaimReport(): () => void {
  return services.events.on("botProjectileClaimed", dispatchClaimReport);
}
