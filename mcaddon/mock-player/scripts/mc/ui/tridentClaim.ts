// ─── 三叉戟认主 UI ─────────────────────────────────────
// 扫描假人 100 半径内自家三叉戟（主人/同主假人投掷的），
// 展示附魔状态 + 坐标 + 聚集概率（按概率降序），批量勾选后认主为第二任。
// 附魔组件缺失的三叉戟在 feature 层已跳过。

import { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { botRegistry } from "../bootstrap/context";
import { formatPos } from "../format";
import { scanOwnTridents, claimTridents } from "../features/tridentClaim";

/**
 * 展示三叉戟认主表单。
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
    player.sendMessage(`${color.warn}${color.playerName}${botName}${color.warn} 100 范围内没有可认主的自家三叉戟（主人/同主假人投掷的）`);
    return;
  }

  const builder = new ModalFormBuilder().title(`${color.bold}三叉戟认主（${botName}）`);
  builder.header(`${color.muted}共 ${color.info}${entries.length}${color.muted} 把 · 按聚集概率降序 · 认主=第二任（覆盖旧第二任）`);

  for (const entry of entries) {
    const pct = Math.round(entry.probability * 100);
    const probTag = pct >= 60 ? color.darkRed : pct >= 30 ? color.gold : color.darkGray;
    const itemPart = entry.itemLabel ? ` ${color.muted}| ${entry.itemLabel}` : "";
    builder.toggle(
      `t${entry.entityId}`,
      `${color.muted}${formatPos(entry.pos)} ${probTag}聚集${pct}%${itemPart}`,
      {
        defaultValue: false,
        tooltip: "勾选后该假人将成为这把三叉戟的第二任主人（覆盖原第二任）",
      }
    );
  }

  builder.show(player).then((vals) => {
    if (!vals) return;
    const selected = entries
      .filter((e) => vals[`t${e.entityId}`] === true)
      .map((e) => e.entityId);
    if (selected.length === 0) {
      player.sendMessage(`${color.warn}未选择任何三叉戟`);
      return;
    }
    const claimed = claimTridents(botName, selected);
    player.sendMessage(
      `${color.success}已认主 ${color.info}${claimed}/${selected.length}${color.success} 把三叉戟 → ${color.playerName}${botName}`
    );
  });
}