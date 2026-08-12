// ─── 投掷物认主 UI ────────────────────────────────────
// 扫描假人 100 半径内自家投掷物（三叉戟/箭，主人或同主假人投掷的），
// 按聚集概率分档分组展示（★高 / ☆中 / ·低），批量勾选后认主为第二任。
// 附魔组件缺失的投掷物在 feature 层已跳过。

import { Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { botRegistry } from "../bootstrap/context";
import { formatPos } from "../format";
import { scanOwnTridents, claimTridents, type ClaimableTrident } from "../features/tridentClaim";

/** 聚集概率分档阈值（与 feature 层扫描一致） */
const TIER_HIGH = 0.6;
const TIER_MID = 0.3;

/** 投掷物类型 → 图标 */
const TYPE_ICONS: Record<string, string> = {
  "minecraft:thrown_trident": "🔱",
  "minecraft:arrow": "🏹",
};

// ─── 单条展示 ─────────────────────────────────────────

/** 单件投掷物的 toggle 标签：第一行=图标+名称+附魔+概率，第二行=坐标+认主状态 */
function entryLabel(botName: string, e: ClaimableTrident): string {
  const pct = Math.round(e.probability * 100);
  const probColor = e.probability >= TIER_HIGH ? color.success : e.probability >= TIER_MID ? color.gold : color.muted;
  const icon = TYPE_ICONS[e.typeId] ?? "🏹";
  const itemPart = e.itemLabel ? ` ${color.darkBlue}${e.itemLabel}` : "";

  // 认主状态徽标：已认主 / 覆盖他人 / 首次认主（无徽标）
  let status = "";
  if (e.currentSecondOwner) {
    if (e.currentSecondOwner === botName) {
      status = ` ${color.success}✔ 已是本假人`;
    } else {
      status = ` ${color.warn}⇄ 覆盖 ${color.playerName}${e.currentSecondOwner}`;
    }
  }

  return `${icon} ${color.accent}${e.label}${itemPart} ${probColor}聚集${pct}%\n${color.muted}${formatPos(e.pos)}${status}`;
}

// ─── 表单 ─────────────────────────────────────────────

/**
 * 展示投掷物认主表单。
 * 批量 toggle 勾选 → 认主（假人成为第二任，覆盖旧第二任）。
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

  const entries = scanOwnTridents(botName);
  if (entries === undefined) {
    player.sendMessage(`${color.error}无法获取假人实体`);
    return;
  }
  if (entries.length === 0) {
    player.sendMessage(`${color.warn}${color.playerName}${botName}${color.warn} 100 范围内没有可认主的自家投掷物（主人/同主假人投掷的三叉戟或箭）`);
    return;
  }

  const builder = new ModalFormBuilder()
    .title(`${color.bold}⚔ 投掷物认主 · ${botName}`)
    .header(
      `${color.muted}主人 ${color.playerName}${record.ownerName}${color.muted} · 半径 ${color.info}100${color.muted} 格 · 共 ${color.info}${entries.length}${color.muted} 个\n` +
      `${color.muted}勾选后该假人成为 ${color.accent}第二任主人${color.muted}（可覆盖旧第二任）`
    );

  // 按聚集概率分档分组（保持降序内序）
  const groups: { label: string; entries: ClaimableTrident[] }[] = [
    { label: `${color.success}★ 高聚集（≥60%）`, entries: entries.filter((e) => e.probability >= TIER_HIGH) },
    { label: `${color.gold}☆ 中等聚集（30%–59%）`, entries: entries.filter((e) => e.probability >= TIER_MID && e.probability < TIER_HIGH) },
    { label: `${color.muted}· 分散（<30%）`, entries: entries.filter((e) => e.probability < TIER_MID) },
  ];

  for (const g of groups) {
    if (g.entries.length === 0) continue;
    builder.divider();
    builder.header(`${g.label} · ${color.info}${g.entries.length}${color.muted} 个`);
    for (const entry of g.entries) {
      builder.toggle(`t${entry.entityId}`, entryLabel(botName, entry), {
        defaultValue: false,
        tooltip: "勾选后该假人将成为这件投掷物的第二任主人（覆盖原第二任）",
      });
    }
  }

  builder
    .divider()
    .submitButton(`✔ 认主选中投掷物（${entries.length} 个）`);

  builder.show(player).then((vals) => {
    if (!vals) return;
    const selected = entries
      .filter((e) => vals[`t${e.entityId}`] === true)
      .map((e) => e.entityId);
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
