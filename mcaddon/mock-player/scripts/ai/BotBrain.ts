// ─── 假人大脑（mc/ai） ───────────────────────────────────
// AI 引擎：每假人每任务一棵行为树（惰性创建，黑板独立）。
// 驱动：startBrainEngine() 的 10 tick interval（main.ts worldLoad 后调用）。
//   - 假人不可用（离线/死亡/重连中）→ 不推进（黑板保留 → 重连后继续同一目标）
//   - 防重入：协程 tick 未完成跳过本次
//   - 对账清理：标签被移除（UI/命令任意入口）→ 停止导航 + 清黑板，
//     重新开启时重新开始（"移除 tag 更新行为"）；**宝库任务跳过重连中的假人**
// 任务：vault（宝库：互斥标签）/ raid（劫掠：独立开关，可与宝库共存）——
//   各自树实例与黑板，互不干扰。

import { system, world, type Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { Blackboard, BehaviorTree, type AiContext } from ".";
import { createVaultTaskTree, type VaultPorts } from "./VaultTask";
import { createRaidTaskTree, type RaidPorts } from "./RaidTask";
import { createFishingTaskTree, type FishingPorts } from "./FishingTask";
import { BOT_TAG, TAG_FISH_MODE, TAG_RAID_MODE, TAG_VAULT_MODE } from "../rules/BotTags";
import { BotUiEvent } from "../events/UiEvents";
import { botRegistry } from "../bootstrap/context";
import { resolveBot } from "../bot/BotCore";
import { reconnectingBots } from "../features/manage/pendingRespawn";
import { vaultPorts } from "../features/task/VaultPorts";
import { raidPorts } from "../features/task/RaidPorts";
import { fishingPorts } from "../features/task/FishingPorts";

// ─── 常量 ────────────────────────────────────────────────

/** AI 引擎周期（tick）：驱动全部任务树 */
const BRAIN_ENGINE_TICKS = 10;

// ─── 树实例管理 ──────────────────────────────────────────

interface BrainEntry {
  tree: BehaviorTree;
  blackboard: Blackboard;
  running: boolean;
}

/** botName → taskId → 树实例（黑板按树隔离） */
const brains = new Map<string, Map<string, BrainEntry>>();

let brainEngineStarted = false;

/** 假人可用（在线/非死亡）——任务树推进的共同守卫（Bot 对象判定） */
function isBotAvailable(botName: string): boolean {
  const bot = resolveBot(botName, botRegistry);
  return !!bot && bot.isAvailable;
}

/** 推进一个任务树（惰性创建；不可用跳过；防重入） */
function tickTask(botName: string, taskId: string, factory: () => BehaviorTree): void {
  if (!isBotAvailable(botName)) return;
  let tasks = brains.get(botName);
  if (!tasks) {
    tasks = new Map();
    brains.set(botName, tasks);
  }
  let entry = tasks.get(taskId);
  if (!entry) {
    entry = { tree: factory(), blackboard: new Blackboard(), running: false };
    tasks.set(taskId, entry);
  }
  if (entry.running) return; // 防重入：上次 tick 的协程未完成

  entry.running = true;
  const ctx: AiContext = { botName, blackboard: entry.blackboard, tick: system.currentTick };
  entry.tree
    .tick(ctx)
    .catch((e: any) => {
      console.warn(`[MockPlayer] 行为树 tick 异常 ${botName}/${taskId}: ${e?.message ?? e}`);
    })
    .finally(() => {
      entry!.running = false;
    });
}

/** 宝库任务树推进 */
export function tickVaultBrain(botName: string): void {
  tickTask(botName, "vault", () => createVaultTaskTree(vaultPorts));
}

/** 劫掠任务树推进 */
export function tickRaidBrain(botName: string): void {
  tickTask(botName, "raid", () => createRaidTaskTree(raidPorts));
}

/** 钓鱼任务树推进 */
export function tickFishingBrain(botName: string): void {
  tickTask(botName, "fishing", () => createFishingTaskTree(fishingPorts));
}

/**
 * 任务对账：活跃（仍带对应标签）假人之外的树全部重置——
 * 停止已下发导航 + 清黑板。标签移除（UI 行为菜单 / /mp:tag 任意入口）
 * 后行为立即停止；重新开启时重新开始。
 * ⚠️ 宝库任务跳过**重连中**假人（safeReconnect 期间实体离线不在活跃列表，
 *    但树与黑板必须保留——重连完成后继续同一宝库）；劫掠无重连概念。
 */
function reconcileTask(taskId: string, activeBotNames: Iterable<string>, skipReconnecting: boolean): void {
  const active = new Set(activeBotNames);
  for (const [botName, tasks] of [...brains]) {
    const entry = tasks.get(taskId);
    if (!entry) continue;
    if (!active.has(botName) && !(skipReconnecting && reconnectingBots.has(botName))) {
      stopBotNavigation(botName);
      tasks.delete(taskId);
      if (tasks.size === 0) brains.delete(botName);
    }
  }
}

/** 宝库任务对账（跳过重连中） */
export function reconcileVaultBrains(activeBotNames: Iterable<string>): void {
  reconcileTask("vault", activeBotNames, true);
}

/** 劫掠任务对账（无重连概念，直接清理） */
export function reconcileRaidBrains(activeBotNames: Iterable<string>): void {
  reconcileTask("raid", activeBotNames, false);
}

/** 钓鱼任务对账（跳过重连中——重连完成后继续原树） */
export function reconcileFishingBrains(activeBotNames: Iterable<string>): void {
  reconcileTask("fishing", activeBotNames, true);
}

/** 停止假人当前导航移动（Bot 对象封装，守卫自含） */
function stopBotNavigation(botName: string): void {
  resolveBot(botName, botRegistry)?.stopMoving();
}

// ─── 引擎启动（main.ts worldLoad 后调用一次） ─────────────

/**
 * 启动 AI 行为引擎（幂等）：
 *   1. 行为菜单提交订阅：宝库/劫掠标签已由 UI 先落库 → 补"不在线"提示
 *   2. 10 tick interval：遍历在线假人 → 按标签分别推进任务树 + 任务对账
 */
export function startBrainEngine(): void {
  if (brainEngineStarted) return;
  brainEngineStarted = true;

  // 行为菜单提交：标签已由 UI 先落库 → 引擎按标签接管；补"不在线"提示
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const record = botRegistry.get(e.botName);
    if (!record) return;
    if (!record.online || record.death) {
      if (e.tags.includes(TAG_VAULT_MODE.value)) {
        player.sendMessage(
          `${color.playerName}[宝库] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动尝试开箱`,
        );
      }
      if (e.tags.includes(TAG_RAID_MODE.value)) {
        player.sendMessage(
          `${color.playerName}[劫掠] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动喝第一瓶`,
        );
      }
      if (e.tags.includes(TAG_FISH_MODE.value)) {
        player.sendMessage(
          `${color.playerName}[钓鱼] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动开始钓鱼`,
        );
      }
    }
  });

  system.runInterval(() => {
    let players;
    try {
      players = world.getPlayers({ tags: [BOT_TAG] });
    } catch {
      return;
    }
    const vaultBots: string[] = [];
    const raidBots: string[] = [];
    const fishingBots: string[] = [];
    for (const player of players) {
      try {
        if (player.hasTag(TAG_VAULT_MODE.value)) {
          vaultBots.push(player.name);
          tickVaultBrain(player.name);
        }
        if (player.hasTag(TAG_RAID_MODE.value)) {
          raidBots.push(player.name);
          tickRaidBrain(player.name);
        }
        if (player.hasTag(TAG_FISH_MODE.value)) {
          fishingBots.push(player.name);
          tickFishingBrain(player.name);
        }
      } catch (e: any) {
        console.warn(`[MockPlayer] AI 引擎异常 ${player.name}: ${e?.message ?? e}`);
      }
    }
    reconcileVaultBrains(vaultBots);
    reconcileRaidBrains(raidBots);
    reconcileFishingBrains(fishingBots);
  }, BRAIN_ENGINE_TICKS);
}
