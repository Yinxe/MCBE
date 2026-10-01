// ─── 三叉戟面板 + 投掷物认主 ───
// 投三叉戟：标签格式化在本层（engine 只回原始槽位）；仅主手一把时直接投掷不弹表单。
// 认主扫描：半径内自家投掷物按小半径链式聚集分组，组内邻居密度归一为概率分档。
// ModalForm 深底：认主面板文字只用亮色系 token，禁暗色与粗体。

import { system } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color, ModalFormBuilder, trySendMessage } from "@yinxe/toolkit";
import type { BotRecord } from "../../domain/Record";
import { enchantDisplayName, levelToRoman } from "../../domain/EnchantZh";
import { clusterPoints, decodeItemTag, isFamilyOwned, neighborDensity } from "../../domain/ClaimRules";
import { CLAIM_CLUSTER_RADIUS, CLAIM_GROUP_PREFIX, CLAIM_SCAN_RADIUS } from "../../domain/TridentRules";
import type { ClaimEntry } from "../../engine/ProjectileTracker";
import { projectileTracker } from "../../engine/ProjectileTracker";
import { tridentOps } from "../../engine/TridentOps";
import type { TridentSlot } from "../../engine/TridentOps";
import { ensureUiBotAvailable, uiViewer } from "../Kit";
import { setClaimOperator } from "../ClaimReport";
import { services } from "../../Composition";

// ─── 投三叉戟 ──

function makeTridentLabel(slot: TridentSlot): string {
  const slotTag = slot.isMainhand
    ? `${color.info}[主手]`
    : slot.slotIndex < 9
      ? `${color.info}[热栏${slot.slotIndex + 1}]`
      : `${color.info}[背包${slot.slotIndex + 1}]`;
  const name = slot.item.nameTag;
  const displayName = name ? `${color.playerName}${name}` : `${color.success}三叉戟`;
  const summary = services.panelOps.itemSummary(slot.item);
  const enchStr = summary ? formatEnch(summary) : "";
  const durStr =
    summary && summary.maxDurability !== undefined && summary.damage !== undefined
      ? `(${summary.maxDurability - summary.damage}/${summary.maxDurability})`
      : `${color.muted}(∞)`;
  return `${slotTag} ${displayName} ${enchStr} ${durStr}`;
}

function formatEnch(s: { enchants: { id: string; level: number }[] }): string {
  return s.enchants.map((e) => `${color.darkBlue}${enchantDisplayName(e.id)}${e.level}`).join(" ");
}

function doThrow(player: Player, record: BotRecord, slots: number[], doneMsg: string): void {
  const say = (t: string) => trySendMessage(player, t);
  void system.run(async () => {
    const r = await tridentOps.throwTridents(record.botId, slots);
    if (r.status === "already-throwing") system.run(() => say(`${color.warn}该假人有投掷链正在进行，请稍后再试`));
    else if (r.status === "not-online") system.run(() => say(`${color.error}假人不在线或已死亡`));
    else if (r.thrown === 0)
      // 槽位全空或全部未投出（链在主手中止）——不播完成
      system.run(() =>
        say(`${color.warn}${color.playerName}${record.name}${color.warn} 未投出三叉戟（槽位已空或投掷失败）`)
      );
    else system.run(() => say(doneMsg));
  });
}

export function showTridentSelector(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  if (!ensureUiBotAvailable(say, record)) return;
  const tridents = tridentOps.scanTridents(record.botId);
  if (!tridents) {
    say(`${color.error}无法获取假人实体`);
    return;
  }
  if (tridents.length === 0) {
    say(`${color.error}假人背包中没有三叉戟`);
    return;
  }
  // 快速路径：仅主手有一把 → 直接投掷不弹表单
  if (tridents.length === 1 && tridents[0]!.isMainhand) {
    say(`${color.success}主手已装备三叉戟，直接投掷`);
    doThrow(
      player,
      record,
      [tridents[0]!.slotIndex],
      `${color.success}${color.playerName}${record.name}${color.success} 已投掷三叉戟`
    );
    return;
  }
  void ModalFormBuilder.showQuick(player, `${color.bold}选择要投掷的三叉戟`, (f) => {
    for (const t of tridents) {
      f.toggle(`slot_${t.slotIndex}`, makeTridentLabel(t), { defaultValue: t.isMainhand });
    }
  }).then((vals) => {
    if (!vals) return;
    const chosen = tridents.filter((t) => Boolean(vals[`slot_${t.slotIndex}`])).map((t) => t.slotIndex);
    if (chosen.length === 0) {
      say(`${color.warn}未选择任何三叉戟`);
      return;
    }
    say(`${color.success}准备投掷 ${color.warn}${chosen.length}${color.success} 把三叉戟...`);
    doThrow(player, record, chosen, `${color.success}${color.playerName}${record.name}${color.success} 投掷完成`);
  });
}

// ─── 投掷物认主 ──

const TIER_HIGH = 0.6;
const TIER_MID = 0.3;
const TYPE_ICONS: Record<string, string> = { "minecraft:thrown_trident": "🔱", "minecraft:arrow": "🏹" };

function projectileTypeLabel(typeId: string): string {
  return typeId === "minecraft:thrown_trident" ? "三叉戟" : typeId === "minecraft:arrow" ? "箭" : "投掷物";
}

/** mp:item: tag → "附魔中文+罗马级 (cur/max)"（投掷时快照，读不到按无） */
function itemLabelFromTag(itemTag: string | undefined): string {
  if (!itemTag) return "";
  const d = decodeItemTag(itemTag);
  const ench = d.enchantments.map((e) => `${enchantDisplayName(e.id)}${levelToRoman(e.level)}`).join(" ");
  const dur = d.durability ? `(${d.durability.current}/${d.durability.max})` : "";
  return [ench, dur].filter(Boolean).join(" ");
}

