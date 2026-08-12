// ─── 跨包 HUD 仲裁（纯逻辑，零 @minecraft 依赖，可 node 单测） ──
// 各行为包通过 HudManager 把"某槽位声明"广播上总线；本模块只负责从
// 候选声明里挑赢家：非 0 优先级、未过期（心跳）里最高者；同优先级取
// modId 字典序小者（确定性决胜）。时间单位 tick 由调用方注入 world tick。

/** 一个模组对某个槽位的实时声明（来自总线另一头的广播 / 本包自身）。 */
export interface BusClaim {
  /** 声明方 modId（跨包唯一，同优先级决胜用） */
  modId: string;
  /** 该槽位优先级：>0 = 声明抢占；<=0 = 放弃该槽 */
  priority: number;
  /** 收到声明时的世界 tick（心跳基准，用于过期判定） */
  lastSeenTick: number;
}

/**
 * 声明是否过期（心跳超时）：距上次声明超过 expiryTicks tick 视为失效。
 *
 * @param claim   待判声明
 * @param nowTick 当前世界 tick
 * @param expiryTicks 过期阈值（tick）
 * @returns true = 已过期（不再参与仲裁）
 */
export function isStale(claim: BusClaim, nowTick: number, expiryTicks: number): boolean {
  return nowTick - claim.lastSeenTick > expiryTicks;
}

/**
 * 同槽位赢家：在"优先级 >0 且未过期"的声明里选 priority 最高者；
 * 同优先级取 modId 字典序小者（确定性，避免跨包互相压倒）。
 *
 * @param claims      候选声明（本包 + 他包）
 * @param nowTick     当前世界 tick
 * @param expiryTicks 过期阈值（tick）
 * @returns 赢家声明；无有效候选返回 undefined
 */
export function pickWinner(claims: readonly BusClaim[], nowTick: number, expiryTicks: number): BusClaim | undefined {
  let best: BusClaim | undefined;
  for (const claim of claims) {
    if (claim.priority <= 0) continue;
    if (isStale(claim, nowTick, expiryTicks)) continue;
    if (
      best === undefined ||
      claim.priority > best.priority ||
      (claim.priority === best.priority && claim.modId < best.modId)
    ) {
      best = claim;
    }
  }
  return best;
}