// ─── 统一假人操作面板（v3） ──────────────────────────
// 主菜单：移动/物品/状态/行为标签/传送
// showTagManagement 模态表单中统一管理。
// 主菜单保留移动/物品/回收/传送等直接操作。
//
// 已弃用功能移除此面板：
//   - 一键卸甲（合并至回收资源）
//   - 传送到身边（已合并至移动→同步姿态）
//   - 互换副手（合并至互换装备，SWAP_SLOTS 已含 Offhand）

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit/ui";

import { BotRecord, DP_PREFIX } from "../features/core/types";
import { BOT_TAG, getTagDef } from "../features/core/tags";
import { formatPos, formatDimensionId, serializeContainer } from "../features/core/utils";
import { getPlayerLookTarget, lookAt } from "../features/core/pose";
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
import { startFollow, stopFollow, isFollowing } from "../features/follow";
import { showTridentSelector } from "./trident";
import { showMainhandSelector } from "./mainhand";
import { confirmDelete, showMoveForm } from "./move";
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
  if (!entity?.isValid) return undefined;
  try {
    return entity.hasTag(BOT_TAG) ? (entity as Player) : undefined;
  } catch {
    return undefined;
  }
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

// ─── 统一假人操作面板（v3） ──────────────────────────

export function showBotPanel(player: Player, botName: string, onBack?: () => void): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`); return; }

  const tagLabels = record.tags.filter(t => t !== BOT_TAG).map(t => { const d = getTagDef(t); return d ? d.label : t; });
  const tagStr = tagLabels.length > 0 ? `\n§7标签: §b${tagLabels.join(" §7| §b")}` : "";
  const expStr = record.experience ? `\n§7经验: §bLv.${record.experience.level} §7(${record.experience.totalXp} XP)` : "";

  new ActionFormBuilder()
    .title(`§l${botName} ${getStatusIcon(record)}`)
    .body(`${getPosSummary(record)}${tagStr}${expStr}`)
    // ── 看向我 ──
    .buttonWithIcon("§b看向我", "textures/ui/icon_setting", () => {
      const r = botRegistry.get(botName);
      if (!r || !resolveBotEntity(r)) { player.sendMessage("§c假人不在线或已死亡"); return; }
      const bot = resolveBotEntity(r)!;
      if (r.spawnMode === "chunkload") {
        player.sendMessage("§c强加载模式不支持扭头功能");
        return;
      }
      lookAt(bot as SimulatedPlayer, player.getHeadLocation());
      player.sendMessage(`§a§e${botName}§a 正在持续看向你`);
    })
    // ── 同步（视角/位置/体态） ──
    .buttonWithIcon("§b同步（视角/位置/体态）", "textures/ui/icon_exit", () => requireActive(player, botName, (r) => {
      system.run(() => {
        try {
          tpBotToPlayer(r, player);
          // ── 读取同步后的体态信息 ──
          const bot = resolveBotEntity(r);
          if (!bot) { player.sendMessage(`§a已同步 §e${botName}`); return; }
          const rot = bot.getRotation();
          const dim = formatDimensionId(bot.dimension.id);
          const loc = bot.location;
          // 检测注视方向的目标方块
          let lookMsg = "";
          try {
            const hit = bot.getBlockFromViewDirection({ maxDistance: 64 });
            if (hit) {
              const b = hit.block;
              lookMsg = `§7注视目标: §f${b.typeId} §7@ §f${Math.floor(b.location.x)} ${Math.floor(b.location.y)} ${Math.floor(b.location.z)}`;
            }
          } catch { /* 检测失败忽略 */ }
          const sneak = bot.isSneaking ? "§a潜行" : "§7站立";
          player.sendMessage(
            `§a已同步 §e${botName}§a\n` +
            `§7维度: ${dim}\n` +
            `§7坐标: §f${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}\n` +
            `§7朝向: §f${Math.floor(rot.x)}° ${Math.floor(rot.y)}°\n` +
            `§7体态: ${sneak}` +
            (lookMsg ? `\n${lookMsg}` : "")
          );
        } catch (e: any) { player.sendMessage(`§c${e.message}`); }
      });
    }))
    .buttonWithIcon("§b选择主手", "textures/ui/icon_edit", () => {
      showMainhandSelector(player, botName);
    })
    .buttonWithIcon("§b跟随/停止", "textures/ui/icon_multiplayer", () => {
      system.run(() => {
        if (isFollowing(botName)) {
          stopFollow(botName);
          player.sendMessage(`§a已停止 §e${botName}§a 的跟随`);
        } else {
          const r = botRegistry.get(botName);
          if (!r || !r.online || r.death) { player.sendMessage("§c假人不在线或已死亡"); return; }
          const ok = startFollow(botName, player.id);
          player.sendMessage(ok ? `§a§e${botName}§a 正在跟随你` : "§c启动跟随失败");
        }
      });
    })
    .buttonWithIcon("§b投掷三叉戟", "textures/ui/icon_trade", () => {
      showTridentSelector(player, botName);
    })
    .buttonWithIcon("§b移动至坐标", "textures/ui/icon_exit", () => {
      showMoveForm(player, botName);
    })
    // ── 物品交换 ──
    .buttonWithIcon("§b互换主手", "textures/ui/icon_copy", () => equip(player, botName, (p, b) => { swapMainhandWithBot(p, b); player.sendMessage(`§a已与 §e${botName}§a 交换主手`); }))
    .buttonWithIcon("§b互换装备", "textures/ui/icon_setting", () => equip(player, botName, (p, b) => { swapEquipmentWithBot(p, b); saveBotEquipState(b, botRegistry.get(botName)!); player.sendMessage(`§a已与 §e${botName}§a 交换全部装备（含副手）`); }))
    .buttonWithIcon("§b互换背包", "textures/ui/icon_copy", () => requireActive(player, botName, (_) => doSwapInventory(player, botName)))
    .buttonWithIcon("§b回收资源", "textures/ui/icon_trash", () => doReclaim(player, botName))
    .buttonWithIcon("§b改名", "textures/ui/icon_edit", () => doRename(player, botName))
    // ── 状态 ──
    .button(record.online ? "§a下线" : "§a上线", () => toggleOnline(player, botName))
    // ── 行为 ──
    .buttonWithIcon("§a行为标签", "textures/ui/icon_recipe", () => showTagManagement(player, botName))
    // ── 设置 ──
    .buttonWithIcon("§b设置重生点", "textures/ui/icon_setting", () => updateSpawn(player, botName))
    // ── 其他 ──
    .buttonWithIcon("§b传送到假人", "textures/ui/icon_exit", () => tpToBot(player, botName))
    .buttonWithIcon("§b查看数据", "textures/ui/icon_search", () => { const r = botRegistry.get(botName); if (r) sendData(player, r); })
    // ── 危险 ──
    .buttonWithIcon("§c杀死", "textures/ui/icon_lock", () => requireActive(player, botName, (r) => {
      system.run(() => { try { killBot(r); player.sendMessage(`§a已杀死 §e${botName}`); } catch (e: any) { player.sendMessage(`§c${e.message}`); } });
    }))
    .buttonWithIcon("§c删除", "textures/ui/icon_trash", () => confirmDelete(player, botName))
    .buttonWithIcon("§b返回列表", "textures/ui/icon_exit", () => { if (onBack) onBack(); })
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
    builder.button(`${getStatusIcon(record)} §f${record.name} §f${dim}`, () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu)));
  }

  builder.button("§b← 返回", () => { if (onMainMenu) onMainMenu(); }).show(player);
}

// ─── 操作实现 ──────────────────────────────────────────

/**
 * 互换背包：与玩家完全交换所有背包格子（0-35，含快捷栏）
 */
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

/**
 * 传送到假人（TPA）：若假人未上线则先上线再传送
 */
function tpToBot(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) { player.sendMessage(`§c模拟玩家 §e${botName}§c 已不存在`); return; }

  system.run(() => {
    try {
      if (!r.online || r.death) {
        // 先上线
        onlineBot(r);
        player.sendMessage(`§a§e${botName}§a 已上线`);
        // 等 1 tick 让实体就绪后再传送
        system.run(() => {
          tpPlayerToBot(player, botRegistry.get(botName)!);
          player.sendMessage(`§a已传送到 §e${botName}§a 身边`);
        });
      } else {
        tpPlayerToBot(player, r);
        player.sendMessage(`§a已传送到 §e${botName}§a 身边`);
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
