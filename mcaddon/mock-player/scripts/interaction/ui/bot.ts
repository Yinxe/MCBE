// ─── 统一假人操作面板（v3） ──────────────────────────
//
// ⚠️ UI 事件驱动：按钮点击只发布 panelAction 领域事件（负载 操作者/假人/动作），
//    各功能模块独立订阅执行——本文件不 import 任何业务动作函数。
//    「返回列表」是 UI 内部导航，保持内联回调（不事件化）。

import { Player, world, EquipmentSlot, type ItemStack, EntityEquippableComponent } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder } from "@yinxe/toolkit";

import { BotRecord } from "../../rules/Types";
import { BOT_TAG, getTagDef } from "../../rules/tags/BotTags";
import { BotUiEvent, type BotPanelAction } from "../../events/UiEvents";
import { formatPos, formatEnchantments, formatDurability } from "./format";
import { formatDimensionId } from "../../rules/format/Format";
import { botRegistry, botStore } from "../../bootstrap/context";
import { canManageBot, autoClaim, isAdmin } from "../commands/auth";
import { resolveUiBotRecord } from "./helpers";
import { visibleRecords } from "../../service/BotVisibility";
import { ownerLabel } from "./ownerLabel";
import { inventoryContainerOf } from "../../features/basic/items/ItemComponentRead";

// ─── 工具 ──────────────────────────────────────────────

function getWorkModeLabel(mode: string): string {
  const map: Record<string, string> = {
    none: "空闲",
    wander: "闲逛",
    mine: "挖掘",
    place: "放置",
    attack: "攻击",
    raid: "劫掠",
    fishing: "钓鱼",
    follow: "跟随",
  };
  return map[mode] ?? mode;
}

function getStatusIcon(record: BotRecord): string {
  if (record.death) return style("[死亡]", color.error);
  if (!record.online) return style("[离线]", color.warn);
  // 在线时显示工作模式，不再显示固定"在线"
  const label = getWorkModeLabel(record.workMode);
  return style(`[${label}]`, record.workMode === "none" ? color.warn : color.success);
}

function getPosSummary(record: BotRecord): string {
  try {
    if ((record as any).lastPoint) {
      const p: any = (record as any).lastPoint;
      try { return `${formatPos(p.location)} ${color.gold}${formatDimensionId(p.dimension)}`; } catch { return `${color.muted}无法统计`; }
    }
    if (record.death && (record as any).deathPoint) {
      const p: any = (record as any).deathPoint;
      try { return `${formatPos(p.location)} ${color.gold}${formatDimensionId(p.dimension)} ${style("(死亡点)", color.gold)}`; } catch { return `${color.muted}无法统计`; }
    }
    const rp: any = (record as any).respawnPoint;
    if (!rp || !rp.location || !rp.dimension) return `${color.muted}无法统计`;
    return `${formatPos(rp.location)} ${color.gold}${formatDimensionId(rp.dimension)} ${style("(重生点)", color.gold)}`;
  } catch {
    return `${color.muted}无法统计`;
  }
}

// ─── 富信息格式化 ──────────────────────────────────────

function formatLiveItem(item: ItemStack | undefined): string {
  if (!item) return `${color.muted}空`;
  try {
    const name = item.nameTag ? `${color.playerName}${item.nameTag}§r` : `${color.info}${item.typeId.replace("minecraft:", "")}`;
    const amt = item.amount > 1 ? ` ${color.muted}x${item.amount}` : "";
    let ench = "";
    try { ench = formatEnchantments(item); } catch {}
    let dur = "";
    try { dur = formatDurability(item); } catch {}
    const enchStr = ench ? ` ${ench}` : "";
    const durStr = dur ? ` ${dur}` : "";
    return `${name}${amt}${enchStr}${durStr}`;
  } catch {
    return `${color.info}${item.typeId} ${color.muted}x${item.amount}`;
  }
}

function formatStoredItem(item: any): string {
  if (!item) return `${color.muted}空`;
  try {
    return formatLiveItem(item as ItemStack);
  } catch {
    return `${color.info}${item.typeId ?? "unknown"} ${color.muted}x${item.amount ?? 1}`;
  }
}

