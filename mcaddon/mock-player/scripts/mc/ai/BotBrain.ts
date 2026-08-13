// ─── 假人大脑（mc/ai） ───────────────────────────────────
// 每假人一棵行为树（惰性创建，黑板独立）。
// 引擎驱动：vaultWorkflow 的 10 tick 引擎调用 tickBotBrain。
//   - 假人不可用（离线/死亡/重连中）→ 不推进（黑板保留 → 重连后继续同一目标）
//   - 防重入：导航协程进行中跳过本次 tick

import { system } from "@minecraft/server";

import { Blackboard, BehaviorTree, type AiContext } from "../../core/ai";
import { createVaultTaskTree, type VaultPorts } from "../../core/ai/VaultTask";
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

/** 清空假人的大脑（删除假人/切换模式时可选调用；黑板目标随之丢弃） */
export function resetBotBrain(botName: string): void {
  brains.delete(botName);
}
