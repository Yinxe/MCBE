// ─── 回收规划（core 层） ────────────────────────────────
// 纯逻辑：回收选项判定、物品预览组装与格式化、离线回收预览计算。
// 实体容器读取与物品实际转移在 mc 层（features/reclaim.ts）。

import type { BotRecord, ItemPreview, ReclaimPreview, SerializedItemStack } from "../rules/Types";
import { formatSerializedEnchantments } from "../rules/format/EnchantZh";

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
export const FULL_OPTIONS: ReclaimOptions = { xp: true, mainhand: true, offhand: true, head: true, chest: true, legs: true, feet: true, inventory: true };

/** 判断是否为全量回收（所有选项均为 true） */
export function isFullReclaim(opts: ReclaimOptions): boolean {
  return !!(opts.xp && opts.mainhand && opts.offhand && opts.head && opts.chest && opts.legs && opts.feet && opts.inventory);
}

/** 获取任意 armor slot 是否勾选 */
export function hasAnyArmor(opts: ReclaimOptions): boolean {
  return !!(opts.head || opts.chest || opts.legs || opts.feet);
}

/** 从 SerializedItemStack 提取 ItemPreview */
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
    parts.push(`§9${formatSerializedEnchantments({ typeId: item.typeId, amount: item.amount, enchantments: item.enchantments })}`);
  }
  return parts.join(" ");
}

/** 背包略写：取前 3 种物品 + "还有 N 种" */
export function buildInventorySummary(counts: Record<string, number>): string {
  const items = Object.entries(counts);
  const entries = items.slice(0, 3).map(([name, amount]) => amount > 1 ? `${name}×${amount}` : name);
  if (items.length > 3) entries.push(`还有${items.length - 3}种`);
  return entries.length > 0 ? entries.join(", ") : "空";
}

/**
 * 离线/死亡假人的回收预览（从持久化数据计算，纯数据版本）
 * 在线假人的预览走 mc 层实体读取分支后，离线分支复用本函数。
 */
export function buildOfflineReclaimPreview(
  record: BotRecord,
  savedInv: (SerializedItemStack | null)[] | undefined,
  savedEquip: Record<string, SerializedItemStack> | undefined
): ReclaimPreview {
  // 主手（离线/死亡假人从持久化读取，假设最早的热键栏格是主手）
  let mainhand: ItemPreview | null = null;
  if (savedInv && savedInv.length > 0) {
    for (let i = 0; i < 9 && i < savedInv.length; i++) {
      const data = savedInv[i];
      if (data) { mainhand = serializedToPreview(data); break; }
    }
  }

  // 装备
  const equipResult: Record<string, ItemPreview | null> = { head: null, chest: null, legs: null, feet: null, offhand: null };
  const slotIds = ["head", "chest", "legs", "feet", "offhand"];
  for (const slot of slotIds) {
    const data = savedEquip?.[slot];
    if (data) equipResult[slot] = serializedToPreview(data);
  }

  // 背包略写（排除主手格）
  const invCounts: Record<string, number> = {};
  if (savedInv) {
    for (let i = 1; i < savedInv.length; i++) {
      const data = savedInv[i];
      if (!data) continue;
      const shortName = data.typeId.replace("minecraft:", "");
      invCounts[shortName] = (invCounts[shortName] || 0) + data.amount;
    }
  }

  const xpData = record.experience?.totalXp > 0
    ? { level: record.experience.level, totalXp: record.experience.totalXp }
    : null;

  return {
    xp: xpData,
    mainhand,
    offhand: equipResult.offhand ?? null,
    head: equipResult.head ?? null,
    chest: equipResult.chest ?? null,
    legs: equipResult.legs ?? null,
    feet: equipResult.feet ?? null,
    inventorySummary: buildInventorySummary(invCounts),
  };
}