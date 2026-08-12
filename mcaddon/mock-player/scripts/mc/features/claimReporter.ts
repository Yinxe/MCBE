// ─── 认主变更集中汇报（mc 层） ────────────────────────
// 认主 / 回退 / 被覆盖等投掷物认主变更，按目标真实玩家聚合，
// 同一批变更（同一 tick 内所有 queue 调用）汇总为一条消息发送，
// 避免每把投掷物一条消息刷屏（此前变更只在 console 日志里）。
//
// 汇报语义（按消息接收者视角）：
//   claimed   认主 N 件   —— 名下假人获得/夺回投掷物认主
//   returned  回退 N 件   —— 名下假人下线降级回退第一任 / 玩家重新获得认主
//   covered   被覆盖 N 件 —— 玩家的投掷物被假人认走 / 名下假人被顶替
//
// 调用点：tridentTracker（load 认主 / rebind 夺回 / offline 回退）、
//        tridentClaim（UI 认主与覆盖）。投掷即标记（entitySpawn）不算认主变更，不汇报。

import { world, system } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

/** 汇报批次计数 */
interface ReportCounts {
  /** 认主成功（获得/夺回） */
  claimed: number;
  /** 回退第一任（降级 / 重新获得） */
  returned: number;
  /** 被覆盖（认主被替换/顶替） */
  covered: number;
}

export type ClaimReportKind = keyof ReportCounts;

/** 待发送批次（按玩家名聚合） */
const pending = new Map<string, ReportCounts>();
let flushScheduled = false;

/**
 * 排队一条认主汇报（按目标玩家聚合，本 tick 末集中发送一条汇总）。
 * @param playerName 目标真实玩家名（空名忽略）
 * @param kind 变更类型
 */
export function queueClaimReport(playerName: string, kind: ClaimReportKind): void {
  if (!playerName) return;
  const batch = pending.get(playerName) ?? { claimed: 0, returned: 0, covered: 0 };
  batch[kind]++;
  pending.set(playerName, batch);
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
  for (const [name, counts] of items) {
    const parts: string[] = [];
    if (counts.claimed > 0) parts.push(`${color.success}认主 ${color.info}${counts.claimed}${color.success} 件`);
    if (counts.returned > 0) parts.push(`${color.warn}回退 ${color.info}${counts.returned}${color.warn} 件`);
    if (counts.covered > 0) parts.push(`${color.warn}被覆盖 ${color.info}${counts.covered}${color.warn} 件`);
    if (parts.length === 0) continue;
    sendToPlayer(name, `${color.accent}${color.bold}[认主汇报]${color.reset} ${parts.join(" · ")}`);
  }
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