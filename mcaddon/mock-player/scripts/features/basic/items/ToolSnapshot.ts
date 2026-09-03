// ─── 背包工具快照（basic：items 共享读） ────────────────
// 将假人背包快照为 rules 层 ToolItem[]（槽位/typeId/附魔/类别）——
// core 选工具策略（WoodcutRules / MineToolRules）统一入参。
// 砍树 flow 与挖掘任务共用；附魔读取失败按无附魔（策略保守降级）。

import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { toolCategoryOf, type ToolItem } from "../../../rules/woodcut/WoodcutRules";
import { inventoryContainerOf, enchantableOf } from "./ItemComponentRead";

/**
 * 将假人背包快照为 ToolItem[]（core 选工具策略入参；所有物品条目——
 * 非工具由 core 评分器甄别排除，快照层不做过滤）。
 * @param bot 假人实体
 * @returns 工具条目数组（背包不可读 → 空数组）
 */
export function snapshotTools(bot: SimulatedPlayer): ToolItem[] {
  const tools: ToolItem[] = [];
  const container = inventoryContainerOf(bot);
  if (!container) return tools;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const typeId = item.typeId;
    const category = toolCategoryOf(typeId); // 统一入口（core）
    const ench = enchantableOf(item);
    let enchantments: { id: string; level: number }[] = [];
    try {
      if (ench) enchantments = ench.getEnchantments().map((e) => ({ id: e.type.id, level: e.level }));
    } catch {
      /* 附魔读取失败按无附魔 */
    }
    tools.push({ slot: i, typeId, enchantments, category });
  }
  return tools;
}
