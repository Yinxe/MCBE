// ─── 信物手势判据（domain 纯逻辑） ──────────────────────────────────
// 引擎输入模型（触屏＝长按/点击两个动作，电脑端＝右键/左键）：
//   长按 / 使用物品        → afterEvents.itemUse          → "我在用手里这件物品"
//   点击方块 / 与方块交互  → playerInteractWithBlock      → "我在动这个方块"
//   点击实体 / 与实体交互  → playerInteractWithEntity     → "我在动这个实体"
// 长按与点击是两次不同手势，互斥触发，故三条入口不靠"同拍抑制"错开。
// 蹲下＝"只与方块交互"的修饰键（触屏上不蹲下时点击会先去用手里物品）。
//
// 信物相关的两条手势：
//   长按 / 使用信物            → 主菜单（不要求蹲下：长按本身就是主动手势）
//   蹲下 + 点击普通木头箱子    → 工作箱绑定面板
// 手持物一律取"本次交互实际使用的物品"，不是快捷栏某一格。

import { isPlainChestType } from "./WorkChest";

/** 手势事实：信物配置 + 本次交互实际手持的物品 */
export interface TokenGestureFacts {
  /** 管理员是否启用了信物 */
  tokenEnabled: boolean;
  /** 配置的信物物品 id */
  tokenTypeId: string;
  /** 本次交互实际手持的物品 id（空手＝空串） */
  heldTypeId: string;
}

/** 共同前提：启用信物 + 手里拿的正是信物 */
function holdsToken(facts: TokenGestureFacts): boolean {
  return facts.tokenEnabled && facts.heldTypeId !== "" && facts.heldTypeId === facts.tokenTypeId;
}

/**
 * 主菜单手势：长按 / 使用信物（不要求蹲下）。
 * @param facts - 手势事实
 */
export function isTokenMenuGesture(facts: TokenGestureFacts): boolean {
  return holdsToken(facts);
}

/**
 * 工作箱绑定手势：蹲下 + 手持信物 + 点击的是普通木头箱子。
 * @param facts - 手势事实外加潜行态与被点击方块 typeId
 * @returns 命中 true（调用方据此取消方块交互并开绑定面板）
 */
export function isChestBindGesture(facts: TokenGestureFacts & { sneaking: boolean; blockTypeId: string }): boolean {
  return facts.sneaking && holdsToken(facts) && isPlainChestType(facts.blockTypeId);
}