function getMainhandSummary(record: BotRecord): string {
  if (record.online && record.entityId) {
    try {
      const ent = world.getEntity(record.entityId) as Player | undefined;
      if (ent) {
        const equip = ent.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
        const main = equip?.getEquipment(EquipmentSlot.Mainhand);
        if (main) return formatLiveItem(main);
        try {
          const container = inventoryContainerOf(ent as any);
          if (container) {
            const sel = (ent as any).selectedSlotIndex ?? 0;
            const cItem = container.getItem(sel);
            if (cItem) return `${formatLiveItem(cItem)} ${color.muted}[槽${sel}]`;
          }
        } catch {}
      }
    } catch {}
  }
  try {
    const inv = botStore.loadInventory(record.name);
    if (inv) {
      for (let i = 0; i < inv.length; i++) {
        const it = inv[i];
        if (it) return `${formatStoredItem(it)} ${color.muted}[背包槽${i}] ${color.muted}(离线缓存)`;
      }
    }
    const storedEquip = botStore.loadEquipment(record.name) as Record<string, any> | undefined;
    if (storedEquip) {
      const off = storedEquip["offhand"];
      if (off) return `${color.muted}主手空 §7| 副手: ${formatStoredItem(off)} ${color.muted}(离线)`;
    }
  } catch {}
  return `${color.muted}空 ${record.online ? "" : color.muted + "(离线)"}`;
}

function getArmorSummary(record: BotRecord): string {
  const parts: string[] = [];
  const slotOrder: Array<{ key: string; label: string; slot: EquipmentSlot }> = [
    { key: "head", label: "头", slot: EquipmentSlot.Head },
    { key: "chest", label: "胸", slot: EquipmentSlot.Chest },
    { key: "legs", label: "腿", slot: EquipmentSlot.Legs },
    { key: "feet", label: "靴", slot: EquipmentSlot.Feet },
    { key: "offhand", label: "副手", slot: EquipmentSlot.Offhand },
  ];
  if (record.online && record.entityId) {
    try {
      const ent = world.getEntity(record.entityId) as Player | undefined;
      if (ent) {
        const equip = ent.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
        if (equip) {
          for (const s of slotOrder) {
            const it = equip.getEquipment(s.slot);
            parts.push(`${s.label}:${it ? formatLiveItem(it) : color.muted + "空"}`);
          }
          return parts.join(` ${color.muted}| `);
        }
      }
    } catch {}
  }
  try {
    const stored = botStore.loadEquipment(record.name) as Record<string, any> | undefined;
    if (stored) {
      for (const s of slotOrder) {
        const it = stored[s.key];
        parts.push(`${s.label}:${it ? formatStoredItem(it) : color.muted + "空"}`);
      }
      if (parts.length) return parts.join(` ${color.muted}| `) + ` ${color.muted}(离线)`;
    }
  } catch {}
  return `${color.muted}无装备信息`;
}

function getInventorySummary(record: BotRecord): string {
  if (record.online && record.entityId) {
    try {
      const ent = world.getEntity(record.entityId) as Player | undefined;
      if (ent) {
        const container = inventoryContainerOf(ent as any);
        if (container) {
          let filled = 0;
          let total = 0;
          for (let i = 0; i < container.size; i++) {
            const it = container.getItem(i);
            if (it) { filled++; total += it.amount; }
          }
          const hotbar = (() => {
            let c = 0;
            for (let i = 0; i < 9; i++) if (container.getItem(i)) c++;
            return c;
          })();
          return `${color.info}${filled}/36 ${color.muted}格 §7| ${color.info}${total} ${color.muted}件 §7| 热栏 ${color.info}${hotbar}/9`;
        }
      }
    } catch {}
  }
  try {
    const inv = botStore.loadInventory(record.name);
    if (inv) {
      let filled = 0;
      let total = 0;
      for (const it of inv) if (it) { filled++; total += (it as any).amount ?? 1; }
      return `${color.info}${filled}/36 ${color.muted}格 §7| ${color.info}${total} ${color.muted}件 ${color.muted}(离线缓存)`;
    }
  } catch {}
  return `${color.muted}无背包信息`;
}

function getEffectSummary(record: BotRecord): string {
  const eff = record.effects;
  if (!eff || eff.length === 0) return `${color.muted}无`;
  return eff.map(e => `${color.info}${e.id.replace("minecraft:", "")} ${color.muted}${e.amplifier + 1}级 ${color.muted}${e.duration}tick`).join(` ${color.muted}| `);
}

