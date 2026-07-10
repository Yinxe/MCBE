// ─── 统一假人操作面板（单菜单） ──────────────────────────
// 合并原 showOperationPanel + showMoreActions 为单一菜单
// YPHERE(扭头)已移除，TPA 置后

import { Player, system, world } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BotRecord } from "../features/core/types";
import { TAG_CONTROL, BOT_TAG, getTagDef } from "../features/core/tags";
import { formatPos, formatDimensionId, getPlayerLookTarget, serializeContainer } from "../features/core/utils";
import { botRegistry, saveBotRecord, saveBotInventory } from "../features/core/persistence";
import {
  tpBotToPlayer,
  tpPlayerToBot,
  killBot,
  toggleControl,
  setSneaking,
  swapMainhandWithBot,
  swapOffhandWithBot,
  swapEquipmentWithBot,
  unequipBotAll,
  reclaimBot,
} from "../features/index";
import { saveBotEquipState } from "../features/equip";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";
import { showMoveForm, confirmDelete } from "./move";
import { showTagManagement } from "./tags";
import { sendData } from "../commands/data";

// ─── 工具 ──────────────────────────────────────────────

function getStatusIcon(record: BotRecord): string {
  if (record.death) return "§4[死亡]";
  if (record.online) return "§a[在线]";
  return "§7[离线]";
}

function getPosSummary(record: BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} §8${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} §8${formatDimensionId(record.deathPoint.dimension)} §7(死亡点)`;
  }
  return `${formatPos(record.respawnPoint.location)} §8${formatDimensionId(record.respawnPoint.dimension)} §7(重生点)`;
}

function resolveBotEntity(record: BotRecord): Player | undefined {
  if (!record.entityId) return undefined;
  const entity = world.getEntity(record.entityId);
  return entity?.hasTag(BOT_TAG) ? (entity as Player) : undefined;
}

/** 检查假人是否可操作（在线且未死亡） */
function isActive(record: BotRecord): boolean {
  return record.online && !record.death;
}

/** 检查假人是否可交互（在线且未死亡，可定位实体） */
function requireActive(player: Player, botName: string, fn: (r: BotRecord) => void): void {
  const r = botRegistry.get(botName);
  if (!r) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已不存在`); return; }
  if (!r.online || r.death) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  fn(r);
}

