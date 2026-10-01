// ─── 丢弃物品面板 ───
// 离线也可开表单（提交时不在线才报错）；防吞物品算法全在 engine PanelOps.discardSlots，
// 本层只翻译勾选为槽位集合。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord } from "../../domain/Record";
import type { EquipSlotName } from "../../domain/Record";
import type { ItemSummary } from "../../engine/PanelOps";
import { botStatus, uiViewer } from "../Kit";
import { services } from "../../Composition";

function shortInfo(s: ItemSummary | null | undefined): string {
  if (!s) return "空";
  return `${s.typeId.replace("minecraft:", "")} x${s.amount}`;
}

interface DiscardSnapshot {
  mainhand: string;
  hotbar: string;
  backpack: string;
  offhand: string;
  head: string;
  chest: string;
  legs: string;
  feet: string;
  selectedSlot: number;
}

function snapshot(record: BotRecord): DiscardSnapshot {
  const st = botStatus(record);
  const view = st.online && !st.death ? services.panelOps.liveSlots(record.botId) : undefined;
  if (!view) {
    return {
      mainhand: "空",
      hotbar: "空 (0/9)",
      backpack: "空 (0/27)",
      offhand: "空",
      head: "空",
      chest: "空",
      legs: "空",
      feet: "空",
      selectedSlot: 0,
    };
  }
  const hotbarFilled = view.inv.slice(0, 9).filter(Boolean).length;
  const backpackFilled = view.inv.slice(9, 36).filter(Boolean).length;
  return {
    mainhand: shortInfo(view.inv[view.selected]),
    hotbar: hotbarFilled === 0 ? "空 (0/9)" : `${hotbarFilled}/9 格有物品`,
    backpack: backpackFilled === 0 ? "空 (0/27)" : `${backpackFilled}/27 格有物品`,
    offhand: shortInfo(view.equip.offhand),
    head: shortInfo(view.equip.head),
    chest: shortInfo(view.equip.chest),
    legs: shortInfo(view.equip.legs),
    feet: shortInfo(view.equip.feet),
    selectedSlot: view.selected,
  };
}

export function showDiscardForm(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const s = snapshot(record);
  void ModalFormBuilder.showQuick(player, `${color.bold}丢弃物品 · ${record.name}`, (f) => {
    f.label("hint", `${color.muted}勾选需要丢弃的槽位，提交后以掉落物形式丢出`);
    f.toggle("mainhand", `主手: ${s.mainhand}`, { defaultValue: false });
    f.toggle("hotbar", `热栏: ${s.hotbar}`, { defaultValue: false });
    f.toggle("backpack", `背包: ${s.backpack}`, { defaultValue: false });
    f.toggle("offhand", `副手: ${s.offhand}`, { defaultValue: false });
    f.toggle("head", `头盔: ${s.head}`, { defaultValue: false });
    f.toggle("chest", `胸甲: ${s.chest}`, { defaultValue: false });
    f.toggle("legs", `护腿: ${s.legs}`, { defaultValue: false });
    f.toggle("feet", `靴子: ${s.feet}`, { defaultValue: false });
    f.submitButton("丢弃");
  }).then((vals) => {
    if (!vals) return;
    void system.run(async () => {
      try {
        const live = services.runtime.record(record.botId);
        if (!live) {
          say(`${color.error}模拟玩家 ${color.playerName}${record.name}${color.error} 已不存在`);
          return;
        }
        const st = botStatus(live);
        if (!st.online || st.death) {
          say(`${color.error}假人不在线`);
          return;
        }
        const view = services.panelOps.liveSlots(live.botId);
        if (!view) {
          say(`${color.error}无法获取假人实体`);
          return;
        }
        const invSlots: number[] = [];
        if (vals.mainhand) invSlots.push(view.selected);
        if (vals.hotbar) invSlots.push(...[...Array(9)].map((_, i) => i));
        if (vals.backpack) invSlots.push(...[...Array(27)].map((_, i) => i + 9));
        const equipSlots: EquipSlotName[] = [];
        for (const name of ["offhand", "head", "chest", "legs", "feet"] as EquipSlotName[]) {
          if (vals[name]) equipSlots.push(name);
        }
        const filled =
          [...new Set(invSlots)].filter((i) => view.inv[i]).length + equipSlots.filter((n) => view.equip[n]).length;
        if (filled === 0) {
          say(`${color.warn}没有可丢弃的物品`);
          return;
        }
        const r = await services.panelOps.discardSlots(live.botId, [...new Set(invSlots)], equipSlots);
        system.run(() =>
          say(
            r.dropped === 0
              ? `${color.warn}没有可丢弃的物品`
              : `${color.success}已丢出 ${color.info}${r.dropped}${color.success} 个槽位的物品为掉落物${r.failed > 0 ? ` ${color.warn}（${r.failed} 件丢弃失败，物品保留）` : ""}`
          )
        );
      } catch (e) {
        system.run(() => say(`${color.error}丢弃失败: ${(e as Error).message}`));
      }
    });
  });
}
