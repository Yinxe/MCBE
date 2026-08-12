// ─── 统一假人操作面板（v3） ──────────────────────────
// 主菜单：移动/物品/状态/行为标签/传送
// showTagManagement 模态表单中统一管理。
// 主菜单保留移动/物品/回收/传送等直接操作。
//
// 已弃用功能移除此面板：
//   - 一键卸甲（合并至回收资源）
//   - 传送到身边（已合并至移动→同步姿态）
//   - 互换副手（合并至互换装备，SWAP_SLOTS 已含 Offhand）

import { Player, EquipmentSlot, system, world } from "@minecraft/server";
import { color, style } from "@yinxe/toolkit";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";

import { BotRecord, isValidBotName } from "../../core/model/Types";
import { BOT_TAG, getTagDef } from "../../core/tags/BotTags";
import { BotEvents } from "../../core/events/DomainEvents";
import { formatPos } from "../format";
import { formatDimensionId } from "../../core/format/Format";
import { collectContainerItems } from "../adapters/McItemCodec";
import { getPlayerLookTarget, lookAt } from "../adapters/PoseGateway";
import { botRegistry, saveCoordinator } from "../bootstrap/context";
import {
  tpBotToPlayer,
  tpPlayerToBot,
  killBot,
  swapMainhandWithBot,
} from "../features/index";
import { onlineBot } from "../features/onlineBot";
import { offlineBot } from "../features/offlineBot";
import { showTridentSelector } from "./trident";
import { showTridentClaimUI } from "./tridentClaim";
import { canManageBot, autoClaim, isAdmin } from "../commands/auth";
import { visibleRecords } from "../../core/service/BotVisibility";
import { showReclaimForm } from "./reclaim";
import { showMainhandSelector } from "./mainhand";
import { confirmDelete } from "./move";
import { showTagManagement } from "./tags";
import { sendData } from "../commands/data";

// ─── 工具 ──────────────────────────────────────────────

/** EquipmentSlot → 装备槽名（非装备槽返回 undefined；非装备槽不触发装备事件） */
function equipSlotNameOf(slot: EquipmentSlot): "head" | "chest" | "legs" | "feet" | "offhand" | undefined {
  switch (slot) {
    case EquipmentSlot.Head: return "head";
    case EquipmentSlot.Chest: return "chest";
    case EquipmentSlot.Legs: return "legs";
    case EquipmentSlot.Feet: return "feet";
    case EquipmentSlot.Offhand: return "offhand";
    default: return undefined;
  }
}

/** 互换装备/副手后触发槽位粒度装备变化事件（InventoryStorage 订阅保存） */
function triggerEquipChangeUI(bot: Player, slot: EquipmentSlot): void {
  const name = equipSlotNameOf(slot);
  if (name) {
    BotEvents.botEquipSlotChanged.trigger({ botName: bot.name, slot: name, via: "swap" });
  }
}

function getStatusIcon(record: BotRecord): string {
  if (record.death) return style("[死亡]", color.error);
  if (record.online) return style("[在线]", color.success);
  return style("[离线]", color.warn);
}

