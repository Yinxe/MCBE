// ─── UI 公共缝（面板守卫与渲染格式唯一口径） ────────────────────────
// 颜色 token 与消息文案为玩家可读性既定口径；ModalForm 深底禁暗色 token；
// 工作模式中文名一律由 Catalog 派生，勿另立手写表。

import type { Player } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import type { Viewer } from "../domain/Permissions";
import { canView, canManage } from "../domain/Permissions";
import type { BotRecord } from "../domain/Record";
import { playerKey } from "../domain/Identity";
import { modeSpec } from "../domain/Catalog";
import { stateFlags } from "../domain/State";
import { enchantDisplayName } from "../domain/EnchantZh";
import { farLookPoint } from "../domain/Angle";
import type { ItemSummary } from "../engine/PanelOps";
import type { OpResult } from "../engine/EntityOps";
import { gaze } from "../engine/Gaze";
import { services } from "../Composition";

// ─── 守卫缝 ──

/** 传送功能统一提示（命令与面板共用同一句；改文案只改这里） */
export const TELEPORT_DISABLED_NOTICE = "传送功能已被管理员关闭";

/**
 * 传送功能是否开放（全局配置的管理员开关）。
 * @returns 开放返回 true
 */
export function teleportEnabled(): boolean {
  return services.runtime.config.teleportEnabled;
}

/** 面板侧 Viewer（与命令侧同构） */
export function uiViewer(player: Player): Viewer {
  return { key: playerKey(player.name), isOp: player.playerPermissionLevel >= 2 };
}

/** 在线/死亡实时判定：会话态优先，记录 deathMark 兜底 */
export function botStatus(record: BotRecord): { online: boolean; death: boolean } {
  const st = services.runtime.stateOf(record.botId);
  const flags = st === null ? { online: false, death: false } : stateFlags(st);
  return { online: flags.online, death: flags.death || record.deathMark };
}

/** 需在线操作前置；不在线或已死亡时已回发提示 */
export function ensureUiBotAvailable(say: (t: string) => void, record: BotRecord): boolean {
  const st = botStatus(record);
  if (!st.online || st.death) {
    say(`${color.error}假人不在线或已死亡`);
    return false;
  }
  return true;
}

/** 面板记录解析；不存在时已回发提示并返回 null */
export function resolveUiBotRecord(say: (t: string) => void, rawName: string): BotRecord | null {
  const botId = services.runtime.findBotIdByName(rawName);
  const record = botId === undefined ? undefined : services.runtime.record(botId);
  if (!record) {
    say(`${color.error}模拟玩家 ${color.playerName}${rawName}${color.error} 已不存在`);
    return null;
  }
  return record;
}

/** 面板管理守卫：有权直通，无主自动认领，否则回发拒绝 */
export function guardUiManage(say: (t: string) => void, viewer: Viewer, record: BotRecord): boolean {
  const { runtime, lifecycle } = services;
  if (canManage(viewer, record, runtime.config)) return true;
  if (record.ownerKey === null && lifecycle.claimIfOwnerless(viewer, record.botId)) {
    say(`${color.success}已自动认领假人 ${color.playerName}${record.name}${color.success}（旧版数据，首次操作生效）`);
    return true;
  }
  say(`${color.error}假人 ${color.playerName}${record.name}${color.error} 只允许主人或管理员操作`);
  return false;
}

// ─── 面板共用动作 ──

/**
 * 同步姿态：假人→查看者位置+朝向+潜行，家点随同步更新（主菜单按钮与行为菜单开关共用口径）。
 * 前置：假人在线未死亡（调用方自检 ensureUiBotAvailable）。
 * @param player 姿态来源的真实玩家
 * @param botId 目标假人
 * @returns ok=false 携带传送失败原因
 */
export function performSyncPose(player: Player, botId: number): OpResult {
  const { lifecycle, ops } = services;
  const rot = player.getRotation();
  // 先解除姿态保护与视线校正再传送：保护标志会挡下新朝向落库
  gaze.releasePose(botId);
  const r = ops.teleportTo(botId, player.location, player.dimension.id, rot.y, rot.x);
  if (!r.ok) return r;
  // 朝向维持须用持续注视：一次性设置约 2 秒后被引擎回正
  gaze.forceLook(botId, farLookPoint(player.getHeadLocation(), { x: rot.x, y: rot.y }));
  lifecycle.setSwitch(botId, "sneaking", player.isSneaking);
  lifecycle.setHomeHere(botId);
  return { ok: true };
}

// ─── 列表/行渲染 ──

