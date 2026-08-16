// ─── 物品组件类型化读取（mc 层共享工具） ────────────────
// @minecraft/server 的 getComponent<T>(id) 返回泛型映射的精确组件类型
// （ItemComponentReturnType<T>），但由于 ItemComponentTypeMap 覆盖不全，
// 部分组件（potion/dyeable）仍需显式承载原类型。本模块收敛这些读取，
// 提供类型化、容错的统一入口，消除调用方重复的 `as any` 与 try-catch。

import {
  ItemStack,
  ItemDurabilityComponent,
  ItemEnchantableComponent,
} from "@minecraft/server";

/** 耐久组件空值对齐：无组件返回 null（hasComponent 与 getComponent 分两步判断） */
export function durabilityOf(item: ItemStack): ItemDurabilityComponent | null {
  if (!item.hasComponent("minecraft:durability")) return null;
  return item.getComponent("minecraft:durability") ?? null;
}

/** 附魔组件读取（容错：组件存在但读取出错 → null） */
export function enchantableOf(item: ItemStack): ItemEnchantableComponent | null {
  if (!item.hasComponent("minecraft:enchantable")) return null;
  try {
    return item.getComponent("minecraft:enchantable") ?? null;
  } catch {
    return null;
  }
}

/**
 * 读取耐久数值（容错）。返回 null 表示该物品无耐久组件；
 * 否则返回 { damage, maxDurability, unbreakable }（unbreakable 缺省 false）。
 */
export function readDurability(item: ItemStack): { damage: number; maxDurability: number; unbreakable: boolean } | null {
  const d = durabilityOf(item);
  if (!d) return null;
  try {
    return { damage: d.damage, maxDurability: d.maxDurability, unbreakable: d.unbreakable };
  } catch {
    return null;
  }
}

/** 读取剩余耐久（max - damage）；无耐久组件返回 null。 */
export function remainingDurability(item: ItemStack): number | null {
  const d = readDurability(item);
  if (!d) return null;
  return d.maxDurability - d.damage;
}
