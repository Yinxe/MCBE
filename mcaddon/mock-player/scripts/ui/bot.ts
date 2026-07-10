// ─── 统一假人操作面板（v2） ──────────────────────────
// 按用户需求重新排序：扭头 → 移动 → 互换主手 → 互换装备（含副手）
// → 互换背包 → 回收资源 → 改名 → 上线/离线 → 潜行 → 控制模式
// → 标签 → 设置重生点 → 传送到假人(TPA) → 查看数据 → 杀死 → 删除 → 返回列表
//
// 已弃用功能移除此面板：
//   - 一键卸甲（合并至回收资源）
//   - 传送到身边（已合并至移动→同步姿态）
//   - 移动至坐标（可通过 /mp:move 命令）
//   - 互换副手（合并至互换装备，SWAP_SLOTS 已含 Offhand）

import { Player, system, world } from "@minecraft/server";
import { LookDuration, SimulatedPlayer } from "@minecraft/server-gametest";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BotRecord, DP_PREFIX } from "../features/core/types";
import { TAG_CONTROL, BOT_TAG, getTagDef } from "../features/core/tags";
import { formatPos, formatDimensionId, serializeContainer, getPlayerLookTarget } from "../features/core/utils";
import {
  botRegistry, saveBotRecord, saveBotInventory,
  isBotRestored, markBotRestored, removeBotRestored,
} from "../features/core/persistence";
import {
  tpBotToPlayer,
  tpPlayerToBot,
  killBot,
  toggleControl,
  setSneaking,
  swapMainhandWithBot,
  swapEquipmentWithBot,
  reclaimBot,
} from "../features/index";
import { saveBotEquipState } from "../features/equip";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";
import { confirmDelete } from "./move";
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

/** 检查假人是否在线且未死亡 */
function isActive(record: BotRecord): boolean {
  return record.online && !record.death;
}