interface ClaimGroup {
  id: string;
  typeId: string;
  entries: { entry: ClaimEntry; probability: number }[];
}

/** 家族名集合 = 主人 playerKey ∪ 主人名下全部假人名 */
function familyNamesOf(record: BotRecord): Set<string> {
  const out = new Set<string>();
  if (record.ownerKey) out.add(record.ownerKey);
  for (const r of services.runtime.records.values()) {
    if (r.ownerKey === record.ownerKey) out.add(r.name);
  }
  return out;
}

function buildClaimGroups(entries: ClaimEntry[]): ClaimGroup[] {
  const byType = new Map<string, ClaimEntry[]>();
  for (const e of entries) {
    const list = byType.get(e.typeId) ?? [];
    list.push(e);
    byType.set(e.typeId, list);
  }
  const groups: ClaimGroup[] = [];
  for (const [typeId, list] of byType) {
    const prefix = CLAIM_GROUP_PREFIX[typeId] ?? "C";
    const points = list.map((e) => ({ id: e.entityId, x: e.pos.x, y: e.pos.y, z: e.pos.z }));
    const clusters = clusterPoints(points, CLAIM_CLUSTER_RADIUS).sort((a, b) => b.length - a.length);
    let seq = 0;
    for (const cluster of clusters) {
      const density = neighborDensity(cluster, CLAIM_CLUSTER_RADIUS);
      const id = `${prefix}${String(++seq).padStart(2, "0")}`;
      const entryById = new Map(list.map((e) => [e.entityId, e]));
      groups.push({
        id,
        typeId,
        entries: cluster.map((p) => ({ entry: entryById.get(p.id)!, probability: density.get(p.id) ?? 0 })),
      });
    }
  }
  return groups.sort((a, b) => b.entries.length - a.entries.length);
}

function entryLabel(botName: string, groupId: string, e: ClaimEntry, probability: number): string {
  const pct = Math.round(probability * 100);
  const probColor = probability >= TIER_HIGH ? color.success : probability >= TIER_MID ? color.warn : color.info;
  const icon = TYPE_ICONS[e.typeId] ?? "🏹";
  const label = itemLabelFromTag(e.itemTag);
  const itemPart = label ? ` ${color.info}${label}` : "";
  const pos = `[${Math.floor(e.pos.x)} ${Math.floor(e.pos.y)} ${Math.floor(e.pos.z)}]`;
  const status =
    e.secondOwner === botName
      ? ` ${color.success}✔已认主`
      : e.secondOwner
        ? ` ${color.warn}⇄覆盖${color.playerName}${e.secondOwner}`
        : "";
  return `${icon} ${color.accent}${groupId}${itemPart} ${color.info}${pos} ${probColor}${pct}%${status}`;
}

export function showTridentClaimUI(player: Player, record: BotRecord): void {
  const say = (t: string) => trySendMessage(player, t);
  if (!ensureUiBotAvailable(say, record)) return;
  if (record.ownerKey === null) {
    say(`${color.error}无主假人无法认主（没有主人体系）`);
    return;
  }
  const scan = projectileTracker.scanOwnProjectiles(record.botId, familyNamesOf(record));
  if (scan.length === 0) {
    say(
      `${color.warn}${color.playerName}${record.name}${color.warn} ${CLAIM_SCAN_RADIUS} 范围内没有可认主的自家投掷物（主人/同主假人投掷的三叉戟或箭）`
    );
    return;
  }
  const groups = buildClaimGroups(scan);
  const total = scan.length;
  void ModalFormBuilder.showQuick(player, `投掷物认主 · ${record.name}`, (f) => {
    f.label(
      "summary",
      `${color.info}主人 ${color.playerName}${record.ownerKey}${color.info} · 共 ${color.accent}${total}${color.info} 个 · ${color.info}${groups.length}${color.info} 个聚集组 · 勾选后认主为第二任（可覆盖）`
    );
    for (const g of groups) {
      f.label(
        `h-${g.id}`,
        `${color.accent}${g.id} ${color.info}${projectileTypeLabel(g.typeId)} × ${color.info}${g.entries.length}`
      );
      for (const item of g.entries) {
        f.toggle(`t${item.entry.entityId}`, entryLabel(record.name, g.id, item.entry, item.probability), {
          defaultValue: false,
          tooltip: "勾选后该假人将成为这件投掷物的第二任主人（覆盖原第二任）",
        });
      }
    }
    f.submitButton("提交");
  }).then((vals) => {
    if (!vals) return;
    const selected: string[] = [];
    for (const g of groups) {
      for (const item of g.entries) {
        if (Boolean(vals[`t${item.entry.entityId}`])) selected.push(item.entry.entityId);
      }
    }
    if (selected.length === 0) {
      say(`${color.warn}未选择任何投掷物`);
      return;
    }
    // 操作者已有面板直接反馈，认主汇报不再发给他
    setClaimOperator(player.name);
    try {
      const claimed = projectileTracker.claim(record.botId, selected);
      const failed = selected.length - claimed;
      say(
        `${color.success}已认主 ${color.info}${claimed}${color.success}/${color.info}${selected.length}${color.success} 件投掷物 → ${color.playerName}${record.name}`
      );
      if (failed > 0) say(`${color.warn}（${failed} 件认主失败）`);
    } finally {
      setClaimOperator("");
    }
  });
}
