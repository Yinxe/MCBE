// ─── 物品特征提取（Adapter） ───────────────────────────
// 唯一的 ItemStack → RankableCandidate 的地方。角色/达标/etc. 的纯判定在
// ToolScorer，这里只负责把 minecraft ItemStack 的组件读成候选特征向量。
// 组件读取带 try-catch：读不到（自定义物品 / 数据异常）→ 返回 undefined，不中断。

import { type ItemStack } from "@minecraft/server";
import { roleOf } from "./ToolScorer";
import { type RankableCandidate } from "./types";
import { InventoryService } from "./Inventory";

/** 读附魔等级（读不到返回 0，不抛） */
function enchantLevel(item: ItemStack, id: string): number {
  try {
    return item.getComponent("minecraft:enchantable")?.getEnchantment(id)?.level ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 从物品构造候选特征；非工具/武器（方块、食物、杂物）返回 undefined。
 * @param item      目标物品
 * @param slot      所在槽位
 * @param isCurrent 是否为当前主手伪候选
 */
export function profile(item: ItemStack, slot: number, isCurrent = false): RankableCandidate | undefined {
  const role = roleOf(item.typeId);
  if (role === undefined) return undefined;
  const tier = InventoryService.tierOf(item) ?? 0;
  const durability = InventoryService.remainingDurability(item);
  const maxDurability = InventoryService.maxDurability(item);
  const durabilityRatio = maxDurability > 0 ? Math.min(1, durability / maxDurability) : durability > 0 ? 1 : 0;
  const candidate: RankableCandidate = {
    slot,
    typeId: item.typeId,
    role,
    tier,
    durability,
    maxDurability,
    durabilityRatio,
    silk: InventoryService.hasSilkTouch(item),
    efficiency: enchantLevel(item, "efficiency"),
    fortune: enchantLevel(item, "fortune"),
    smite: enchantLevel(item, "smite"),
    sharpness: enchantLevel(item, "sharpness"),
  };
  if (isCurrent) candidate.isCurrent = true;
  return candidate;
}
