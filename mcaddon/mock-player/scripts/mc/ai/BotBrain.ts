// ─── 假人大脑（mc/ai） ───────────────────────────────────
// 每假人一棵行为树（惰性创建，黑板独立）。
// 引擎驱动：vaultWorkflow 的 10 tick 引擎调用 tickBotBrain。
//   - 假人不可用（离线/死亡/重连中）→ 不推进（黑板保留 → 重连后继续同一目标）
//   - 防重入：导航协程进行中跳过本次 tick
//   - 对账清理：标签被移除（UI/命令任意入口）→ 停止导航 + 清黑板，
//     重新开启宝库模式时重新扫描（"移除 tag 更新行为"）

import { system, world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { Blackboard, BehaviorTree, type AiContext } from "../../core/ai";
import { createVaultTaskTree, type VaultPorts } from "../../core/ai/VaultTask";
import { BOT_TAG } from "../../core/tags/BotTags";
import { botRegistry } from "../bootstrap/context";
import { reconnectingBots } from "../features/pendingRespawn";
import { vaultPorts } from "./McVaultPorts";

interface BrainEntry {
  tree: BehaviorTree;
  blackboard: Blackboard;
  running: boolean;
}

const brains = new Map<string, BrainEntry>();

/** 推进一个假人的行为树（引擎周期调用；不可用时静默跳过） */
export function tickBotBrain(botName: string): void {
  if (!vaultPorts.isBotAvailable(botName)) return;
  let entry = brains.get(botName);
  if (!entry) {
    entry = { tree: createVaultTaskTree(vaultPorts), blackboard: new Blackboard(), running: false };
    brains.set(botName, entry);
  }
  if (entry.running) return; // 防重入：上次 tick 的协程未完成

  entry.running = true;
  const ctx: AiContext = { botName, blackboard: entry.blackboard, tick: system.currentTick };
  entry.tree
    .tick(ctx)
    .catch((e: any) => {
      console.warn(`[MockPlayer] 行为树 tick 异常 ${botName}: ${e?.message ?? e}`);
    })
    .finally(() => {
      entry!.running = false;
    });
}

/**
 * 对账清理：活跃（仍带宝库标签）假人之外的树全部重置——
 * 停止已下发导航 + 清黑板。标签移除（UI 行为菜单 / /mp:tag 任意入口）
 * 后行为立即停止；重新开启时重新扫描（黑板不残留旧目标）。
 * ⚠️ **重连中的假人跳过**（宝库模式反复上下线）：safeReconnect 期间
 *    实体离线不在活跃列表，但树与黑板必须保留——重连完成后继续同一宝库。
 */
export function reconcileBotBrains(activeBotNames: Iterable<string>): void {
  const active = new Set(activeBotNames);
  for (const botName of [...brains.keys()]) {
    if (!active.has(botName) && !reconnectingBots.has(botName)) {
      resetBotBrain(botName);
    }
  }
}

/** 重置假人的大脑：停止导航 + 丢弃树与黑板 */
export function resetBotBrain(botName: string): void {
  stopBotNavigation(botName);
  brains.delete(botName);
}

/** 停止假人当前导航移动（守卫：记录/实体/标签） */
function stopBotNavigation(botName: string): void {
  try {
    const record = botRegistry.get(botName);
    const entity = record?.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity && entity.hasTag(BOT_TAG)) {
      (entity as SimulatedPlayer).stopMoving();
    }
  } catch {
    /* 忽略 */
  }
}
