// ─── 回收假人物品和经验 ────────────────────────────────

import { Player, EquipmentSlot, world, ItemStack } from "@minecraft/server";

import { BotRecord, ItemPreview, SerializedItemStack } from "./core/types";
import { BOT_TAG } from "./core/tags";
import { SWAP_SLOTS } from "./core/types";
import { deserializeItemStack, captureExperience, ENCH_ZH } from "./core/utils";
import { botRegistry, saveBotRecord, loadBotInventory, loadBotEquipment, removeBotInventory, saveBotInventory, saveBotEquipment } from "./core/persistence";
import { saveBotFullState } from "./saveState";
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

export interface ReclaimOptions {
  /** 回收经验等级 */
  xp?: boolean;
  /** 回收主手物品 */
  mainhand?: boolean;
  /** 回收副手物品 */
  offhand?: boolean;
  /** 回收头盔 */
  head?: boolean;
  /** 回收胸甲 */
  chest?: boolean;
  /** 回收护腿 */
  legs?: boolean;
  /** 回收靴子 */
  feet?: boolean;
  /** 回收背包（排除主手） */
  inventory?: boolean;
}

/** 默认选项：回收全部（用于删除场景） */
const FULL_OPTIONS: ReclaimOptions = { xp: true, mainhand: true, offhand: true, head: true, chest: true, legs: true, feet: true, inventory: true };

/** 判断是否为全量回收（所有选项均为 true） */
function isFullReclaim(opts: ReclaimOptions): boolean {
  return !!(opts.xp && opts.mainhand && opts.offhand && opts.head && opts.chest && opts.legs && opts.feet && opts.inventory);
}

/** 获取任意 armor slot 是否勾选 */
export function hasAnyArmor(opts: ReclaimOptions): boolean {
  return !!(opts.head || opts.chest || opts.legs || opts.feet);
}

/**
 * 从 ItemStack 提取 ItemPreview
 */
export function itemStackToPreview(item: ItemStack): ItemPreview {
  const ench: { id: string; level: number }[] = [];
  if (item.hasComponent("minecraft:enchantable")) {
    try {
      const ec = item.getComponent("minecraft:enchantable") as any;
      for (const e of ec.getEnchantments()) {
        ench.push({ id: e.type.id, level: e.level });
      }
    } catch { /* ignore */ }
  }
  let damage: number | undefined;
  let maxDurability: number | undefined;
  const dur = item.getComponent("minecraft:durability") as any;
  if (dur) {
    damage = dur.damage ?? 0;
    maxDurability = dur.maxDurability ?? 0;
  }
  return {
    typeId: item.typeId,
    amount: item.amount,
    nameTag: item.nameTag || undefined,
    damage,
    maxDurability,
    enchantments: ench,
  };
}

/**
 * 从 SerializedItemStack 提取 ItemPreview
 */
export function serializedToPreview(item: SerializedItemStack): ItemPreview {
  return {
    typeId: item.typeId,
    amount: item.amount,
    nameTag: item.nameTag,
    damage: item.damage,
    enchantments: item.enchantments ?? [],
  };
}

/**
 * 格式化 ItemPreview 为展示文本
 */
export function formatItemPreview(item: ItemPreview): string {
  const displayName = item.nameTag || item.typeId.replace("minecraft:", "");
  const parts: string[] = [displayName];
  if (item.amount > 1) parts.push(`x${item.amount}`);
  // 耐久
  if (item.damage !== undefined) {
    const maxD = item.maxDurability ?? 0;
    if (maxD > 0) {
      const cur = maxD - item.damage;
      parts.push(`[${cur}/${maxD}]`);
    } else {
      parts.push(`[耐久${item.damage}]`);
    }
  }
  // 附魔
  if (item.enchantments.length > 0) {
    const enchStr = item.enchantments
      .map((e: { id: string; level: number }) => {
        const zh = (ENCH_ZH as Record<string, string>)[e.id] ?? e.id;
        return `${zh}${levelToRoman(e.level)}`;
      })
      .join(" ");
    parts.push(`§9${enchStr}`);
  }
  return parts.join(" ");
}

function levelToRoman(level: number): string {
  if (level <= 10) return ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][level] ?? `${level}`;
  return `${level}`;
}

