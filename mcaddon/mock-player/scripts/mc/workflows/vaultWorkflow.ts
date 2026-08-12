// ─── 宝库工作流（mc/workflows） ───────────────────────
// 每个工作流单独一份文件（本目录 = 工作流定义，与 features 功能实现分离）。
// 业务逻辑在 features/vaultMode.ts（runVaultCycle 开箱周期），本文件做
// 生命周期壳 + **独立引擎**（10 tick 遍历宝库标签在线假人驱动开箱——
// 不共享统一行为引擎，从 behavior.ts 迁出）。
// 对外事件走领域事件模式（BotWorkflowEvent.vaultOpened，独立信号）。

import { world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import type { Workflow } from "../../core/service/Workflow";
import { BOT_TAG, TAG_VAULT_MODE } from "../../core/tags/BotTags";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { runVaultCycle } from "../features/vaultMode";

/** 宝库工作流：钥匙开宝库 → 保存 → 重连 → 继续（自带独立引擎） */
export const vaultWorkflow: Workflow = {
  name: "vault-mode",
  description: "宝库模式：手持钥匙开 Trial Chambers 宝库，成功后下线重连循环",

  init(): void {
    // 引擎由 WorkflowManager 调度（initAll 时按 intervalTicks 创建独立 interval）
  },

  start(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record || record.tags.includes(TAG_VAULT_MODE.value)) return;
    record.tags.push(TAG_VAULT_MODE.value);
    saveCoordinator.saveRecord(record);
  },

  stop(botName?: string): void {
    if (!botName) return;
    const record = botRegistry.get(botName);
    if (!record) return;
    record.tags = record.tags.filter((t) => t !== TAG_VAULT_MODE.value);
    saveCoordinator.saveRecord(record);
  },

  isRunning(botName?: string): boolean {
    if (!botName) return false;
    const record = botRegistry.get(botName);
    return !!record && record.tags.includes(TAG_VAULT_MODE.value) && record.online && !record.death;
  },

  // ── 独立引擎：每 10 tick 遍历宝库标签在线假人，执行一次开箱周期 ──
  engine: {
    intervalTicks: 10,
    tick(): void {
      let players;
      try {
        players = world.getPlayers({ tags: [BOT_TAG] });
      } catch {
        return;
      }
      for (const player of players) {
        try {
          if (!player.hasTag(TAG_VAULT_MODE.value)) continue;
          const record = botRegistry.get(player.name);
          if (!record || record.death || !record.online) continue;
          runVaultCycle(player as SimulatedPlayer, record);
        } catch (e: any) {
          console.warn(`[MockPlayer] 宝库模式异常 ${player.name}: ${e?.message ?? e}`);
        }
      }
    },
  },
};