function buildBotPanelBody(record: BotRecord): string {
  // 仅保留 4 行核心摘要，详情请点「查看数据」
  // 任意单行统计失败仅显示“无法统计”，不影响其余行与表单正常弹出
  const safe = (fn: () => string, fallback = `${color.muted}无法统计`): string => {
    try { const v = fn(); return v ?? fallback; } catch { return fallback; }
  };
  const line1 = safe(() => {
    const workLabel = getWorkModeLabel(record.workMode ?? "none");
    const workColor = record.workMode === "none" ? color.muted : color.success;
    const deathStr = record.death ? `${color.error}死亡` : `${color.success}存活`;
    const onlineStr = record.online ? `${color.success}在线` : `${color.warn}离线`;
    const sneakStr = record.isSneaking ? `${color.success}潜行` : `${color.muted}正常`;
    const woodcutExtra = record.workMode === "woodcut" && (record as any).woodcutMode ? `${color.muted}(${(record as any).woodcutMode})` : "";
    return `${deathStr} ${color.muted}| ${onlineStr} ${color.muted}| ${color.accent}模式:${workColor}${workLabel}${woodcutExtra} ${color.muted}| ${sneakStr}`;
  });
  const line2 = safe(() => {
    const cur = (record as any).lastPoint ?? (record.death && (record as any).deathPoint ? (record as any).deathPoint : null);
    let curPos: string;
    try {
      curPos = cur ? `${formatPos(cur.location)} ${color.gold}${formatDimensionId(cur.dimension)}` : `${color.muted}无`;
    } catch { curPos = `${color.muted}无法统计`; }
    const curTag = (record as any).lastPoint ? "" : record.death && (record as any).deathPoint ? ` ${color.error}(死亡点)` : ` ${color.muted}(重生待机)`;
    let rpPos: string;
    try {
      const rp = (record as any).respawnPoint;
      if (!rp || !rp.location || !rp.dimension) throw new Error("respawn missing");
      rpPos = `${formatPos(rp.location)} ${color.gold}${formatDimensionId(rp.dimension)}`;
    } catch { rpPos = `${color.muted}无法统计`; }
    let line = `${color.accent}位置:${color.muted} ${curPos}${curTag} ${color.muted}→ 重生:${color.muted} ${rpPos}`;
    try {
      if ((record as any).deathPoint && !record.death) {
        const dp = (record as any).deathPoint;
        line += ` ${color.muted}| 亡:${formatPos(dp.location)}`;
      }
    } catch {}
    return line;
  });
  const line3 = safe(() => {
    const mainhandShort = (() => {
      const s = safe(() => getMainhandSummary(record), `${color.muted}无法统计`);
      const idx = s.indexOf(" §");
      if (idx > 0 && s.includes("§9")) return s.slice(0, idx);
      return s;
    })();
    const invRaw = safe(() => getInventorySummary(record), `${color.muted}无法统计`);
    return `${color.accent}持有:${color.muted} 主手 ${mainhandShort} ${color.muted}| 背包 ${invRaw}`;
  });
  const line4 = safe(() => {
    const owner = (record as any).ownerName ? `${color.playerName}${(record as any).ownerName}` : `${color.muted}无主`;
    let expShort: string;
    try {
      const exp = (record as any).experience;
      if (!exp || typeof exp.level !== "number" || typeof exp.totalXp !== "number") throw new Error("exp missing");
      expShort = `Lv.${exp.level} ${color.muted}(${exp.totalXp}XP)`;
    } catch { expShort = `${color.muted}无法统计`; }
    let tagShort: string;
    try {
      const tags = (record as any).tags;
      if (!Array.isArray(tags)) throw new Error("tags missing");
      const tagLabels = tags.filter((t: string) => t !== BOT_TAG && t !== "mockplayer:tag:idle").map((t: string) => { const d = getTagDef(t); return d ? d.label : t.replace("mockplayer:tag:", ""); });
      tagShort = tagLabels.length ? tagLabels.slice(0, 2).join(`${color.muted},`) + (tagLabels.length > 2 ? `${color.muted}…` : "") : `${color.muted}无`;
    } catch { tagShort = `${color.muted}无法统计`; }
    const spawnShort = ((record as any).spawnMode ?? "normal") === "chunkload" ? `${color.gold}强加载` : `${color.muted}普通`;
    return `${color.accent}归属:${owner} ${color.muted}| 经验:${color.playerName}${expShort} ${color.muted}| 标签:${tagShort} ${color.muted}| 生成:${spawnShort}`;
  });
  return [line1, line2, line3, line4].join("\n");
}

// ─── 统一假人操作面板（v3，showBotPanel 主菜单） ──────

