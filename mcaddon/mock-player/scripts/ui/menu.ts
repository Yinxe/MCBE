// ─── 主菜单 / 列表 / 操作面板 ───────────────────────────

import { Player, world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

import { BotRecord, BOT_TAG } from "../features/types";
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
  swapEquipmentWithBot,
  unequipBotAll,
  saveBotEquipState,
} from "../features/operations";
import { showCreateForm } from "./create";
import { showOnlineManagement } from "./online";
import { showTagManagement, showTagLookup } from "./tags";
import { showMoveForm, confirmDelete } from "./move";

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

// ─── 主菜单 ──────────────────────────────────────────

export function showMainMenu(player: Player): void {
  const form = new ActionFormData()
    .title("§l模拟玩家管理")
    .button("§6◆ 创建模拟玩家")
    .button("§a◆ 模拟玩家列表")
    .button("§b◆ 在线管理")
    .button("§d◆ 标签速查");

  form.show(player).then((response) => {
    if (response.canceled) return;
    switch (response.selection) {
      case 0:
        showCreateForm(player);
        break;
      case 1:
        showBotList(player);
        break;
      case 2:
        showOnlineManagement(player);
        break;
      case 3:
        showTagLookup(player);
        break;
    }
  });
}

// ─── 模拟玩家列表 ────────────────────────────────────

