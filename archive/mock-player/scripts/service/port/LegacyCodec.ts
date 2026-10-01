// ─── 旧版物品反序列化（仅迁移用） ─────────────────────
// 旧版本（≤1.1.48）背包/装备以 SerializedItemStack JSON 存 DynamicProperty
// （mockplayer:players:<name>:inv:<N> / :equip:<X>）。
// 升级迁移（bootstrap/migration）需要把它还原成真实 ItemStack 写入
// NBT 木桶阵列。主链路已不序列化（真实物品直存），本文件仅服务迁移。
// 字段格式与旧版一致（1.1.34+ 未变），还原逻辑从旧 McItemCodec 恢复。

import {
  ItemStack,
  ItemEnchantableComponent,
  EnchantmentType,
  Potions,
} from "@minecraft/server";
import type { SerializedItemStack } from "../../rules/Types";

/**
 * 反序列化 SerializedItemStack → ItemStack（旧版格式）。
 * 返回 undefined 表示空位。单物品还原失败（无效 typeId 等）返回 undefined，
 * 由调用方跳过该格（迁移不中断）。
 */
export function deserializeLegacyItem(data: SerializedItemStack | null | undefined): ItemStack | undefined {
  if (!data) return undefined;
  try {
    // 药水物品用 Potions.resolve 创建，确保效果正确
    let item: ItemStack;
    if (data.potionEffectType && data.potionDeliveryType) {
      try {
        item = Potions.resolve(data.potionEffectType, data.potionDeliveryType);
        item.amount = data.amount;
      } catch {
        item = new ItemStack(data.typeId, data.amount);
      }
    } else {
      item = new ItemStack(data.typeId, data.amount);
    }

    // 基础属性
    if (data.nameTag) item.nameTag = data.nameTag;
    if (data.keepOnDeath) item.keepOnDeath = true;
    if (data.lockMode && data.lockMode !== "none") (item as any).lockMode = data.lockMode;
    if (data.lore && data.lore.length > 0) item.setLore(data.lore);
    if (data.canDestroy && data.canDestroy.length > 0) item.setCanDestroy(data.canDestroy);
    if (data.canPlaceOn && data.canPlaceOn.length > 0) item.setCanPlaceOn(data.canPlaceOn);

    // 耐久 / 不可破坏
    if (data.damage !== undefined || data.unbreakable) {
      const d = item.getComponent("minecraft:durability");
      if (d) {
        if (data.damage !== undefined) d.damage = data.damage;
        if (data.unbreakable) d.unbreakable = true;
      }
    }

    // 附魔
    if (data.enchantments && data.enchantments.length > 0 && item.hasComponent("minecraft:enchantable")) {
      const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent;
      for (const e of data.enchantments) {
        try {
          ench.addEnchantment({ type: new EnchantmentType(e.id), level: e.level });
        } catch {
          // 单个附魔添加失败不影响其他
        }
      }
    }

    // 染色
    if (data.color && item.hasComponent("minecraft:dyeable")) {
      const d = item.getComponent("minecraft:dyeable");
      if (d) d.color = { red: data.color.red, green: data.color.green, blue: data.color.blue };
    }

    return item;
  } catch {
    return undefined; // 坏数据：跳过该格（迁移不中断）
  }
}
