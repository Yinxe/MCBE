// ─── 投掷物认主 UI ────────────────────────────────────
// 扫描假人 100 半径内自家投掷物（三叉戟/箭，主人或同主假人投掷的），
// 按聚集分组展示（半径 3 格链式聚集）：A01/A02...=三叉戟组、B01/B02...=箭组，
// 组按组内数量降序排列；批量勾选后认主为第二任。
// 附魔组件缺失的投掷物在 feature 层已跳过。
//
// ⚠️ ModalForm 背景为深色：文字只用亮色系（白/青/绿/黄），
//    不用深色调（§7 灰、§9 深蓝等）与粗体大字号。
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    claimTrident 动作 → 弹表单。

import { Player, world } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../core/events/UiEvents";
import { botRegistry } from "../bootstrap/context";
import { scanOwnTridents, claimTridents, type ClaimableTrident, type ClaimGroup } from "../features/tridentClaim";
import { projectileTypeLabel } from "../../core/items/TridentClaimRules";

// ─── UI 事件订阅（BOT 主菜单 → 感知认主动作） ──────────

/** 订阅 BOT 主菜单动作事件：投掷物认主 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "claimTrident") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showTridentClaimUI(player, e.botName);
  });
}

/** 聚集概率分档阈值（组内邻居密度归一化） */
const TIER_HIGH = 0.6;
const TIER_MID = 0.3;

/** 投掷物类型 → 图标 */
const TYPE_ICONS: Record<string, string> = {
  "minecraft:thrown_trident": "🔱",
  "minecraft:arrow": "🏹",
};

// ─── 单条展示 ─────────────────────────────────────────

/** 单件投掷物的 toggle 标签（单行、亮色系） */
function entryLabel(botName: string, e: ClaimableTrident): string {
  const pct = Math.round(e.probability * 100);
  const probColor = e.probability >= TIER_HIGH ? color.success : e.probability >= TIER_MID ? color.warn : color.info;
  const icon = TYPE_ICONS[e.typeId] ?? "🏹";
  const itemPart = e.itemLabel ? ` ${color.info}${e.itemLabel}` : "";
  const pos = `[${Math.floor(e.pos.x)} ${Math.floor(e.pos.y)} ${Math.floor(e.pos.z)}]`;

  // 认主状态：已认主 / 覆盖他人 / 首次认主（无标注）
  let status = "";
  if (e.currentSecondOwner) {
    if (e.currentSecondOwner === botName) {
      status = ` ${color.success}✔已认主`;
    } else {
      status = ` ${color.warn}⇄覆盖${color.playerName}${e.currentSecondOwner}`;
    }
  }

  return `${icon} ${color.accent}${e.label}${itemPart} ${color.info}${pos} ${probColor}${pct}%${status}`;
}

/** 组标题：A01 · 三叉戟 × 3（亮色系） */
function groupLabel(g: ClaimGroup): string {
  return `${color.accent}${g.id} ${color.muted}${projectileTypeLabel(g.typeId)} × ${color.info}${g.entries.length}`;
}

// ─── 表单 ─────────────────────────────────────────────

/**
 * 展示投掷物认主表单。
 * 按聚集分组展示（组按数量降序），批量 toggle 勾选 → 认主（假人成为第二任，覆盖旧第二任）。
 */
export function showTridentClaimUI(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
    player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`);
    return;
  }
  if (!record.online || record.death) {
    player.sendMessage(`${color.error}假人不在线或已死亡`);
    return;
  }
  if (!record.ownerName) {
    player.sendMessage(`${color.error}无主假人无法认主（没有主人体系）`);
    return;
  }

  const groups = scanOwnTridents(botName);
  if (groups === undefined) {
    player.sendMessage(`${color.error}无法获取假人实体`);
    return;
  }
  const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
  if (total === 0) {
    player.sendMessage(`${color.warn}${color.playerName}${botName}${color.warn} 100 范围内没有可认主的自家投掷物（主人/同主假人投掷的三叉戟或箭）`);
    return;
  }

  const builder = new ModalFormBuilder()
    .title(`投掷物认主 · ${botName}`)
    .label(
      "summary",
      `${color.info}主人 ${color.playerName}${record.ownerName}${color.info} · 共 ${color.accent}${total}${color.info} 个 · ${color.info}${groups.length}${color.info} 个聚集组 · 勾选后认主为第二任（可覆盖）`
    );

  // 聚集分组展示：组标题（A01/B01...，组按数量降序）+ 组内 toggle
  for (const g of groups) {
    builder.label(`h-${g.id}`, groupLabel(g));
    for (const entry of g.entries) {
      builder.toggle(`t${entry.entityId}`, entryLabel(botName, entry), {
        defaultValue: false,
        tooltip: "勾选后该假人将成为这件投掷物的第二任主人（覆盖原第二任）",
      });
    }
  }

  builder.submitButton("提交");

  builder.show(player).then((vals) => {
    if (!vals) return;
    const selected: string[] = [];
    for (const g of groups) {
      for (const e of g.entries) {
        if (vals[`t${e.entityId}`] === true) selected.push(e.entityId);
      }
    }
    if (selected.length === 0) {
      player.sendMessage(`${color.warn}未选择任何投掷物`);
      return;
    }
    const claimed = claimTridents(botName, selected, player.name);
    const failed = selected.length - claimed;
    let msg = `${color.success}已认主 ${color.info}${claimed}${color.success}/${color.info}${selected.length}${color.success} 件投掷物 → ${color.playerName}${botName}`;
    if (failed > 0) msg += `${color.warn}（${failed} 件认主失败）`;
    player.sendMessage(msg);
  });
}
