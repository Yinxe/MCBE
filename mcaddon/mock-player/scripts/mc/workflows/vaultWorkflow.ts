// ─── 宝库工作流（mc/workflows） ───────────────────────────
// 每个工作流单独一份文件（本目录 = 工作流定义，与 features 功能实现分离）。
// 业务逻辑在 mc/ai（行为树）：core/ai/VaultTask 决策（可单测）→
// McVaultPorts 副作用（扫描/寻路/开箱/重连）→ BotBrain 每假人一棵树。
// 本文件做生命周期壳 + **独立引擎**（10 tick 遍历宝库标签在线假人驱动
// 各自行为树——自动寻路开宝库：扫描 → 寻路 → 开箱 → 安全重连 → 继续同一宝库）
// + 标签对账（移除标签 → 停止导航清黑板） + 不在线提示。
// 对外事件走领域事件模式（BotWorkflowEvent.vaultOpened，独立信号）。

import { world, type Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import type { Workflow } from "../../core/service/Workflow";
import { BOT_TAG, TAG_VAULT_MODE } from "../../core/tags/BotTags";
import { BotUiEvent } from "../../core/events/UiEvents";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import { tickBotBrain, reconcileBotBrains } from "../ai/BotBrain";

/** 宝库工作流：自动寻路开宝库 → 保存 → 重连 → 继续（自带独立引擎） */
export const vaultWorkflow: Workflow = {
  name: "vault-mode",
  description: "宝库模式：手持钥匙自动寻路开 Trial Chambers 宝库，成功后下线重连循环",

  init(): void {
    // 行为菜单提交：宝库标签已由 UI 先落库 → 引擎按标签接管；补"不在线"提示
    BotUiEvent.behaviorSubmitted.subscribe((e) => {
      if (!e.tags.includes(TAG_VAULT_MODE.value)) return;
      const record = botRegistry.get(e.botName);
      if (!record) return;
      if (!record.online || record.death) {
        (world.getEntity(e.playerId) as Player | undefined)?.sendMessage(
          `${color.playerName}[宝库] ${color.warn}${e.botName}${color.muted} 不在线，上线后将自动尝试开箱`,
        );
      }
    });
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

  // ── 独立引擎：每 10 tick 遍历宝库标签在线假人，推进各自行为树 ──
  // 树内决策（扫描/寻路/开箱/重连）由 core/ai/VaultTask 定义，此处只做分发；
  // 假人不可用（离线/重连中）时 BotBrain 静默跳过（黑板保留 → 重连后继续）。
  // 对账：活跃（带标签）之外的树 → 停止导航 + 清黑板（标签移除立即生效，
  // 重新开启时重新扫描）。
  engine: {
    intervalTicks: 10,
    tick(): void {
      let players;
      try {
        players = world.getPlayers({ tags: [BOT_TAG] });
      } catch {
        return;
      }
      const vaultBots: string[] = [];
      for (const player of players) {
        try {
          if (!player.hasTag(TAG_VAULT_MODE.value)) continue;
          vaultBots.push(player.name);
          tickBotBrain(player.name);
        } catch (e: any) {
          console.warn(`[MockPlayer] 宝库 AI 异常 ${player.name}: ${e?.message ?? e}`);
        }
      }
      reconcileBotBrains(vaultBots);
    },
  },
};
