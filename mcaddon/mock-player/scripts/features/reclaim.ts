// ─── 回收假人物品和经验 ────────────────────────────────

import { Player, world } from "@minecraft/server";

import { BotRecord } from "./core/types";
import { BOT_TAG } from "./core/tags";
import { SWAP_SLOTS } from "./core/types";
import { deserializeItemStack } from "./core/utils";
import { botRegistry, saveBotRecord, loadBotInventory, loadBotEquipment, removeBotInventory } from "./core/persistence";
import { saveBotFullState } from "./saveState";

export interface ReclaimResult {
  /** 转移物品数 */
  items: number;
  /** 溢出掉落数 */
  overflow: number;
  /** 转移经验值 */
  xp: number;
  /** 转移经验等级 */
  xpLevel: number;
}

/**
 * 回收假人全部物品和经验到玩家
 * 在线假人：直接从实体读取（完整 NBT 保留）
 * 离线假人：从持久化数据重建（潜影盒内容已知限制不保留）
 * 物品优先进入玩家背包，溢出掉落在地
 */
export function reclaimBot(player: Player, record: BotRecord): ReclaimResult {
  const result: ReclaimResult = { items: 0, overflow: 0, xp: 0, xpLevel: 0 };

  const pInv = player.getComponent("minecraft:inventory") as any;
  if (!pInv?.container) throw new Error("无法获取玩家背包");

  // ── 从实体回收（在线 & 非死亡） ──
  if (record.online && !record.death) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (!entity || !entity.hasTag(BOT_TAG)) throw new Error("无法在世界中找到该模拟玩家");
    const bot = entity as Player;

    // 背包 36 格
    const botInv = bot.getComponent("minecraft:inventory") as any;
    if (botInv?.container) {
      for (let i = 0; i < botInv.container.size; i++) {
        const item = botInv.container.getItem(i);
        if (!item) continue;
        botInv.container.setItem(i, undefined);
        const remainder = pInv.container.addItem(item);
        if (remainder) {
          player.dimension.spawnItem(remainder, player.location);
          result.overflow++;
        }
        result.items++;
      }
    }

    // 装备 5 槽（头/胸/腿/靴/副手，主手已在背包中）
    const equip = bot.getComponent("minecraft:equippable") as any;
    if (equip) {
      for (const slot of SWAP_SLOTS) {
        const item = equip.getEquipment(slot);
        if (!item) continue;
        equip.setEquipment(slot, undefined);
        const remainder = pInv.container.addItem(item);
        if (remainder) {
          player.dimension.spawnItem(remainder, player.location);
          result.overflow++;
        }
        result.items++;
      }
    }

    // 经验
    result.xpLevel = record.experience.level;
    result.xp = record.experience.totalXp;
    if (result.xp > 0) {
      try { player.addExperience(result.xp); } catch {}
    }

    // 清空假人状态
    record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    saveBotFullState(bot, record);

  // ── 从持久化回收（离线/死亡） ──
  } else {
    // 背包
    const savedInv = loadBotInventory(record.name);
    if (savedInv) {
      for (const data of savedInv) {
        if (!data) continue;
        const item = deserializeItemStack(data);
        if (!item) continue;
        const remainder = pInv.container.addItem(item);
        if (remainder) {
          player.dimension.spawnItem(remainder, player.location);
          result.overflow++;
        }
        result.items++;
      }
    }

    // 装备
    const savedEquip = loadBotEquipment(record.name);
    if (savedEquip) {
      for (const data of Object.values(savedEquip)) {
        if (!data) continue;
        const item = deserializeItemStack(data);
        if (!item) continue;
        const remainder = pInv.container.addItem(item);
        if (remainder) {
          player.dimension.spawnItem(remainder, player.location);
          result.overflow++;
        }
        result.items++;
      }
    }

    // 经验
    result.xpLevel = record.experience.level;
    result.xp = record.experience.totalXp;
    if (result.xp > 0) {
      try { player.addExperience(result.xp); } catch {}
    }

    // 清空持久化数据
    removeBotInventory(record.name);
    record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);

  return result;
}
