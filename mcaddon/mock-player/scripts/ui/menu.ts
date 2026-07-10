// ─── 主菜单 / 列表 / 操作面板 ───────────────────────────

import { Player, world, system } from "@minecraft/server";
import { ActionFormBuilder } from "@yinxe/toolkit/ui";

import { BotRecord } from "../features/types";
import { TAG_CONTROL, TAG_BOT, getTagDef } from "../features/tags";
import { formatPos, formatDimensionId, getPlayerLookTarget } from "../features/utils";
import { botRegistry, saveBotRecord } from "../features/persistence";
import {
  tpBotToPlayer,
  tpPlayerToBot,
  killBot,
  offlineBot,
  onlineBot,
  toggleControl,
  setSneaking,
  swapMainhandWithBot,
  swapOffhandWithBot,
  swapEquipmentWithBot,
  unequipBotAll,
  saveBotEquipState,
  reclaimBot,
} from "../features/operations";
import { showCreateForm } from "./create";
import { showOnlineManagement } from "./online";
import { showTagManagement, showTagLookup } from "./tags";
import { showMoveForm, confirmDelete } from "./move";
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
  return entity?.hasTag(TAG_BOT.value) ? (entity as Player) : undefined;
}

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  new ActionFormBuilder()
    .title("§l模拟玩家管理")
    .button("§a创建模拟玩家", () => showCreateForm(player))
    .button("§b模拟玩家列表", () => showBotList(player))
    .button("§6在线管理", () => showOnlineManagement(player))
    .button("§d标签速查", () => showTagLookup(player))
    .show(player);
}

// ─── 模拟玩家列表 ────────────────────────────────────

function showBotList(player: Player): void {
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
    const icon = getStatusIcon(record);
    const dim = record.lastPoint
      ? formatDimensionId(record.lastPoint.dimension)
      : record.deathPoint
        ? formatDimensionId(record.deathPoint.dimension)
        : formatDimensionId(record.respawnPoint.dimension);
    // Capture name by closure
    const name = record.name;
    builder.button(`${icon} §e${name} §7${dim}`, () => showOperationPanel(player, name));
  }

  builder.button("§7← 返回", () => showMainMenu(player)).show(player);
}

// ─── 操作面板 ────────────────────────────────────────

export function showOperationPanel(player: Player, botName: string): void {
  const record = botRegistry.get(botName);
  if (!record) {
    player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
    showBotList(player);
    return;
  }

  const statusText = record.death ? "§4[死亡]" : record.online ? "§a[在线]" : "§7[离线]";
  const tagLabels = record.tags
    .filter((t) => t !== TAG_BOT.value)
    .map((t) => {
      const def = getTagDef(t);
      return def ? def.label : t;
    });
  const tagStr = tagLabels.length > 0 ? `\n§7标签: §b${tagLabels.join(" §7| §b")}` : "";
  const expStr = `\n§7经验: §bLv.${record.experience.level} §7(${record.experience.totalXp} XP)`;

  const canAct = record.online && !record.death;
  const hasControl = record.tags.includes(TAG_CONTROL.value);

  new ActionFormBuilder()
    .title(`§l${botName} ${statusText}`)
    .body(`${getPosSummary(record)}${tagStr}${expStr}`)
    // ── 传送 ──
    .button("§6TPHERE — 假人传送到身边", () => act(player, botName, (r) => { tpBotToPlayer(r, player); player.sendMessage(`§a已将 §e${botName}§a 传送到身边`); }))
    .button("§6TPA — 传送到假人", () => act(player, botName, (r) => { tpPlayerToBot(player, r); player.sendMessage(`§a已传送到 §e${botName}§a 身边`); }))
    .button("§6移动", () => act(player, botName, () => showMoveForm(player, botName)))
    // ── 在线 ──
    .button(record.online ? "§b上线/下线 §a[在线]" : "§7上线/下线 §7[离线]", () => toggleOnline(player, botName))
    // ── 装备 ──
    .button("§6交换主手", () => equip(player, botName, (p, b) => { swapMainhandWithBot(p, b); p.sendMessage(`§a已与 §e${botName}§a 交换主手`); }))
    .button("§6交换副手", () => equip(player, botName, (p, b) => { swapOffhandWithBot(p, b); p.sendMessage(`§a已与 §e${botName}§a 交换副手`); }))
    .button("§6交换装备", () => equip(player, botName, (p, b) => { swapEquipmentWithBot(p, b); saveBotEquipState(b, botRegistry.get(botName)!); p.sendMessage(`§a已与 §e${botName}§a 交换装备`); }))
    .button("§e一件卸甲", () => equip(player, botName, (p, b) => { unequipBotAll(p, b); saveBotEquipState(b, botRegistry.get(botName)!); p.sendMessage(`§a已将 §e${botName}§a 一键卸甲`); }))
    // ── 行为 ──
    .button(record.isSneaking ? "§b潜行 §a[开]" : "§b潜行 §7[关]", () => act(player, botName, (r) => { setSneaking(r, !r.isSneaking); player.sendMessage(r.isSneaking ? `§a§e${botName}§a 已潜行` : `§a§e${botName}§a 已站起`); }))
    .button(hasControl ? "§b控制 §a[开]" : "§7控制 §c[关]", () => act(player, botName, (r) => { toggleControl(r, player); player.sendMessage(r.tags.includes(TAG_CONTROL.value) ? `§a已开启 §e${botName}§a 控制模式` : `§a已关闭 §e${botName}§a 控制模式`); }))
    // ── 管理 ──
    .button("§d标签", () => showTagManagement(player, botName))
    .button("§a重生点", () => updateSpawn(player, botName))
    .button("§d查看数据", () => { const r = botRegistry.get(botName); if (r) sendData(player, r); })
    // ── 回收 ──
    .button("§b回收全部", () => doReclaim(player, botName))
    // ── 危险 ──
    .button("§c杀死", () => act(player, botName, (r) => { killBot(r); player.sendMessage(`§a已杀死 §e${botName}`); }))
    .button("§c删除", () => confirmDelete(player, botName))
    .button("§7← 返回", () => showBotList(player))
    .show(player);
}