/**
 * 生成回收预览，用于表单展示
 * 在线假人从实体读取；离线从持久化读取
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
  const empty: ItemPreview[] = [];
  let inventorySummary = "";

  if (record.online && !record.death) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (entity?.hasTag(BOT_TAG)) {
      const bot = entity as Player;

      // 经验
      const xpData = record.experience && record.experience.totalXp > 0
        ? { level: record.experience.level, totalXp: record.experience.totalXp }
        : null;

      // 主手
      const inv = bot.getComponent("minecraft:inventory") as any;
      let mainhand: ItemPreview | null = null;
      if (inv?.container) {
        const handSlot = bot.selectedSlotIndex;
        const item = inv.container.getItem(handSlot);
        if (item) mainhand = itemStackToPreview(item);
      }

      // 装备
      const equip = bot.getComponent("minecraft:equippable") as any;
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
      let totalExtra = 0;
      if (inv?.container) {
        const handSlot = bot.selectedSlotIndex;
        for (let i = 0; i < inv.container.size; i++) {
          if (i === handSlot) continue;
          const item = inv.container.getItem(i);
          if (!item) continue;
          const shortName = item.typeId.replace("minecraft:", "");
          invCounts[shortName] = (invCounts[shortName] || 0) + item.amount;
          totalExtra++;
        }
      }
      inventorySummary = buildInventorySummary(invCounts);

      return { xp: xpData, mainhand, offhand: equipMap.offhand, head: equipMap.head, chest: equipMap.chest, legs: equipMap.legs, feet: equipMap.feet, inventorySummary };
    }
  }

  // ── 离线/死亡：从持久化读取 ──
  const savedInv = loadBotInventory(record.name);
  const savedEquip = loadBotEquipment(record.name) ?? {};

  // 主手（离线/死亡假人从持久化读取，假设最早的热键栏格是主手）
  // 在线/存活时已从实体读取 selectedSlotIndex，不走此分支
  let mainhand: ItemPreview | null = null;
  if (savedInv && savedInv.length > 0) {
    // savedInv[0] 是热键栏第 0 格（不一定是最新主手，但离线无法确定）
    for (let i = 0; i < 9 && i < savedInv.length; i++) {
      const data = savedInv[i];
      if (data) { mainhand = serializedToPreview(data); break; }
    }
  }

  // 装备
  const slotIds = ["head", "chest", "legs", "feet", "offhand"];
  const equipResult: Record<string, ItemPreview | null> = { head: null, chest: null, legs: null, feet: null, offhand: null };
  for (const slot of slotIds) {
    const data = savedEquip[slot];
    if (data) equipResult[slot] = serializedToPreview(data);
  }

  const invCounts: Record<string, number> = {};
  if (savedInv) {
    for (let i = 1; i < savedInv.length; i++) {
      const data = savedInv[i];
      if (!data) continue;
      const shortName = data.typeId.replace("minecraft:", "");
      invCounts[shortName] = (invCounts[shortName] || 0) + data.amount;
    }
  }
  inventorySummary = buildInventorySummary(invCounts);

  const xpData = record.experience?.totalXp > 0
    ? { level: record.experience.level, totalXp: record.experience.totalXp }
    : null;

  return { xp: xpData, mainhand, offhand: equipResult.offhand, head: equipResult.head, chest: equipResult.chest, legs: equipResult.legs, feet: equipResult.feet, inventorySummary };
}

function buildInventorySummary(counts: Record<string, number>): string {
  const items = Object.entries(counts);
  const entries = items.slice(0, 3).map(([name, amount]) => amount > 1 ? `${name}×${amount}` : name);
  if (items.length > 3) entries.push(`还有${items.length - 3}种`);
  return entries.length > 0 ? entries.join(", ") : "空";
}

/**
 * 将物品转移到玩家背包，溢出则掉落
 * @returns 是否成功转移了物品
 */
function transferItemToPlayer(
  item: any,
  pInv: any,
  player: Player,
  result: ReclaimResult,
): void {
  if (!item) return;
  const remainder = pInv.container.addItem(item);
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

  const pInv = player.getComponent("minecraft:inventory") as any;
  if (!pInv?.container) throw new Error("无法获取玩家背包");

  // ── 在线 & 非死亡：从实体回收 ──
  if (record.online && !record.death) {
    const entity = record.entityId ? world.getEntity(record.entityId) : undefined;
    if (!entity || !entity.hasTag(BOT_TAG)) throw new Error("无法在世界中找到该模拟玩家");
    const bot = entity as Player;

    // 背包 & 主手（背包 36 格，主手是 selectedSlotIndex 对应槽）
    if (opts.inventory || opts.mainhand) {
      const botInv = bot.getComponent("minecraft:inventory") as any;
      if (botInv?.container) {
        const handSlot = bot.selectedSlotIndex;
        for (let i = 0; i < botInv.container.size; i++) {
          const isHand = i === handSlot;
          if (isHand && !opts.mainhand) continue;
          if (!isHand && !opts.inventory) continue;
          const item = botInv.container.getItem(i);
          if (!item) continue;
          botInv.container.setItem(i, undefined);
          transferItemToPlayer(item, pInv, player, result);
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
          transferItemToPlayer(item, pInv, player, result);
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
          bot.addExperience(-botXp.totalXp);
        } catch {}
      }
      record.experience = { level: 0, xpProgress: 0, totalXp: 0 };
    }

    // 保存剩余状态到持久化（此时假人实体上的经验已清零）
    saveBotFullState(bot, record);

  // ── 离线/死亡：从持久化回收 ──
  } else {
    // 背包（离线时主手位置不可知，假设在 slot 0）
    if (opts.inventory || opts.mainhand) {
      const savedInv = loadBotInventory(record.name);
      if (savedInv) {
        // 重建剩余背包（不回收的保留，回收的置空）
        const remainingInv: (typeof savedInv[0])[] = [];
        for (let i = 0; i < savedInv.length; i++) {
          const isHand = i === 0; // 离线假人假设主手在 slot 0
          if (isHand && !opts.mainhand) { remainingInv.push(savedInv[i]); continue; }
          if (!isHand && !opts.inventory) { remainingInv.push(savedInv[i]); continue; }
          if (!savedInv[i]) { remainingInv.push(null); continue; }
          const item = deserializeItemStack(savedInv[i]!);
          if (item) transferItemToPlayer(item, pInv, player, result);
          remainingInv.push(null); // 已回收，清空
        }
        saveBotInventory(record.name, remainingInv);
      }
    }

    // 装备（头/胸/腿/靴 + 副手）
    if (opts.offhand || hasAnyArmor(opts)) {
      const savedEquip = loadBotEquipment(record.name) ?? {};
      for (const [slot, data] of Object.entries(savedEquip)) {
        if (!data) continue;
        const optKey = slot as "head" | "chest" | "legs" | "feet" | "offhand";
        if (!opts[optKey]) continue;
        const item = deserializeItemStack(data);
        if (item) transferItemToPlayer(item, pInv, player, result);
        delete savedEquip[slot];
      }
      saveBotEquipment(record.name, savedEquip);
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
      removeBotInventory(record.name);
    }
  }

  botRegistry.set(record.name, record);
  saveBotRecord(record);

  return result;
}
