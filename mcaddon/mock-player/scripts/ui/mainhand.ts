// ─── 主手物品选择 UI ──────────────────────────────────
// 模态表单用下拉选择框选择假人的主手物品

import { Player, system } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ModalFormBuilder } from "@yinxe/toolkit";

import { botRegistry } from "../features/core/persistence";
import { getMainhandOptions, setMainhandSlot } from "../features/mainhand";

/**
 * 展示主手物品选择表单。
 * 若背包为空 → 提示，不弹 UI。
 */
export function showMainhandSelector(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 已不存在`); return; }
  if (!record.online || record.death) { player.sendMessage(`${color.error}假人不在线或已死亡`); return; }

  const options = getMainhandOptions(botName);
  if (!options) { player.sendMessage(`${color.error}无法获取假人实体`); return; }
  if (options.length <= 1) {
    player.sendMessage(`${color.error}假人背包中没有其他物品可供选择`);
    return;
  }

  new ModalFormBuilder()
    .title(`${color.bold}选择主手物品`)
    .dropdown("slot", style("选择要放置在主手（slot 0）的物品", color.darkGray), options.map(o => o.label), { defaultValueIndex: 0 })
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const idx = (vals as Record<string, any>)["slot"] as number;
      if (idx === undefined || idx < 0 || idx >= options.length) return;
      const selected = options[idx];
      system.run(() => {
        setMainhandSlot(botName, selected.value);
        if (selected.value === -1) {
          player.sendMessage(`${color.success}已将 ${color.playerName}${botName}${color.success} 的主手清空`);
        } else {
          player.sendMessage(`${color.success}已将 ${color.playerName}${botName}${color.success} 的物品设置为主手`);
        }
      });
    });
}