export function showBotPanel(player: Player, botName: string, onBack?: () => void): void {
  const record = resolveUiBotRecord(player, botName);
  if (!record) return;

  // ── 管理权限：只有主人或管理员可以操作假人 ──
  if (!canManageBot(player, record)) {
    // 无主假人（旧版升级数据）→ 自动认领：首次打开菜单即成为主人（静默添加主人）
    if (autoClaim(player, record)) {
      player.sendMessage(`${color.success}已自动认领假人 ${color.playerName}${botName}${color.success}（旧版数据，首次操作生效）`);
    } else {
      player.sendMessage(`${color.error}假人 ${color.playerName}${botName}${color.error} 只允许主人或管理员操作`);
      return;
    }
  }

  // 发布 panelAction 领域事件（订阅方：各功能模块按 action 过滤执行）
  const trigger = (action: BotPanelAction): void => {
    BotUiEvent.panelAction.trigger({ playerId: player.id, botName, action });
  };

  const form = new ActionFormBuilder()
      .title(`${color.bold}${botName} ${getStatusIcon(record)}`)
      .body(buildBotPanelBody(record))
      // ── 上线/下线（置顶，统一安全：safeOnline/safeOffline 已内置排队+冷却+模拟4，仅一键） ──
      .buttonWithIcon(record.online ? style("安全下线", color.darkGreen) : style("安全上线", color.darkGreen), "textures/ui/mockplayer/toggle_online", () => trigger("toggleOnline"));
    form
      // ── 传送 ──
      .buttonWithIcon(style("传送过去", color.darkBlue), "textures/ui/mockplayer/teleport", () => trigger("tpToBot"))
      // ── 同步/操作 ──
      .buttonWithIcon(style("同步姿态", color.darkBlue), "textures/ui/mockplayer/sync_pose", () => trigger("syncPose"))
      .buttonWithIcon(style("选择主手", color.darkBlue), "textures/ui/mockplayer/select_mainhand", () => trigger("selectMainhand"))
      // ── 互换/回收/丢弃 ──
      .buttonWithIcon(style("物品互换", color.darkBlue), "textures/ui/mockplayer/swap_items", () => trigger("swap"))
      .buttonWithIcon(style("回收资源", color.darkBlue), "textures/ui/mockplayer/reclaim", () => trigger("reclaim"))
      .buttonWithIcon(style("丢弃物品", color.darkRed), "textures/ui/mockplayer/discard", () => trigger("discard"))
      // ── 行为/使用 ──
      .buttonWithIcon(style("行为菜单", color.darkGreen), "textures/ui/mockplayer/inventory", () => trigger("openBehavior"))
      .buttonWithIcon(style("使用物品", color.darkGreen), "textures/ui/mockplayer/use_item", () => trigger("useItem"))
      .buttonWithIcon(style("设置重生", color.darkBlue), "textures/ui/mockplayer/set_spawn", () => trigger("updateSpawn"))
      .buttonWithIcon(style("修改名字", color.darkBlue), "textures/ui/mockplayer/rename", () => trigger("rename"))
      // ── 战斗/工具 ──
      .buttonWithIcon(style("投三叉戟", color.darkBlue), "textures/ui/mockplayer/throw_trident", () => trigger("throwTrident"))
      .buttonWithIcon(style("投掷物认主", color.darkBlue), "textures/ui/mockplayer/throw_trident", () => trigger("claimTrident"))
      .buttonWithIcon(style("查看数据", color.darkBlue), "textures/ui/mockplayer/view_data", () => trigger("viewData"))
      // ── 危险 ──
      .buttonWithIcon(style("击杀假人", color.darkRed), "textures/ui/mockplayer/kill_bot", () => trigger("kill"))
      .buttonWithIcon(style("删除假人", color.darkRed), "textures/ui/mockplayer/delete_bot", () => trigger("delete"))
      // ── UI 内部导航（不事件化） ──
      .buttonWithIcon(style("返回列表", color.darkBlue), "textures/ui/mockplayer/back", () => { if (onBack) onBack(); })
      .show(player);
}

// ─── 假人列表 ──────────────────────────────────────────

/**
 * 展示模拟玩家列表（可见性过滤：管理员看全部；普通玩家看自己的 + 无主的）
 * @param onMainMenu 点击「返回」时调用的回调（来自 menu.ts 的 showMainMenu）
 */
export function showBotList(player: Player, onMainMenu?: () => void): void {
  const records = visibleRecords(botRegistry.all(), player.name, isAdmin(player));
  if (records.length === 0) {
    player.sendMessage(`${color.warn}暂无可见的模拟玩家，请先创建`);
    void 0;
    return;
  }

  const sorted = [...records].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const builder = new ActionFormBuilder()
    .title(`${color.bold}模拟玩家列表`)
    .body(`${color.accent}共 ${color.playerName}${records.length} ${color.accent}个`);

  for (const record of sorted) {
    const dim = record.lastPoint
      ? formatDimensionId(record.lastPoint.dimension)
      : record.deathPoint
        ? formatDimensionId(record.deathPoint.dimension)
        : formatDimensionId(record.respawnPoint.dimension);
    // 主人/无主标签：管理员看全览需归属信息；普通玩家看无主假人的 [无主] tag
    const owner = ownerLabel(record, isAdmin(player));
    const icon = record.death ? "textures/ui/mockplayer/kill_bot" : record.online ? "textures/ui/mockplayer/toggle_online" : "textures/ui/mockplayer/bot_list";
      builder.buttonWithIcon(
      `${getStatusIcon(record)} ${color.black}${record.name} ${color.black}${dim}${owner ? ` ${owner}` : ""}`,
        icon,
      () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu)),
    );
  }

  builder.buttonWithIcon(style("← 返回", color.darkBlue), "textures/ui/mockplayer/back", () => { if (onMainMenu) onMainMenu(); }).show(player);
}