/** 检查假人是否可交互（在线且未死亡），然后执行 */
function requireActive(player: Player, botName: string, fn: (r: BotRecord) => void): void {
  const r = botRegistry.get(botName);
  if (!r) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已不存在`); return; }
  if (!r.online || r.death) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  fn(r);
}

/** 获取假人 + 玩家双实体并安全执行装备操作 */
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
    // ── 扭头 ──
    .button("§a扭头", () => doLookAtPlayer(player, botName))
    // ── 移动（同步姿态） ──
    .button("§6移动（同步姿态）", () => requireActive(player, botName, (r) => {
      system.run(() => { try { tpBotToPlayer(r, player); player.sendMessage(`§a已将 §e${botName}§a 移动到身边，同步姿态`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    // ── 物品交换 ──
    .button("§e互换主手", () => equip(player, botName, (p, b) => { swapMainhandWithBot(p, b); player.sendMessage(`§a已与 §e${botName}§a 交换主手`); }))
    .button("§e互换装备（含副手）", () => equip(player, botName, (p, b) => { swapEquipmentWithBot(p, b); saveBotEquipState(b, botRegistry.get(botName)!); player.sendMessage(`§a已与 §e${botName}§a 交换全部装备（含副手）`); }))
    .button("§5互换背包", () => requireActive(player, botName, (_) => doSwapInventory(player, botName)))
    .button("§e回收资源", () => doReclaim(player, botName))
    .button("§e改名", () => doRename(player, botName))
    // ── 状态 ──
    .button(record.online ? "§b下线" : "§b上线", () => toggleOnline(player, botName))
    .button(record.isSneaking ? "§b潜行 §a[开]" : "§b潜行 §7[关]", () => requireActive(player, botName, (r) => {
      setSneaking(r, !r.isSneaking);
      player.sendMessage(r.isSneaking ? `§a§e${botName}§a 已潜行` : `§a§e${botName}§a 已站起`);
    }))
    .button(hasControl ? "§b控制模式 §a[开]" : "§b控制模式 §7[关]", () => requireActive(player, botName, (r) => {
      toggleControl(r, player);
      player.sendMessage(r.tags.includes(TAG_CONTROL.value) ? `§a已开启 §e${botName}§a 控制模式` : `§a已关闭 §e${botName}§a 控制模式`);
    }))
    // ── 设置 ──
    .button("§d标签管理", () => showTagManagement(player, botName))
    .button("§a设置重生点", () => updateSpawn(player, botName))
    // ── 其他 ──
    .button("§8传送到假人 (TPA)", () => requireActive(player, botName, (r) => {
      system.run(() => { try { tpPlayerToBot(player, r); player.sendMessage(`§a已传送到 §e${botName}§a 身边`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    .button("§d查看数据", () => { const r = botRegistry.get(botName); if (r) sendData(player, r); })
    // ── 危险 ──
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

/**
 * 扭头：使假人持续看向玩家当时头部的坐标
 * 使用 LookDuration.Continuous 持续追踪固定点
 */
function doLookAtPlayer(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r || !isActive(r)) { player.sendMessage("§c模拟玩家不在线或已死亡"); return; }
  const entity = r.entityId ? world.getEntity(r.entityId) : undefined;
  if (!entity || !entity.hasTag(BOT_TAG)) { player.sendMessage("§c无法获取假人实体"); return; }
  system.run(() => {
    try {
      (entity as SimulatedPlayer).lookAtLocation(player.getHeadLocation(), LookDuration.Continuous);
      player.sendMessage(`§a§e${botName}§a 正在持续看向你`);
    } catch (e: any) { player.sendMessage(`§c扭头失败: ${e.message}`); }
  });
}

/** 互换背包：与玩家完全交换所有背包格子（0-35，含快捷栏） */
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
      // 读取双方全部格子（0-35，含快捷栏）
      const playerItems: any[] = [];
      const botItems: any[] = [];
      for (let i = 0; i < size; i++) {
        playerItems.push(pInv.container.getItem(i));
        botItems.push(bInv.container.getItem(i));
      }
      // 写入（先清空假人再写入玩家物品，避免冲突）
      for (let i = 0; i < size; i++) {
        bInv.container.setItem(i, playerItems[i] ?? undefined);
        pInv.container.setItem(i, botItems[i] ?? undefined);
      }
      saveBotInventory(r.name, serializeContainer(bInv.container));
      player.sendMessage(`§a已与 §e${botName}§a 互换全部背包（含快捷栏）`);
    } catch (e: any) { player.sendMessage(`§c互换背包失败: ${e.message}`); }
  });
}

/**
 * 改名（含数据安全迁移）
 *
 * 改名涉及的数据迁移：
 *   1. 背包/装备 DynamicProperty 的 key 含假人名 →
 *      遍历所有带旧名前缀的 key，写入新名前缀后删除旧 key
 *   2. 在线实体的 nameTag（Player.name 只读无法修改）
 *   3. restoredBots 状态标记迁移（否则 saveBotFullState 误拦截）
 *
 * ⚠️ Minecraft API 限制：Player.name 只读，实体内部标识不变。
 *    不影响功能，仅头顶显示名和 registry key 更新。
 */
function doRename(player: Player, botName: string): void {
  ModalFormBuilder.showQuick(player, "§l修改名字", (f) => {
    f.textField("name", "新名字", { defaultValue: botName });
  }).then((vals) => {
    if (!vals) return;
    const newName = (vals.name as string).trim();
    if (!newName || newName === botName) return;
    if (botRegistry.has(newName)) { player.sendMessage(`§c假人 §e${newName}§c 已存在`); return; }

    const r = botRegistry.get(botName);
    if (!r) { player.sendMessage("§c假人已不存在"); return; }

    // ⚠️ 在线改名会导致 Player.name（只读）与 registry key 不一致，
    //    事件处理器（playerLeave、背包保存等）用 Player.name 查 registry 失败，
    //    造成数据泄露或写错前缀。
    if (r.online) { player.sendMessage("§c请先将假人下线后再改名"); return; }

    system.run(() => {
      try {
        // ── 1. 迁移 DynamicProperty（背包/装备 key 含假人名） ──
        const ids = world.getDynamicPropertyIds();
        const OLD = `${DP_PREFIX}${botName}`;
        const NEXT = `${DP_PREFIX}${newName}`;
        for (const id of ids) {
          if (!id.startsWith(OLD)) continue;
          const value = world.getDynamicProperty(id);
          if (value !== undefined) {
            world.setDynamicProperty(NEXT + id.slice(OLD.length), value);
          }
          world.setDynamicProperty(id, undefined);
        }

        // ── 2. 更新实体头顶显示名 ──
        // Player.name 只读无法修改，只改 nameTag（影响的头顶显示）
        if (r.online && r.entityId) {
          const entity = world.getEntity(r.entityId);
          if (entity) entity.nameTag = newName;
        }

        // ── 3. 迁移 restoredBots 状态 ──
        // 否则新名前缀在 saveBotFullState 里被拦截（isBotRestored 检查）
        if (isBotRestored(botName)) {
          removeBotRestored(botName);
          markBotRestored(newName);
        }

        // ── 4. 更新 registry 指向新名 ──
        botRegistry.delete(botName);
        r.name = newName;
        botRegistry.set(newName, r);
        saveBotRecord(r);

        player.sendMessage(`§a已重命名为 §e${newName}`);
      } catch (e: any) { player.sendMessage(`§c改名失败: ${e.message}`); }
    });
  });
}

/** 上线/下线切换 */
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

/** 设置重生点 */
function updateSpawn(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  system.run(() => {
    try {
      r.respawnPoint = {
        location: player.location,
        dimension: player.dimension.id,
        rotation: player.getRotation(),
        lookTarget: getPlayerLookTarget(player),
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

/** 回收假人全部物品和经验到玩家 */
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