function getPosSummary(record: BotRecord): string {
  if (record.lastPoint) {
    return `${formatPos(record.lastPoint.location)} ${color.gold}${formatDimensionId(record.lastPoint.dimension)}`;
  }
  if (record.death && record.deathPoint) {
    return `${formatPos(record.deathPoint.location)} ${color.gold}${formatDimensionId(record.deathPoint.dimension)} ${style("(死亡点)", color.gold)}`;
  }
  return `${formatPos(record.respawnPoint.location)} ${color.gold}${formatDimensionId(record.respawnPoint.dimension)} ${style("(重生点)", color.gold)}`;
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
  if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`); return; }
  if (!r.online || r.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
  fn(r);
}

/** 获取假人 + 玩家双实体并安全执行装备操作 */
function equip(player: Player, botName: string, fn: (p: Player, b: Player) => void): void {
  const r = botRegistry.get(botName);
  if (!r || !r.online || r.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
  const bot = resolveBotEntity(r);
  if (!bot) { player.sendMessage(`${color.error}无法获取假人实体`); return; }
  system.run(() => { try { fn(player, bot); } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); } });
}

/** 使用物品/停止使用：已移回行为菜单，用普通开关控制（见 tags.ts） */

// ─── 统一假人操作面板（v3，showBotPanel 主菜单） ──────

export function showBotPanel(player: Player, botName: string, onBack?: () => void): void {
  const record = botRegistry.get(botName);
  if (!record) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已被删除`); return; }

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

  const ownerStr = record.ownerName ? `\n${color.accent}主人: ${color.playerName}${record.ownerName}` : `\n${color.muted}无主（仅管理员可管理）`;
  const tagLabels = record.tags.filter(t => t !== BOT_TAG).map(t => { const d = getTagDef(t); return d ? d.label : t; });
  const tagStr = tagLabels.length > 0 ? `\n${color.accent}标签: ${color.playerName}${tagLabels.join(`${color.accent} | ${color.playerName}`)}` : "";
  const expStr = record.experience ? `\n${color.accent}经验: ${color.playerName}Lv.${record.experience.level} ${color.accent}(${record.experience.totalXp} XP)` : "";

  new ActionFormBuilder()
    .title(`${color.bold}${botName} ${getStatusIcon(record)}`)
    .body(`${getPosSummary(record)}${ownerStr}${tagStr}${expStr}`)
    // ── 上线/下线（置顶） ──
    .button(record.online ? style("设为离线", color.darkGreen) : style("设为在线", color.darkGreen), () => toggleOnline(player, botName))
    // ── 传送 ──
    .button(style("传送过去", color.darkBlue), () => tpToBot(player, botName))
    // ── 同步/操作 ──
    .button(style("同步姿态", color.darkBlue), () => requireActive(player, botName, (r) => {
      system.run(() => {
        try {
          tpBotToPlayer(r, player);
          const bot = resolveBotEntity(r);
          if (!bot) { player.sendMessage(`${color.success}已同步 ${color.playerName}${botName}`); return; }
          const rot = bot.getRotation();
          const dim = formatDimensionId(bot.dimension.id);
          const loc = bot.location;
          let lookMsg = "";
          try {
            const hit = bot.getBlockFromViewDirection({ maxDistance: 64 });
            if (hit) {
              const b = hit.block;
              lookMsg = `${color.accent}注视目标: ${color.info}${b.typeId} ${color.accent}@ ${color.info}${Math.floor(b.location.x)} ${Math.floor(b.location.y)} ${Math.floor(b.location.z)}`;
            }
          } catch { /* ignore */ }
          const sneak = bot.isSneaking ? `${color.success}潜行` : `${color.info}站立`;
          player.sendMessage(
            `${color.success}已同步 ${color.playerName}${botName}${color.success}\n` +
            `${color.accent}维度: ${dim}\n` +
            `${color.accent}坐标: ${color.info}${Math.floor(loc.x)} ${Math.floor(loc.y)} ${Math.floor(loc.z)}\n` +
            `${color.accent}朝向: ${color.info}${Math.floor(rot.x)}° ${Math.floor(rot.y)}°\n` +
            `${color.accent}体态: ${sneak}` +
            (lookMsg ? `\n${lookMsg}` : "")
          );
        } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); }
      });
    }))
    .button(style("选择主手", color.darkBlue), () => showMainhandSelector(player, botName))
    // ── 互换/回收 ──
    .button(style("物品互换", color.darkBlue), () => doSwap(player, botName))
    .button(style("回收资源", color.darkBlue), () => doReclaim(player, botName))
    // ── 标签/设置 ──
    .button(style("行为标签", color.darkGreen), () => showTagManagement(player, botName))
    .button(style("设置重生", color.darkBlue), () => updateSpawn(player, botName))
    .button(style("修改名字", color.darkBlue), () => doRename(player, botName))
    // ── 战斗/工具 ──
    .button(style("投三叉戟", color.darkBlue), () => showTridentSelector(player, botName))
    .button(style("投掷物认主", color.darkBlue), () => showTridentClaimUI(player, botName))
    .button(style("查看数据", color.darkBlue), () => { const r = botRegistry.get(botName); if (r) sendData(player, r); })
    // ── 危险 ──
    .button(style("击杀假人", color.darkRed), () => requireActive(player, botName, (r) => {
      system.run(() => { try { killBot(r); player.sendMessage(`${color.success}已杀死 ${color.playerName}${botName}`); } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); } });
    }))
    .buttonWithIcon(style("删除假人", color.darkRed), "textures/ui/icon_trash", () => confirmDelete(player, botName))
    .button(style("返回列表", color.darkBlue), () => { if (onBack) onBack(); })
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
    return;
  }

  const sorted = [...records].sort((a, b) => {
    const orderA = a.death ? 1 : a.online ? 2 : 0;
    const orderB = b.death ? 1 : b.online ? 2 : 0;
    return orderA - orderB;
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
    builder.button(`${getStatusIcon(record)} ${color.black}${record.name} ${color.black}${dim}`, () => showBotPanel(player, record.name, () => showBotList(player, onMainMenu)));
  }

  builder.button(style("← 返回", color.darkBlue), () => { if (onMainMenu) onMainMenu(); }).show(player);
}

