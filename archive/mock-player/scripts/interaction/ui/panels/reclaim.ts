// ─── 回收资源预览表单 ──────────────────────────────────
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    reclaim 动作 → 弹表单 → 提交后直接调 reclaimBot。

import { Player, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import type { BotRecord, ItemPreview } from "../../../rules/Types";
import type { ReclaimOptions } from "../../../service/ReclaimPlanner";
import { BotUiEvent } from "../../../events/UiEvents";
import { getReclaimPreview, reclaimBot, type ReclaimResult } from "../../../features/manage/reclaim";
import { resolveUiBotRecord } from "../helpers";
import { formatItemPreview } from "../../../service/ReclaimPlanner";

// ─── UI 事件订阅（BOT 主菜单 → 感知回收动作） ──────────

/** 订阅 BOT 主菜单动作事件：回收资源 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "reclaim") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    const record = resolveUiBotRecord(player, e.botName);
    if (!record) return;
    showReclaimForm(player, record);
  });
}

// ─── 行内辅助 ──────────────────────────────────────────

function sectionLabel(label: string, preview: ItemPreview | null): string {
  if (!preview) return `${color.accent}${label}: ${color.muted}空`;
  return `${color.accent}${label}: ${color.playerName}${formatItemPreview(preview)}`;
}

function xpLabel(xp: { level: number; totalXp: number } | null): string {
  if (!xp) return `${color.accent}经验等级: ${color.muted}无`;
  return `${color.accent}经验等级: ${color.playerName}Lv.${xp.level} ${color.muted}(${xp.totalXp} XP)`;
}

function invLabel(summary: string): string {
  if (summary === "空") return `${color.accent}背包: ${color.muted}空`;
  return `${color.accent}背包: ${color.info}${summary}`;
}

// ─── 表单 ──────────────────────────────────────────────

export function showReclaimForm(player: Player, record: BotRecord, onBack?: () => void): void {
  const preview = getReclaimPreview(record);

  new ModalFormBuilder()
    .title(`${color.bold}回收资源 · ${record.name}`)
    // ── 经验 ──
    .label("xpLabel", xpLabel(preview.xp))
    .toggle("xp", "回收经验等级", { defaultValue: false })
    // ── 主手 ──
    .label("mhLabel", sectionLabel("主手", preview.mainhand))
    .toggle("mainhand", "回收主手物品", { defaultValue: false })
    // ── 副手 ──
    .label("ohLabel", sectionLabel("副手", preview.offhand))
    .toggle("offhand", "回收副手物品", { defaultValue: false })
    // ── 装备 ──
    .label("headLabel", sectionLabel("头盔", preview.head))
    .toggle("head", "回收头盔", { defaultValue: false })
    .label("chestLabel", sectionLabel("胸甲", preview.chest))
    .toggle("chest", "回收胸甲", { defaultValue: false })
    .label("legsLabel", sectionLabel("护腿", preview.legs))
    .toggle("legs", "回收护腿", { defaultValue: false })
    .label("feetLabel", sectionLabel("靴子", preview.feet))
    .toggle("feet", "回收靴子", { defaultValue: false })
    // ── 背包 ──
    .label("invLabel", invLabel(preview.inventorySummary))
    .toggle("inventory", "回收背包", { defaultValue: true })
    // ── 提交 ──
    .submitButton("回收")
    .show(player)
    .then((vals) => {
      if (!vals) return;
      system.run(() => {
        try {
          const opts: ReclaimOptions = {
            xp: vals.xp as boolean,
            mainhand: vals.mainhand as boolean,
            offhand: vals.offhand as boolean,
            head: vals.head as boolean,
            chest: vals.chest as boolean,
            legs: vals.legs as boolean,
            feet: vals.feet as boolean,
            inventory: vals.inventory as boolean,
          };
          const result = reclaimBot(player, record, opts);
          const parts: string[] = [];
          if (result.items > 0) parts.push(`${color.success}${result.items}${color.info} 件物品`);
          if (result.overflow > 0) parts.push(`${color.warn}${result.overflow}${color.info} 件溢出掉落`);
          if (result.xp > 0) parts.push(`${color.accent}${result.xp} XP${color.info}（Lv.${result.xpLevel}）`);
          if (parts.length === 0) {
            player.sendMessage(`${color.warn}假人 ${color.playerName}${record.name}${color.warn} 背包是空的`);
          } else {
            player.sendMessage(`${color.success}已从 ${color.playerName}${record.name}${color.success} 回收: ${parts.join("、")}`);
          }
        } catch (e: any) { player.sendMessage(`${color.error}回收失败: ${e.message}`); }
      });
    });
}