/** 可见假人列表（canView 过滤；在线优先，再按名字序） */
export function visibleRecords(viewer: Viewer): BotRecord[] {
  const config = services.runtime.config;
  return [...services.runtime.records.values()]
    .filter((r) => canView(viewer, r, config))
    .sort((a, b) => {
      const sa = botStatus(a).online ? 0 : 1;
      const sb = botStatus(b).online ? 0 : 1;
      return sa !== sb ? sa - sb : a.name.localeCompare(b.name);
    });
}

/** 状态徽标：死亡红/离线黄/在线显模式名（none 黄，其余绿） */
export function getStatusIcon(record: BotRecord): string {
  const st = botStatus(record);
  if (st.death) return style("[死亡]", color.error);
  if (!st.online) return style("[离线]", color.warn);
  const spec = modeSpec(record.workMode);
  return style(`[${spec.label}]`, record.workMode === "none" ? color.warn : color.success);
}

/** 主人列：管理员显示主人，普通玩家仅无主时标出 */
export function ownerLabel(record: BotRecord, admin: boolean): string {
  if (record.ownerKey === null) return `${color.muted}[${color.warn}无主${color.muted}]`;
  if (admin) return `${color.accent}主人:${color.playerName}${record.ownerKey}`;
  return "";
}

// ─── 位置渲染 ──

/** 位置串（取整三分量） */
export function formatPos(p: { x: number; y: number; z: number }): string {
  return `${color.muted}[${color.info}${Math.floor(p.x)} ${color.info}${Math.floor(p.y)} ${color.info}${Math.floor(p.z)}${color.muted}]`;
}

/** 面板坐标行：整数位+维度（+离线家点标注） */
export function formatPosLine(p: { x: number; y: number; z: number }, dimId: string, homeFallback: boolean): string {
  return `${color.playerName}${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)} ${color.darkGray}${dimId}${homeFallback ? ` ${color.muted}(家点)` : ""}`;
}

/** 维度中文名；未知 id 原样返回 */
export function formatDimension(id: string): string {
  if (id === "minecraft:overworld") return "主世界";
  if (id === "minecraft:nether") return "下界";
  if (id === "minecraft:the_end") return "末地";
  return id;
}

// ─── 物品渲染 ──

function stripType(typeId: string): string {
  return typeId.replace("minecraft:", "");
}

/** 物品显示名：nameTag 优先，否则去前缀类型 id */
export function itemDisplayName(s: ItemSummary): string {
  return s.nameTag ? `${color.playerName}${s.nameTag}` : `${color.info}${stripType(s.typeId)}`;
}

/** 附魔串：中文名+阿拉伯数字等级，深蓝 */
export function formatEnchantments(s: ItemSummary): string {
  if (s.enchants.length === 0) return "";
  return s.enchants.map((e) => `${color.darkBlue}${enchantDisplayName(e.id)}${e.level}`).join(" ");
}

/** 耐久串：>50% 原色、>20% 灰、更低红 */
export function formatDurability(s: ItemSummary): string {
  if (s.maxDurability === undefined || s.damage === undefined) return "";
  const cur = s.maxDurability - s.damage;
  const pct = (cur / s.maxDurability) * 100;
  const code = pct > 50 ? "" : pct > 20 ? color.darkGray : color.darkRed;
  return `${code}(${cur}/${s.maxDurability})`;
}

/** 预览行物品：附魔前缀+名+数量+耐久 */
export function formatItemPreview(s: ItemSummary): string {
  const name = s.nameTag || stripType(s.typeId);
  const amt = s.amount > 1 ? `x${s.amount}` : "";
  const dur =
    s.maxDurability !== undefined && s.damage !== undefined
      ? ` [${s.maxDurability - s.damage}/${s.maxDurability}]`
      : "";
  const ench =
    s.enchants.length > 0 ? `§9${s.enchants.map((e) => `${enchantDisplayName(e.id)}${e.level}`).join(" ")}` : "";
  return `${ench}${name}${amt}${dur}`;
}

/** 槽位标签：热栏/背包自 1 起 */
export function slotLabel(i: number): string {
  return i < 9 ? `热栏${i + 1}` : `背包${i + 1}`;
}

/** 背包摘要：前 3 种 name×count，超出显示"还有N种" */
export function invSummary(inv: (ItemSummary | null)[]): { filled: number; kinds: number; summary: string } {
  const items = inv.filter((s): s is ItemSummary => s !== null);
  const counts = new Map<string, number>();
  for (const s of items) counts.set(s.typeId, (counts.get(s.typeId) ?? 0) + s.amount);
  const kinds = counts.size;
  const parts: string[] = [];
  for (const [type, count] of counts) {
    if (parts.length >= 3) break;
    parts.push(`${stripType(type)}×${count}`);
  }
  const summary = kinds === 0 ? "空" : parts.join(" ") + (kinds > 3 ? ` 还有${kinds - 3}种` : "");
  return { filled: items.length, kinds, summary };
}
