// ─── 选择主手面板 ───
// "固定:无"显隐：主手已空恒显，否则仅存在非主手空位时显；
// 绝不吞物品的纪律在 engine Wielder，本层只映射结果语。

import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, style, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord } from "../../domain/Record";
import type { MainhandMenu } from "../../engine/PanelOps";
import { wielder } from "../../engine/Wielder";
import {
  ensureUiBotAvailable,
  formatDurability,
  formatEnchantments,
  itemDisplayName,
  slotLabel,
  uiViewer,
} from "../Kit";
import { services } from "../../Composition";

function optionLabel(i: { slot: number; item: MainhandMenu["options"][number]["item"] }): string {
  const slotTag = i.slot < 9 ? color.gold : color.black;
  const dur = formatDurability(i.item);
  const ench = formatEnchantments(i.item);
  return `${slotTag}[${slotLabel(i.slot)}] ${color.black}${itemDisplayName(i.item)}x${i.item.amount}${dur ? ` ${dur}` : ""}${ench ? `\n ${ench}` : ""}`;
}

export function showMainhandSelector(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  if (!ensureUiBotAvailable(say, record)) return;
  const menu = services.panelOps.mainhandMenu(record.botId);
  if (!menu) {
    say(`${color.error}无法获取假人实体`);
    return;
  }
  const showNone = menu.mainhandEmpty || menu.hasEmpty;
  const values: number[] = showNone ? [-1] : [];
  for (const o of menu.options) values.push(o.slot);
  if (values.length <= 1) {
    say(`${color.error}假人背包中没有其他物品可供选择`);
    return;
  }
  const labels: string[] = [];
  if (showNone) labels.push(style("固定:无", color.darkGray));
  for (const o of menu.options) labels.push(optionLabel(o));
  void ModalFormBuilder.showQuick(player, `${color.bold}选择主手物品`, (f) => {
    f.dropdown("slot", style("选择要放置在主手（slot 0）的物品", color.playerName), labels, { defaultValueIndex: 0 });
  }).then((vals) => {
    if (!vals) return;
    const idx = typeof vals.slot === "number" ? vals.slot : -1;
    if (idx < 0 || idx >= values.length) return;
    const value = values[idx]!;
    const r = wielder.setMainhand(record.botId, value);
    if (r !== "ok") {
      say(`${color.warn}${color.playerName}${record.name}${color.warn} 主手未清空：背包没有空位可放置（物品已保留）`);
      return;
    }
    say(
      value === -1
        ? `${color.success}已将 ${color.playerName}${record.name}${color.success} 的主手物品移至背包空位`
        : `${color.success}已将 ${color.playerName}${record.name}${color.success} 的物品设置为主手`
    );
  });
}
