// ─── 背包工具候选快照（basic：items 共享读） ────────────
// 将假人背包 profile 为 @yinxe/tool-strategy 引擎候选（ToolCandidate[]）：
// 槽位/typeId/角色/品阶/耐久/附魔——decideTool/decideWeapon 统一入参。
// 旧 ToolItem 快照（snapshotTools）随加权评分实现一并退役。
// 附魔/耐久读取失败按无附魔/无耐久组件（策略保守降级）。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { ItemStack } from "@minecraft/server";

import type { ToolCandidate, ToolRole, EnchantKey } from "@yinxe/tool-strategy/src/index";
import { inventoryContainerOf, enchantableOf, durabilityOf } from "./ItemComponentRead";

// ─── 引擎候选快照（tool-strategy） ─────────────────────

/** 引擎角色识别（typeId 后缀 → ToolRole；非工具 → undefined 不入池） */
export function toolRoleOf(typeId: string): ToolRole | undefined {
  const id = typeId.replace("minecraft:", "");
  if (id.endsWith("_pickaxe")) return "pickaxe";
  if (id.endsWith("_axe")) return "axe";
  if (id.endsWith("_shovel")) return "shovel";
  if (id.endsWith("_hoe")) return "hoe";
  if (id === "shears") return "shears";
  if (id.endsWith("_sword")) return "sword";
  if (id === "trident") return "trident";
  if (id === "bow") return "bow";
  if (id === "crossbow") return "crossbow";
  if (id === "mace") return "mace";
  return undefined;
}

/** 引擎附魔键映射（原版附魔 id → 引擎 EnchantKey；未知忽略） */
const ENCHANT_KEY_MAP: Record<string, EnchantKey> = {
  silk_touch: "silk",
  fortune: "fortune",
  efficiency: "efficiency",
  smite: "smite",
  sharpness: "sharpness",
  unbreaking: "unbreaking",
  mending: "mending",
};

/** 单物品 → 引擎候选（非工具/读取失败 → undefined） */
function profileCandidate(slot: number, item: ItemStack, isCurrent: boolean): ToolCandidate | undefined {
  const role = toolRoleOf(item.typeId);
  if (!role) return undefined; // 非工具不入池（引擎 want 角色甄别兜底）
  const ench = enchantableOf(item);
  const enchants: Partial<Record<EnchantKey, number>> = {};
  try {
    if (ench) {
      for (const e of ench.getEnchantments()) {
        const key = ENCHANT_KEY_MAP[e.type.id];
        if (key) enchants[key] = e.level;
      }
    }
  } catch {
    /* 附魔读取失败按无附魔 */
  }
  // 耐久（不可破坏/无耐久组件 → 0/0 → 满占比，恒不紧急）
  let durability = 0;
  let maxDurability = 0;
  try {
    const dur = durabilityOf(item);
    if (dur) {
      maxDurability = dur.maxDurability;
      durability = Math.max(0, maxDurability - dur.damage);
    }
  } catch {
    /* 耐久读取失败按无耐久组件 */
  }
  return {
    slot,
    typeId: item.typeId,
    role,
    tier: materialTierOf(item.typeId),
    durability,
    maxDurability,
    durabilityRatio: maxDurability > 0 ? durability / maxDurability : 1,
    enchants,
    ...(isCurrent ? { isCurrent: true } : {}),
  };
}

/** typeId → 品阶（1 木 ~ 6 下界合金；剪刀 0；未知 0） */
function materialTierOf(typeId: string): number {
  const map: Record<string, number> = { wooden: 1, stone: 2, iron: 3, golden: 4, diamond: 5, netherite: 6 };
  for (const [k, v] of Object.entries(map)) {
    if (typeId.includes(`_${k}_`) || typeId.endsWith(`_${k}`)) return v;
  }
  return 0;
}

/**
 * 假人背包快照为引擎候选池（ToolCandidate[]，decideTool/decideWeapon 入参）。
 * 含主手候选（isCurrent 标记）；非工具物品不入池。
 * @param bot 假人实体
 * @returns [主手候选（空手/非工具 → undefined）， 背包候选（不含主手槽）]
 */
export function snapshotToolCandidates(
  bot: SimulatedPlayer
): { current: ToolCandidate | undefined; candidates: ToolCandidate[] } {
  const container = inventoryContainerOf(bot);
  if (!container) return { current: undefined, candidates: [] };
  const handSlot = bot.selectedSlotIndex;

  let current: ToolCandidate | undefined;
  const candidates: ToolCandidate[] = [];
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const c = profileCandidate(i, item, i === handSlot);
    if (!c) continue;
    if (i === handSlot) current = c;
    else candidates.push(c);
  }
  return { current, candidates };
}
