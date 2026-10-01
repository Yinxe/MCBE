// ─── 物品互换面板 ───
// 四开关直选；背包含主手的执行序由 engine swapWithPlayer 承载，本层只翻勾选+播报。
// 全部操作同一 system.run 防竞态；提交侧须复核管理权（期间可能易主）。

import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord } from "../../domain/Record";
import type { ItemSummary, SwapFlags } from "../../engine/PanelOps";
import { ensureUiBotAvailable, guardUiManage, uiViewer } from "../Kit";
import { services } from "../../Composition";

function shortInfo(s: ItemSummary | null | undefined): string {
  if (!s) return "空";
  return `${s.typeId.replace("minecraft:", "")} x${s.amount}`;
}

const ARMOR_NAMES: Record<string, string> = { head: "头盔", chest: "胸甲", legs: "护腿", feet: "靴子" };

export function showSwapForm(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  if (!ensureUiBotAvailable(say, record)) return;
  const view = services.panelOps.liveSlots(record.botId);
  if (!view) {
    say(`${color.error}无法获取假人实体`);
    return;
  }
  const armorEntries = (["head", "chest", "legs", "feet"] as const).filter((n) => view.equip[n]);
  const armorInfo =
    armorEntries.length === 0
      ? "空 (0/4)"
      : `${armorEntries.length}/4 ${color.muted}(${armorEntries.map((n) => `${ARMOR_NAMES[n]}:${(view.equip[n] as ItemSummary).typeId.replace("minecraft:", "")}`).join(" ")})`;
  const invFilled = view.inv.filter(Boolean).length;
  const inventoryInfo = invFilled === 0 ? "空 (0/36)" : `${invFilled}/36 格有物品`;
  void ModalFormBuilder.showQuick(player, `${color.bold}互换项目`, (f) => {
    f.toggle("mainhand", `互换主手: ${shortInfo(view.inv[view.selected])}`, { defaultValue: false });
    f.toggle("offhand", `互换副手: ${shortInfo(view.equip.offhand)}`, { defaultValue: false });
    f.toggle("armor", `互换装备: ${armorInfo}`, { defaultValue: false });
    f.toggle("inventory", `互换背包: ${inventoryInfo}`, { defaultValue: false });
    f.submitButton("互换");
  }).then((vals) => {
    if (!vals) return;
    const flags: SwapFlags = {
      mainhand: Boolean(vals.mainhand),
      offhand: Boolean(vals.offhand),
      armor: Boolean(vals.armor),
      inventory: Boolean(vals.inventory),
    };
    if (!flags.mainhand && !flags.offhand && !flags.armor && !flags.inventory) {
      say(`${color.warn}未选择任何互换项目`);
      return;
    }
    try {
      const live = services.runtime.record(record.botId);
      if (!live) {
        say(`${color.error}模拟玩家 ${color.playerName}${record.name}${color.error} 已不存在`);
        return;
      }
      if (!guardUiManage(say, viewer, live)) return;
      const r = services.panelOps.swapWithPlayer(player.name, live.botId, flags);
      if (r.error) {
        say(`${color.error}互换失败: ${r.error}`);
        return;
      }
      say(`${color.success}已与 ${color.playerName}${record.name}${color.success} 互换${r.done.join("、")}`);
    } catch (e) {
      say(`${color.error}互换失败: ${(e as Error).message}`);
    }
  });
}
