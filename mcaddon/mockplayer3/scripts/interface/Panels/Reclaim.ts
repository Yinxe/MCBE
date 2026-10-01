// ─── 回收资源面板（九开关互不重叠） ──
// 离线也可开（预览走仓快照）。勾选序：经验/热栏(除主手)/背包(27)/主手/副手/
// 头/胸/腿/靴；热栏+主手+背包恰覆盖 36 格（选中格外 0-8 / 选中格 / 9-35）。
// 主手口径双路统一：在线=选中槽、离线=slot0（与 EntityOps 执行同源）。
// 选择性回收只回写勾中槽位，未勾动一格（EntityOps 双路 sel 过滤）。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import type { ReclaimSelection } from "../../engine/EntityOps";
import type { ItemSummary, SlotsView } from "../../engine/PanelOps";
import { botStatus, invSummary, formatItemPreview, uiViewer } from "../Kit";
import { services } from "../../Composition";
import type { BotRecord } from "../../domain/Record";

interface ReclaimPreview {
  xp: { level: number; totalXp: number } | null;
  hotbar: (ItemSummary | null)[];
  inventory: (ItemSummary | null)[];
  mainhand: ItemSummary | null;
  offhand: ItemSummary | null;
  head: ItemSummary | null;
  chest: ItemSummary | null;
  legs: ItemSummary | null;
  feet: ItemSummary | null;
}

function buildPreview(record: BotRecord): ReclaimPreview {
  const { panelOps, ops } = services;
  const st = botStatus(record);
  const live = st.online && !st.death;
  const exp = live ? (ops.captureExperience(record.botId) ?? record.experience) : record.experience;
  let mainhand: ItemSummary | null = null;
  let hotbar: (ItemSummary | null)[] = [];
  let inv: (ItemSummary | null)[] = [];
  let equip: SlotsView["equip"] = {};
  if (live) {
    const view = panelOps.liveSlots(record.botId);
    if (view) {
      mainhand = view.inv[view.selected] ?? null;
      hotbar = view.inv.slice(0, 9).map((s, i) => (i === view.selected ? null : s));
      inv = view.inv.slice(9);
      equip = view.equip;
    }
  } else {
    const vault = panelOps.vaultSlots(record.botId);
    const full = vault.inv ?? [];
    mainhand = full[0] ?? null;
    hotbar = full.slice(1, 9);
    inv = full.slice(9);
    equip = vault.equip ?? {};
  }
  return {
    xp: exp.totalXp > 0 ? { level: exp.level, totalXp: exp.totalXp } : null,
    hotbar,
    inventory: inv,
    mainhand,
    offhand: equip.offhand ?? null,
    head: equip.head ?? null,
    chest: equip.chest ?? null,
    legs: equip.legs ?? null,
    feet: equip.feet ?? null,
  };
}

function sectionLabel(label: string, preview: ItemSummary | null): string {
  return preview === null
    ? `${color.accent}${label}: ${color.muted}空`
    : `${color.accent}${label}: ${color.playerName}${formatItemPreview(preview)}`;
}

function groupLabel(label: string, list: (ItemSummary | null)[]): string {
  const s = invSummary(list);
  return s.filled === 0
    ? `${color.accent}${label}: ${color.muted}空`
    : `${color.accent}${label}: ${color.info}${s.summary}`;
}

export function showReclaimForm(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  const viewer = uiViewer(player);
  const p = buildPreview(record);
  void ModalFormBuilder.showQuick(player, `${color.bold}回收资源 · ${record.name}`, (f) => {
    f.label(
      "xpLabel",
      p.xp === null
        ? `${color.accent}经验等级: ${color.muted}无`
        : `${color.accent}经验等级: ${color.playerName}Lv.${p.xp.level} ${color.muted}(${p.xp.totalXp} XP)`
    );
    f.toggle("xp", "回收经验", { defaultValue: false });
    f.label("hotbarLabel", groupLabel("热栏（除主手）", p.hotbar));
    f.toggle("hotbar", "回收热栏(无主手)", { defaultValue: false });
    f.label("invLabel", groupLabel("背包（27 格）", p.inventory));
    f.toggle("inventory", "回收背包(27)", { defaultValue: true });
    f.label("mhLabel", sectionLabel("主手", p.mainhand));
    f.toggle("mainhand", "主手", { defaultValue: false });
    f.label("ohLabel", sectionLabel("副手", p.offhand));
    f.toggle("offhand", "副手", { defaultValue: false });
    f.label("headLabel", sectionLabel("头盔", p.head));
    f.toggle("head", "头盔", { defaultValue: false });
    f.label("chestLabel", sectionLabel("胸甲", p.chest));
    f.toggle("chest", "胸甲", { defaultValue: false });
    f.label("legsLabel", sectionLabel("裤腿", p.legs));
    f.toggle("legs", "裤腿", { defaultValue: false });
    f.label("feetLabel", sectionLabel("靴子", p.feet));
    f.toggle("feet", "靴子", { defaultValue: false });
    f.submitButton("回收");
  }).then((vals) => {
    if (!vals) return;
    const sel: ReclaimSelection = {
      xp: Boolean(vals.xp),
      hotbar: Boolean(vals.hotbar),
      inventory: Boolean(vals.inventory),
      mainhand: Boolean(vals.mainhand),
      offhand: Boolean(vals.offhand),
      head: Boolean(vals.head),
      chest: Boolean(vals.chest),
      legs: Boolean(vals.legs),
      feet: Boolean(vals.feet),
    };
    void system.run(async () => {
      const r = await services.lifecycle.reclaim(viewer, record.botId, sel);
      system.run(() => {
        if (!r.ok) {
          say(`${color.error}回收失败: ${r.reason}`);
          return;
        }
        const parts: string[] = [];
        if (r.items > 0) parts.push(`${color.success}${r.items}${color.info} 件物品`);
        if (r.overflow > 0) parts.push(`${color.warn}${r.overflow}${color.info} 件溢出掉落`);
        if (r.xp > 0) parts.push(`${color.accent}${r.xp} XP${color.info}（Lv.${r.xpLevel}）`);
        say(
          parts.length
            ? `${color.success}已从 ${color.playerName}${record.name}${color.success} 回收: ${parts.join("、")}`
            : `${color.warn}假人 ${color.playerName}${record.name}${color.warn} 背包是空的`
        );
      });
    });
  });
}
