// ─── 回收假人物品和经验 ────────────────────────────────
// 预览计算/选项判定/离线预览在 core/service/ReclaimPlanner，
// 实体容器读写与实际转移在这里（mc 层）

import { Player, EquipmentSlot, ItemStack, Container, world } from "@minecraft/server";

import { BotRecord, ItemPreview } from "../../rules/Types";
import { BOT_TAG } from "../../rules/tags/BotTags";
import { SWAP_SLOTS } from "../basic/items/EquipmentSlots";
import { captureExperience, itemStackToPreview, serializeItemStack } from "../basic/items/McItemCodec";
import { inventoryContainerOf } from "../basic/items/ItemComponentRead";
import {
  FULL_OPTIONS,
  hasAnyArmor,
  isFullReclaim,
  buildOfflineReclaimPreview,
  buildInventorySummary,
  type ReclaimOptions,
} from "../../service/ReclaimPlanner";
import { botRegistry, botStore, saveCoordinator } from "../../bootstrap/context";
import { color } from "@yinxe/toolkit";

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
 * 生成回收预览，用于表单展示
 * 在线假人从实体读取；离线从持久化读取（core 纯数据计算）
 */
export function getReclaimPreview(record: BotRecord): {
  xp: { level: number; totalXp: number } | null;
  mainhand: ItemPreview | null;
  offhand: ItemPreview | null;
  head: ItemPreview | null;
  chest: ItemPreview | null;
  legs: ItemPreview | null;
  feet: ItemPreview | null;
  inventorySummary: string;
} {
  if (record.online && !record.death) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity?.hasTag(BOT_TAG)) {
      const bot = entity as Player;

      // 经验
      const xpData = record.experience && record.experience.totalXp > 0
        ? { level: record.experience.level, totalXp: record.experience.totalXp }
        : null;

      // 主手
      const invContainer = inventoryContainerOf(bot);
      let mainhand: ItemPreview | null = null;
      if (invContainer) {
        const handSlot = bot.selectedSlotIndex;
        const item = invContainer.getItem(handSlot);
        if (item) mainhand = itemStackToPreview(item);
      }

      // 装备
      const equip = bot.getComponent("minecraft:equippable");
      const equipMap: Record<string, ItemPreview | null> = { head: null, chest: null, legs: null, feet: null, offhand: null };
      if (equip) {
        const slotMap: Record<string, EquipmentSlot> = {
          head: EquipmentSlot.Head, chest: EquipmentSlot.Chest,
          legs: EquipmentSlot.Legs, feet: EquipmentSlot.Feet,
          offhand: EquipmentSlot.Offhand,
        };
        for (const [name, slot] of Object.entries(slotMap)) {
          const item = equip.getEquipment(slot);
          if (item) equipMap[name] = itemStackToPreview(item);
        }
      }

      // 背包略写
      const invCounts: Record<string, number> = {};
      if (invContainer) {
        const handSlot = bot.selectedSlotIndex;
        for (let i = 0; i < invContainer.size; i++) {
          if (i === handSlot) continue;
          const item = invContainer.getItem(i);
          if (!item) continue;
          const shortName = item.typeId.replace("minecraft:", "");
          invCounts[shortName] = (invCounts[shortName] || 0) + item.amount;
        }
      }
      return { xp: xpData, mainhand, offhand: equipMap.offhand, head: equipMap.head, chest: equipMap.chest, legs: equipMap.legs, feet: equipMap.feet, inventorySummary: buildInventorySummary(invCounts) };
    }
  }

  // ── 离线/死亡：从持久化读取（core 纯数据计算；真实物品转预览） ──
  const savedInv = botStore.loadInventory(record.name);
  const savedEquip = botStore.loadEquipment(record.name);
  const invData = savedInv?.map((i) => (i ? serializeItemStack(i) : null));
  const equipData = savedEquip
    ? Object.fromEntries(Object.entries(savedEquip).map(([k, v]) => [k, serializeItemStack(v)]))
    : undefined;
  return buildOfflineReclaimPreview(record, invData, equipData);
}

/**
 * 将物品转移到玩家背包，溢出则掉落
 * @returns 是否成功转移了物品
 */
function transferItemToPlayer(
  item: ItemStack,
  container: Container,
  player: Player,
  result: ReclaimResult,
): void {
  if (!item) return;
  const remainder = container.addItem(item);
  if (remainder) {
    player.dimension.spawnItem(remainder, player.location);
    result.overflow++;
  }
  result.items++;
}

/**
 * 回收假人物品和经验到玩家
 * 在线假人：直接从实体读取（完整 NBT 保留）
 * 离线假人：从持久化数据重建（潜影盒内容已知限制不保留）
 * 物品优先进入玩家背包，溢出掉落在地
 * @param player - 接收物品的玩家
 * @param record - 假人记录
 * @param options - 回收选项，不传则回收全部（删除场景）
 */