/** 获取假人实体后代执行 */
function equip(player: Player, botName: string, fn: (p: Player, b: Player) => void): void {
  const r = botRegistry.get(botName);
  if (!r || !r.online || r.death) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  const bot = resolveBotEntity(r);
  if (!bot) { player.sendMessage("§c无法获取假人实体"); return; }
  system.run(() => { try { fn(player, bot); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
}

// ─── 统一假人操作面板 ────────────────────────────────

export function showBotPanel(player: Player, botName: string, onBack?: () => void): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`); return; }

  const tagLabels = record.tags.filter(t => t !== BOT_TAG).map(t => { const d = getTagDef(t); return d ? d.label : t; });
  const tagStr = tagLabels.length > 0 ? `\n§7标签: §b${tagLabels.join(" §7| §b")}` : "";
  const expStr = record.experience ? `\n§7经验: §bLv.${record.experience.level} §7(${record.experience.totalXp} XP)` : "";

  const hasControl = record.tags.includes(TAG_CONTROL.value);

  new ActionFormBuilder()
    .title(`§l${botName} ${getStatusIcon(record)}`)
    .body(`${getPosSummary(record)}${tagStr}${expStr}`)
    // ── 移动 ──
    .button("§6传送到身边", () => requireActive(player, botName, (r) => {
      system.run(() => { try { tpBotToPlayer(r, player); player.sendMessage(`§a已将 §e${botName}§a 传送到身边`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    .button("§6移动至坐标", () => showMoveForm(player, botName))
    .button("§6同步传送（并同步姿态）", () => requireActive(player, botName, (r) => {
      system.run(() => { try { tpBotToPlayer(r, player); player.sendMessage(`§a已将 §e${botName}§a 同步传送`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    // ── 物品交换 ──
    .button("§e互换主手", () => equip(player, botName, (p, b) => { swapMainhandWithBot(p, b); player.sendMessage(`§a已与 §e${botName}§a 交换主手`); }))
    .button("§e互换副手", () => equip(player, botName, (p, b) => { swapOffhandWithBot(p, b); player.sendMessage(`§a已与 §e${botName}§a 交换副手`); }))
    .button("§e互换装备", () => equip(player, botName, (p, b) => { swapEquipmentWithBot(p, b); saveBotEquipState(b, botRegistry.get(botName)!); player.sendMessage(`§a已与 §e${botName}§a 交换装备`); }))
    .button("§5互换背包", () => requireActive(player, botName, (_) => doSwapInventory(player, botName)))
    .button("§e一键卸甲", () => equip(player, botName, (p, b) => { unequipBotAll(p, b); saveBotEquipState(b, botRegistry.get(botName)!); player.sendMessage(`§a已将 §e${botName}§a 一键卸甲`); }))
    // ── 状态 ──
    .button(record.online ? "§b上下线 §a[在线]" : "§7上下线 §7[离线]", () => toggleOnline(player, botName))
    .button("§b回收全部", () => doReclaim(player, botName))
    .button(record.isSneaking ? "§b潜行 §a[开]" : "§b潜行 §7[关]", () => requireActive(player, botName, (r) => {
      setSneaking(r, !r.isSneaking);
      player.sendMessage(r.isSneaking ? `§a§e${botName}§a 已潜行` : `§a§e${botName}§a 已站起`);
    }))
    .button(hasControl ? "§b控制模式 §a[开]" : "§7控制模式 §c[关]", () => requireActive(player, botName, (r) => {
      toggleControl(r, player);
      player.sendMessage(r.tags.includes(TAG_CONTROL.value) ? `§a已开启 §e${botName}§a 控制模式` : `§a已关闭 §e${botName}§a 控制模式`);
    }))
    // ── 设置 ──
    .button("§d标签管理", () => showTagManagement(player, botName))
    .button("§a重生点", () => updateSpawn(player, botName))
    .button("§e改名", () => doRename(player, botName))
    .button("§d查看数据", () => { const r = botRegistry.get(botName); if (r) sendData(player, r); })
    // ── 非常用 / 危险 ──
    .button("§8TPA — 传送到假人", () => requireActive(player, botName, (r) => {
      system.run(() => { try { tpPlayerToBot(player, r); player.sendMessage(`§a已传送到 §e${botName}§a 身边`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    .button("§4杀死", () => requireActive(player, botName, (r) => {
      system.run(() => { try { killBot(r); player.sendMessage(`§a已杀死 §e${botName}`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    .button("§c删除", () => confirmDelete(player, botName))
    .button("§7← 返回列表", () => { if (onBack) onBack(); })
    .show(player);
}

// ─── 假人列表 ──────────────────────────────────────────

/**
 * 展示所有模拟玩家列表
 * @param onMainMenu 点击「返回」时调用的回调（来自 menu.ts 的 showMainMenu）
 */
export function showBotList(player: Player, onMainMenu?: () => void): void {
  const records = Array.from(botRegistry.values());
  if (records.length === 0) {
    player.sendMessage("§e暂无模拟玩家，请先创建");
    return;
  }

  const sorted = [...records].sort((a, b) => {
    const orderA = a.death ? 1 : a.online ? 2 : 0;
    const orderB = b.death ? 1 : b.online ? 2 : 0;
    return orderA - orderB;
  });

  const builder = new ActionFormBuilder()
    .title("§l模拟玩家列表")
    .body(`§7共 §b${records.length} §7个`);

  for (const record of sorted) {
    const dim = record.lastPoint
      ? formatDimensionId(record.lastPoint.dimension)
      : record.deathPoint
        ? formatDimensionId(record.deathPoint.dimension)
        : formatDimensionId(record.respawnPoint.dimension);
    builder.button(`${getStatusIcon(record)} §e${record.name} §7${dim}`, () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu)));
  }

  builder.button("§7← 返回", () => { if (onMainMenu) onMainMenu(); }).show(player);
}

// ─── 操作实现 ──────────────────────────────────────────

/** 互换背包：与玩家完全交换背包内容+立即保存 */
function doSwapInventory(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r || !isActive(r)) { player.sendMessage("§c假人不在线或已死亡"); return; }
  const bot = resolveBotEntity(r);
  if (!bot) { player.sendMessage("§c无法获取假人实体"); return; }

  system.run(() => {
    try {
      const pInv = player.getComponent("inventory") as any;
      const bInv = bot.getComponent("inventory") as any;
      if (!pInv?.container || !bInv?.container) { player.sendMessage("§c无法获取背包容器"); return; }

      const size = Math.min(pInv.container.size, bInv.container.size);
      // 读取双方背包
      const playerItems: any[] = [];
      const botItems: any[] = [];
      for (let i = 9; i < size; i++) {
        playerItems.push(pInv.container.getItem(i));
        botItems.push(bInv.container.getItem(i));
      }
      // 写入（先清空假人再写入玩家物品，避免冲突）
      for (let i = 9; i < size; i++) {
        bInv.container.setItem(i, playerItems[i - 9] ?? undefined);
        pInv.container.setItem(i, botItems[i - 9] ?? undefined);
      }
      saveBotInventory(r.name, serializeContainer(bInv.container));
      player.sendMessage(`§a已与 §e${botName}§a 互换背包`);
    } catch (e: any) { player.sendMessage(`§c互换背包失败: ${e.message}`); }
  });
}

/** 改名 */
function doRename(player: Player, botName: string): void {
  ModalFormBuilder.showQuick(player, "§l修改名字", (f) => {
    f.textField("name", "新名字", { defaultValue: botName });
  }).then((vals) => {
    if (!vals) return;
    const newName = (vals.name as string).trim();
    if (!newName || newName === botName) return;
    const r = botRegistry.get(botName);
    if (!r) { player.sendMessage("§c假人已不存在"); return; }
    system.run(() => {
      try {
        // 删除旧记录，创建新记录
        botRegistry.delete(botName);
        r.name = newName;
        botRegistry.set(newName, r);
        saveBotRecord(r);
        player.sendMessage(`§a已重命名为 §e${newName}`);
      } catch (e: any) { player.sendMessage(`§c改名失败: ${e.message}`); }
    });
  });
}

function toggleOnline(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      if (r.online) {
        offlineBot(r);
        player.sendMessage(`§a§e${botName}§a 已下线`);
      } else {
        onlineBot(r);
        player.sendMessage(`§a§e${botName}§a 已上线`);
      }
    } catch (e: any) { player.sendMessage(`§c${e.message}`); }
  });
}

function updateSpawn(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      const lookTarget = getPlayerLookTarget(player);
      r.respawnPoint = {
        location: player.location,
        dimension: player.dimension.id,
        rotation: player.getRotation(),
        lookTarget,
      };
      if (r.online && r.entityId) {
        const e = world.getEntity(r.entityId);
        if (e?.hasTag(BOT_TAG)) {
          (e as Player).setSpawnPoint({
            dimension: world.getDimension(r.respawnPoint.dimension),
            x: r.respawnPoint.location.x,
            y: r.respawnPoint.location.y,
            z: r.respawnPoint.location.z,
          });
        }
      }
      botRegistry.set(r.name, r);
      saveBotRecord(r);
      player.sendMessage(`§a已更新 §e${botName}§a 的重生点`);
    } catch (e: any) { player.sendMessage(`§c${e.message}`); }
  });
}

function doReclaim(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      const result = reclaimBot(player, r);
      const parts: string[] = [];
      if (result.items > 0) parts.push(`§a${result.items}§7 件物品`);
      if (result.overflow > 0) parts.push(`§e${result.overflow}§7 件溢出掉落`);
      if (result.xp > 0) parts.push(`§b${result.xp} XP§7（Lv.${result.xpLevel}）`);
      if (parts.length === 0) { player.sendMessage(`§e假人 §e${botName}§e 背包是空的`); } else { player.sendMessage(`§a已从 §e${botName}§a 回收: ${parts.join("、")}`); }
    } catch (e: any) { player.sendMessage(`§c回收失败: ${e.message}`); }
  });
}
