// ─── 物品域判定 ────────────────────────────────────────
// 判定一个 typeId 是否为耐久工具/武器（tool）还是消耗品（consumable）。
// 用途：RefillManager 完全消耗分支——耐久工具不会因"使用"消失，工具破碎
// 替换由 ToolManager（playerBreakBlock）负责；此处仅当被使用物品确为
// 消耗品时才补充。与消费分支按主手状态（undefined/副作用残留/其他）的
// 判断配合，共同决定是否补货。

export type ItemDomain = "tool" | "consumable";

/** 判定为耐久工具/武器的 typeId 后缀（带前缀的原版工具以 _xxx 结尾） */
const DURABLE_SUFFIXES = [
  "_pickaxe", "_axe", "_shovel", "_hoe", "_sword",
  "_trident", "_bow", "_crossbow",
] as const;

/** 无前缀的单体耐久物品（整名精确匹配） */
const DURABLE_EXACT = new Set([
  "minecraft:shears",
  "minecraft:trident",
  "minecraft:bow",
  "minecraft:crossbow",
  "minecraft:shield",
  "minecraft:fishing_rod",
  "minecraft:brush",
  "minecraft:elytra",
  "minecraft:flint_and_steel",
  "minecraft:carrot_on_a_stick",
  "minecraft:warped_fungus_on_a_stick",
]);

/**
 * 解析物品属于哪个域（判定主手所有权，杜绝跨域操作）。
 * @param typeId 物品类型 ID
 */
export function resolve(typeId: string): ItemDomain {
  if (!typeId.startsWith("minecraft:")) return "consumable";
  if (DURABLE_EXACT.has(typeId)) return "tool";
  if (DURABLE_SUFFIXES.some((suffix) => typeId.endsWith(suffix))) return "tool";
  return "consumable";
}