// ─── 操作实现 ──────────────────────────────────────────

/**
 * 互换面板（ModalForm 选择项目）
 * 可选：主手 / 副手 / 装备（头/胸/腿/靴）/ 背包（含主手）
 * 所有操作在同一 system.run 内执行，避免竞态
 */
function doSwap(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r || !r.online || r.death) { player.sendMessage(`${color.error}模拟玩家不在线或已死亡`); return; }
  const bot = resolveBotEntity(r);
  if (!bot) { player.sendMessage(`${color.error}无法获取假人实体`); return; }

  new ModalFormBuilder()
    .title(`${color.bold}互换项目`)
    .toggle("mainhand", "互换主手", { defaultValue: false })
    .toggle("offhand", "互换副手", { defaultValue: false })
    .toggle("armor", "互换装备（头/胸/腿/靴）", { defaultValue: false })
    .toggle("inventory", "互换背包（含主手）", { defaultValue: false })
    .submitButton("互换")
    .show(player)
    .then((vals) => {
      if (!vals) return;
      const hasInv = vals.inventory as boolean;
      const hasMainhand = vals.mainhand as boolean;
      const hasOffhand = vals.offhand as boolean;
      const hasArmor = vals.armor as boolean;
      if (!hasInv && !hasMainhand && !hasOffhand && !hasArmor) {
        player.sendMessage(`${color.warn}未选择任何互换项目`);
        return;
      }

      system.run(() => {
        try {
          const done: string[] = [];

          // ── 背包（含主手）优先执行 ──
          if (hasInv) {
            const pInv = player.getComponent("inventory") as any;
            const bInv = bot.getComponent("inventory") as any;
            if (!pInv?.container || !bInv?.container) throw new Error("无法获取背包容器");
            const size = Math.min(pInv.container.size, bInv.container.size);
            const pItems: any[] = [];
            const bItems: any[] = [];
            for (let i = 0; i < size; i++) {
              pItems.push(pInv.container.getItem(i));
              bItems.push(bInv.container.getItem(i));
            }
            for (let i = 0; i < size; i++) {
              bInv.container.setItem(i, pItems[i] ?? undefined);
              pInv.container.setItem(i, bItems[i] ?? undefined);
            }
            saveCoordinator.saveInventory(r.name, collectContainerItems(bInv.container));
            done.push("背包");
          }

          // ── 主手（背包未涵盖时才单独互换） ──
          if (hasMainhand && !hasInv) {
            swapMainhandWithBot(player, bot);
            done.push("主手");
          }

          // ── 副手 & 装备（头/胸/腿/靴） ──
          if (hasOffhand || hasArmor) {
            const pEquip = player.getComponent("minecraft:equippable") as any;
            const bEquip = bot.getComponent("minecraft:equippable") as any;
            if (pEquip && bEquip) {
              for (const slot of [EquipmentSlot.Offhand, EquipmentSlot.Head, EquipmentSlot.Chest, EquipmentSlot.Legs, EquipmentSlot.Feet]) {
                const isOffhand = slot === EquipmentSlot.Offhand;
                if (isOffhand && !hasOffhand) continue;
                if (!isOffhand && !hasArmor) continue;
                const pItem = pEquip.getEquipment(slot);
                const bItem = bEquip.getEquipment(slot);
                pEquip.setEquipment(slot, bItem);
                bEquip.setEquipment(slot, pItem);
                // 槽位粒度装备变化事件：互换副手只触发 offhand，互换装备只触发 4 槽
                triggerEquipChangeUI(bot, slot);
              }
            }
            if (hasOffhand) done.push("副手");
            if (hasArmor) done.push("装备");
          }

          player.sendMessage(`${color.success}已与 ${color.playerName}${botName}${color.success} 互换${done.join("、")}`);
        } catch (e: any) { player.sendMessage(`${color.error}互换失败: ${e.message}`); }
      });
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
  ModalFormBuilder.showQuick(player, `${color.bold}修改名字`, (f) => {
    f.textField("name", "新名字", { defaultValue: botName });
  }).then((vals) => {
    if (!vals) return;
    const newName = (vals.name as string).trim();
    if (!newName || newName === botName) return;
    // ⚠️ 名字合法性：长度限制（生成 "(2)" 重名防护边界）；NBT 存储绑定表随
    //    BotRecord 持久化，改名无需迁移物品数据（与旧 DP 槽位 key 无关）
    if (!isValidBotName(newName)) { player.sendMessage(`${color.error}名字不合法：不能超过 16 字符`); return; }
    if (botRegistry.has(newName)) { player.sendMessage(`${color.error}假人 ${color.playerName}${newName}${color.error} 已存在`); return; }

    const r = botRegistry.get(botName);
    if (!r) { player.sendMessage(`${color.error}假人已不存在`); return; }

    // ⚠️ 在线改名会导致 Player.name（只读）与 registry key 不一致，
    //    事件处理器（playerLeave、背包保存等）用 Player.name 查 registry 失败，
    //    造成数据泄露或写错前缀。
    if (r.online) { player.sendMessage(`${color.error}请先将假人下线后再改名`); return; }

    system.run(() => {
      try {
        // ── 1. 更新实体头顶显示名 ──
        // Player.name 只读无法修改，只改 nameTag（影响的头顶显示）
        if (r.online && r.entityId) {
          const entity = world.getEntity(r.entityId);
          if (entity) entity.nameTag = newName;
        }

        // ── 2. 改名（registry 内部完成内存 key 迁移 + 恢复标记随迁 + 持久化） ──
        // 背包/装备数据存 NBT 木桶阵列（绑定表随记录），无需迁移任何物品数据
        botRegistry.rename(botName, newName);

        player.sendMessage(`${color.success}已重命名为 ${color.playerName}${newName}`);
      } catch (e: any) { player.sendMessage(`${color.error}改名失败: ${e.message}`); }
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
        player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已下线`);
      } else {
        onlineBot(r)
          .then(() => player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已上线`))
          .catch((e: any) => player.sendMessage(`${color.error}${e.message}`));
      }
    } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); }
  });
}