// ─── 辅助操作 ────────────────────────────────────

function act(player: Player, botName: string, fn: (r: BotRecord) => void): void {
  const r = botRegistry.get(botName);
  if (!r) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已不存在`); return; }
  if (!r.online || r.death) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  system.run(() => { try { fn(r); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
  showOperationPanel(player, botName);
}

function toggleOnline(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      if (r.online) { offlineBot(r); player.sendMessage(`§a§e${botName}§a 已下线`); }
      else { onlineBot(r); player.sendMessage(`§a§e${botName}§a 已上线`); }
    } catch (e: any) { player.sendMessage(`§c${e.message}`); }
  });
  showOperationPanel(player, botName);
}

function equip(player: Player, botName: string, fn: (p: Player, b: Player) => void): void {
  const r = botRegistry.get(botName);
  if (!r || !r.online || r.death) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  const bot = resolveBotEntity(r);
  if (!bot) { player.sendMessage("§c无法获取假人实体"); return; }
  system.run(() => { try { fn(player, bot); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
  showOperationPanel(player, botName);
}

function updateSpawn(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      const lookTarget = getPlayerLookTarget(player);
      r.respawnPoint = { location: player.location, dimension: player.dimension.id, rotation: player.getRotation(), lookTarget };
      if (r.online && r.entityId) {
        const e = world.getEntity(r.entityId);
        if (e?.hasTag(TAG_BOT.value)) {
          (e as Player).setSpawnPoint({ dimension: world.getDimension(r.respawnPoint.dimension), x: r.respawnPoint.location.x, y: r.respawnPoint.location.y, z: r.respawnPoint.location.z });
        }
      }
      botRegistry.set(r.name, r); saveBotRecord(r);
      player.sendMessage(`§a已更新 §e${botName}§a 的重生点`);
    } catch (e: any) { player.sendMessage(`§c${e.message}`); }
  });
  showOperationPanel(player, botName);
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
      if (parts.length === 0) { player.sendMessage(`§e假人 §e${botName}§e 背包是空的`); }
      else { player.sendMessage(`§a已从 §e${botName}§a 回收: ${parts.join("、")}`); }
    } catch (e: any) { player.sendMessage(`§c回收失败: ${e.message}`); }
  });
  showOperationPanel(player, botName);
}
