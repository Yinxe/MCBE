// ─── 主手物品选择 UI ──────────────────────────────────
// 模态表单用下拉选择框选择假人的主手物品
// ⚠️ UI 事件驱动：面板按钮只发布 panelAction（ui/bot.ts），本文件订阅
//    selectMainhand 动作 → 弹表单 → 提交后直接调 setMainhandSlot。

import { Player, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { BotUiEvent } from "../../../events/UiEvents";
import { getMainhandOptions, setMainhandSlot } from "../../../features/basic/items";
import { ensureUiBotAvailable, resolveUiBotRecord } from "../helpers";

// ─── UI 事件订阅（BOT 主菜单 → 感知选择主手动作） ──────

/** 订阅 BOT 主菜单动作事件：选择主手 → 弹表单 */
export function registerUiSubscriptions(): void {
  BotUiEvent.panelAction.subscribe((e) => {
    if (e.action !== "selectMainhand") return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    showMainhandSelector(player, e.botName);
  });
}

/**
 * 展示主手物品选择表单。
 * 若背包为空 → 提示，不弹 UI。
 */
export function showMainhandSelector(player: Player, botName: string): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;
  if (!ensureUiBotAvailable(player, record)) return;

  const options = getMainhandOptions(botName);
  if (!options) { player.sendMessage(`${color.error}无法获取假人实体`); return; }
  if (options.length <= 1) {
    player.sendMessage(`${color.error}假人背包中没有其他物品可供选择`);
    return;
  }

  new ModalFormBuilder()
    .title(`${color.bold}选择主手物品`)
    .dropdown("slot", style("选择要放置在主手（slot 0）的物品", color.playerName), options.map(o => o.label), { defaultValueIndex: 0 })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const idx = (vals as Record<string, any>)["slot"] as number;
      if (idx === undefined || idx < 0 || idx >= options.length) return;
      const selected = options[idx];
      system.run(() => {
        const ok = setMainhandSlot(botName, selected.value);
        if (!ok) {
          // 无空位/主手为空/失败：未处理，物品保留（绝不吞物品）
          player.sendMessage(`${color.warn}${color.playerName}${botName}${color.warn} 主手未清空：背包没有空位可放置（物品已保留）`);
          return;
        }
        if (selected.value === -1) {
          player.sendMessage(`${color.success}已将 ${color.playerName}${botName}${color.success} 的主手物品移至背包空位`);
        } else {
          player.sendMessage(`${color.success}已将 ${color.playerName}${botName}${color.success} 的物品设置为主手`);
        }
      });
    });
}