function showBotList(player: Player): void {
  const records = Array.from(botRegistry.values());
  if (records.length === 0) {
    player.sendMessage("§e暂无模拟玩家，请先创建");
    return;
  }

  const form = new ActionFormData().title("§l模拟玩家列表").body(`§7共 §b${records.length} §7个`);

  const sorted = [...records].sort((a, b) => {
    const orderA = a.death ? 1 : a.online ? 2 : 0;
    const orderB = b.death ? 1 : b.online ? 2 : 0;
    return orderA - orderB;
  });

  for (const record of sorted) {
    const icon = getStatusIcon(record);
    const dim = record.lastPoint
      ? formatDimensionId(record.lastPoint.dimension)
      : record.deathPoint
        ? formatDimensionId(record.deathPoint.dimension)
        : formatDimensionId(record.respawnPoint.dimension);
    form.button(`${icon} §e${record.name} §7| ${dim}`);
  }

  form.button("§c← 返回主菜单");

  form.show(player).then((response) => {
    if (response.canceled) return;
    if (response.selection === sorted.length) {
      showMainMenu(player);
      return;
    }
    showOperationPanel(player, sorted[response.selection!].name);
  });
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

  const form = new ActionFormData().title(`§l${botName} ${statusText}`).body(`${getPosSummary(record)}${tagStr}`);

  form.button("§6◆ TPHERE — 假人传送到身边"); // 0 - 最常用
  form.button(record.online ? "§b◆ 上线/下线 §a[在线]" : "§7◆ 上线/下线 §7[离线]"); // 1
  form.button("§6◆ 互换主手"); // 2
  form.button("§6◆ 互换装备"); // 3
  form.button("§e◆ 脱下装备"); // 4
  form.button(record.isSneaking ? "§b◆ 潜行 §a[开]" : "§b◆ 潜行 §7[关]"); // 5
  const hasControl = record.tags.includes(TAG_CONTROL.value);
  form.button(hasControl ? "§b◆ 控制 §a[开]" : "§7◆ 控制 §c[关]"); // 6
  form.button("§6◆ 移动"); // 7
  form.button("§6◆ TPA — 传送到假人"); // 8
  form.button("§d◆ 标签"); // 9
  form.button("§a◆ 重生点"); // 10
  form.button("§c◆ 杀死"); // 11
  form.button("§c◆ 删除"); // 12
  form.button("§7← 返回"); // 13

  form.show(player).then((response) => {
    if (response.canceled) return;
    const sel = response.selection!;
    const currentRecord = botRegistry.get(botName);
    if (!currentRecord) {
      player.sendMessage(`§c模拟玩家 §e${botName}§c 已被删除`);
      showBotList(player);
      return;
    }
    const canAct = currentRecord.online && !currentRecord.death;

    switch (sel) {
      case 0: // TPHERE — 假人传送到身边
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        system.run(() => {
          try {
            tpBotToPlayer(currentRecord, player);
            player.sendMessage(`§a已将 §e${botName}§a 传送到身边`);
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 1: // 上线/下线
        system.run(() => {
          try {
            if (currentRecord.online) {
              offlineBot(currentRecord);
              player.sendMessage(`§a§e${botName}§a 已下线`);
            } else {
              onlineBot(currentRecord);
              player.sendMessage(`§a§e${botName}§a 已上线`);
            }
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 2: // 互换主手
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        { const eid = currentRecord.entityId;
          if (!eid) { player.sendMessage("§c无法获取假人实体"); break; }
          const botEnt = world.getEntity(eid);
          if (!botEnt || !botEnt.hasTag(TAG_BOT.value)) { player.sendMessage("§c无法获取假人实体"); break; }
          const bot = botEnt as Player;
          system.run(() => {
            try {
              swapMainhandWithBot(player, bot);
              // 主手变化走 playerInventoryItemChange 事件自动保存，无需显式持久化
              player.sendMessage(`§a已与 §e${botName}§a 互换主手物品`);
            } catch (e: any) {
              player.sendMessage(`§c互换主手失败: ${e.message}`);
            }
          });
        }
        showOperationPanel(player, botName);
        break;
      case 3: // 互换装备
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        { const eid = currentRecord.entityId;
          if (!eid) { player.sendMessage("§c无法获取假人实体"); break; }
          const botEnt = world.getEntity(eid);
          if (!botEnt || !botEnt.hasTag(TAG_BOT.value)) { player.sendMessage("§c无法获取假人实体"); break; }
          const bot = botEnt as Player;
          system.run(() => {
            try {
              swapEquipmentWithBot(player, bot);
              saveBotEquipState(bot, currentRecord);
              player.sendMessage(`§a已与 §e${botName}§a 互换全部装备`);
            } catch (e: any) {
              player.sendMessage(`§c互换装备失败: ${e.message}`);
            }
          });
        }
        showOperationPanel(player, botName);
        break;
      case 4: // 脱下装备
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        { const eid = currentRecord.entityId;
          if (!eid) { player.sendMessage("§c无法获取假人实体"); break; }
          const botEnt = world.getEntity(eid);
          if (!botEnt || !botEnt.hasTag(TAG_BOT.value)) { player.sendMessage("§c无法获取假人实体"); break; }
          const bot = botEnt as Player;
          system.run(() => {
            try {
              unequipBotAll(player, bot);
              saveBotEquipState(bot, currentRecord);
              player.sendMessage(`§a已脱下 §e${botName}§a 的全部装备`);
            } catch (e: any) {
              player.sendMessage(`§c脱下装备失败: ${e.message}`);
            }
          });
        }
        showOperationPanel(player, botName);
        break;
      case 5: // 潜行
        system.run(() => {
          try {
            setSneaking(currentRecord, !currentRecord.isSneaking);
            player.sendMessage(currentRecord.isSneaking ? `§a§e${botName}§a 已潜行` : `§a§e${botName}§a 已站起`);
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 6: // 控制
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        system.run(() => {
          try {
            toggleControl(currentRecord, player);
            player.sendMessage(
              currentRecord.tags.includes(TAG_CONTROL.value)
                ? `§a已开启 §e${botName}§a 控制模式`
                : `§e已关闭 §e${botName}§e 控制模式`
            );
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 7: // 移动
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        showMoveForm(player, botName);
        break;
      case 8: // TPA — 传送到假人
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        system.run(() => {
          try {
            tpPlayerToBot(player, currentRecord);
            player.sendMessage(`§a已传送到 §e${botName}§a 身边`);
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        break;
      case 9: // 标签
        showTagManagement(player, botName);
        break;
      case 10: // 重生点
        system.run(() => {
          try {
            const lookTarget = getPlayerLookTarget(player);
            currentRecord.respawnPoint = {
              location: player.location,
              dimension: player.dimension.id,
              rotation: player.getRotation(),
              lookTarget,
            };
            // 同步设置实体出生点，确保 bot.respawn() 会在正确位置复活
            if (currentRecord.online && currentRecord.entityId) {
              const bot = world.getEntity(currentRecord.entityId);
              if (bot && bot.hasTag(TAG_BOT.value)) {
                (bot as Player).setSpawnPoint({
                  dimension: world.getDimension(currentRecord.respawnPoint.dimension),
                  x: currentRecord.respawnPoint.location.x,
                  y: currentRecord.respawnPoint.location.y,
                  z: currentRecord.respawnPoint.location.z,
                });
              }
            }
            botRegistry.set(currentRecord.name, currentRecord);
            saveBotRecord(currentRecord);
            player.sendMessage(`§a已更新 §e${botName}§a 的重生点`);
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 11: // 杀死
        if (!canAct) {
          player.sendMessage("§c模拟玩家不在线或已死亡");
          break;
        }
        system.run(() => {
          try {
            killBot(currentRecord);
            player.sendMessage(`§a已杀死 §e${botName}`);
          } catch (e: any) {
            player.sendMessage(`§c${e.message}`);
          }
        });
        showOperationPanel(player, botName);
        break;
      case 12: // 删除
        confirmDelete(player, botName);
        break;
      case 13: // 返回
        showBotList(player);
        break;
    }
  });
}