/**
 * 传送到假人（TPA）：若假人未上线则先上线再传送
 */
function tpToBot(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) { player.sendMessage(`${color.error}模拟玩家 ${color.playerName}${botName}${color.error} 已不存在`); return; }

  system.run(() => {
    if (!r.online || r.death) {
        // 先上线（异步等待名称唯一），完成后传送
        onlineBot(r)
          .then(() => {
            player.sendMessage(`${color.success}${color.playerName}${botName}${color.success} 已上线`);
            // 等 1 tick 让实体就绪后再传送
            system.run(() => {
              tpPlayerToBot(player, botRegistry.get(botName)!);
              player.sendMessage(`${color.success}已传送到 ${color.playerName}${botName}${color.success} 身边`);
            });
          })
          .catch((e: any) => player.sendMessage(`${color.error}${e.message}`));
      } else {
        tpPlayerToBot(player, r);
        player.sendMessage(`${color.success}已传送到 ${color.playerName}${botName}${color.success} 身边`);
      }
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
      saveCoordinator.saveRecord(r);
      player.sendMessage(`${color.success}已更新 ${color.playerName}${botName}${color.success} 的重生点`);
    } catch (e: any) { player.sendMessage(`${color.error}${e.message}`); }
  });
}

/** 显示回收详情表单并执行选择性回收 */
function doReclaim(player: Player, botName: string): void {
  const r = botRegistry.get(botName);
  if (!r) return;
  showReclaimForm(player, r);
}