export function reclaimBot(player: Player, record: BotRecord, options?: ReclaimOptions): ReclaimResult {
  const opts = options ?? FULL_OPTIONS;
  const result: ReclaimResult = { items: 0, overflow: 0, xp: 0, xpLevel: 0 };

  const pContainer = inventoryContainerOf(player);
  if (!pContainer) throw new Error("无法获取玩家背包");

  // ── 在线 & 非死亡：从实体回收 ──
  if (record.online && !record.death) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (!entity || !entity.hasTag(BOT_TAG)) throw new Error("无法在世界中找到该模拟玩家");
    const bot = entity as Player;

    // 背包 & 主手（背包 36 格，主手是 selectedSlotIndex 对应槽）
    if (opts.inventory || opts.mainhand) {
      const botContainer = inventoryContainerOf(bot);
      if (botContainer) {
        const handSlot = bot.selectedSlotIndex;
        for (let i = 0; i < botContainer.size; i++) {
          const isHand = i === handSlot;
          if (isHand && !opts.mainhand) continue;
          if (!isHand && !opts.inventory) continue;
          const item = botContainer.getItem(i);
          if (!item) continue;
          botContainer.setItem(i, undefined);
          transferItemToPlayer(item, pContainer, player, result);
        }
      }
    }

    // 装备（头/胸/腿/靴 + 副手）
    if (opts.offhand || hasAnyArmor(opts)) {
      const equip = bot.getComponent("minecraft:equippable") as any;
      if (equip) {
        const slotCheck: Record<string, keyof ReclaimOptions> = {
          [EquipmentSlot.Head]: "head",
          [EquipmentSlot.Chest]: "chest",
          [EquipmentSlot.Legs]: "legs",
          [EquipmentSlot.Feet]: "feet",
          [EquipmentSlot.Offhand]: "offhand",
        };
        for (const slot of SWAP_SLOTS) {
          const optKey = slotCheck[slot as string]!;
          if (!opts[optKey]) continue;
          const item = equip.getEquipment(slot);
          if (!item) continue;
          equip.setEquipment(slot, undefined);
          transferItemToPlayer(item, pContainer, player, result);
        }
      }
    }

    // 经验（从实体捕获实际经验，避免记录与实体不同步导致反复回收）
    if (opts.xp) {
      const botXp = captureExperience(bot);
      if (botXp.totalXp > 0) {
        result.xpLevel = botXp.level;
        result.xp = botXp.totalXp;
        try {
          player.addExperience(botXp.totalXp);
          // 必须清除假人实体上的经验，否则 saveBotFullState 会重新捕获并写回记录
          // ⚠️ addExperience(-n) 对 SimulatedPlayer 完全不生效（经验从未被扣过）
          //    resetLevel() 仅 2.6.0+；用 xp 指令清空最保险，全版本可用
          try {
            bot.runCommand("xp -2147483647L");
          } catch {
            const anyBot = bot as any;
            if (typeof anyBot.resetLevel === "function") {
              try { anyBot.resetLevel(); } catch {}
            } else {
              try { anyBot.addLevels(-bot.level); } catch {}
              try { anyBot.addExperience(-bot.xpEarnedAtCurrentLevel); } catch {}
            }
          }
        } catch {}
      }
      record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    }

    // 保存剩余状态到持久化（此时假人实体上的经验已清零）
    saveCoordinator.saveFullState(bot, record);

    // ⚠️ 兜底：saveBotFullState 会重新 captureExperience 覆盖 record.experience。
    //    若实体经验清除失败（低版本 API 限制），此处强制归零，杜绝重复回收
    if (opts.xp) {
      record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    }

  // ── 离线/死亡：从持久化回收（真实 ItemStack，完整 NBT） ──
  } else {
    // 背包（离线时主手位置不可知，假设在 slot 0）
    if (opts.inventory || opts.mainhand) {
      const savedInv = botStore.loadInventory(record.name);
      if (savedInv) {
        // 重建剩余背包（不回收的保留，回收的置空）
        const remainingInv: (ItemStack | null)[] = [];
        for (let i = 0; i < savedInv.length; i++) {
          const isHand = i === 0; // 离线假人假设主手在 slot 0
          if (isHand && !opts.mainhand) { remainingInv.push(savedInv[i]); continue; }
          if (!isHand && !opts.inventory) { remainingInv.push(savedInv[i]); continue; }
          if (!savedInv[i]) { remainingInv.push(null); continue; }
          transferItemToPlayer(savedInv[i]!, pContainer, player, result);
          remainingInv.push(null); // 已回收，清空
        }
        saveCoordinator.saveInventory(record.name, remainingInv);
      }
    }

    // 装备（头/胸/腿/靴 + 副手）
    if (opts.offhand || hasAnyArmor(opts)) {
      const savedEquip = botStore.loadEquipment(record.name) ?? {};
      for (const [slot, item] of Object.entries(savedEquip)) {
        if (!item) continue;
        const optKey = slot as "head" | "chest" | "legs" | "feet" | "offhand";
        if (!opts[optKey]) continue;
        transferItemToPlayer(item, pContainer, player, result);
        delete savedEquip[slot];
      }
      saveCoordinator.saveEquipment(record.name, savedEquip);
    }

    // 经验
    if (opts.xp && record.experience.totalXp > 0) {
      result.xpLevel = record.experience.level;
      result.xp = record.experience.totalXp;
      try { player.addExperience(result.xp); } catch {}
      record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    }

    // 全量回收且无剩余 → 彻底清理持久化
    if (isFullReclaim(opts)) {
      saveCoordinator.removeInventory(record.name);
    }
  }

  saveCoordinator.saveRecord(record);

  return result;
}