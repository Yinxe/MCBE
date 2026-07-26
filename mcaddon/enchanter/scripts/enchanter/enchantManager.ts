import {
  ItemStack,
  EnchantmentType,
  EnchantmentTypes,
  ItemEnchantableComponent,
  Player,
} from "@minecraft/server";
import { ItemAnalysis, EnchantEntry } from "./types";

// ─── 中文名映射（MCBE 未提供本地化 API，仅此部分需手动维护） ──────

const CN: Record<string, string> = {
  aqua_affinity: "水下速掘",
  bane_of_arthropods: "节肢杀手",
  binding: "绑定诅咒",
  blast_protection: "爆炸保护",
  breach: "破甲",
  channeling: "引雷",
  density: "致密",
  depth_strider: "深海探索者",
  efficiency: "效率",
  feather_falling: "摔落保护",
  fire_aspect: "火焰附加",
  fire_protection: "火焰保护",
  flame: "火焰",
  fortune: "时运",
  frost_walker: "冰霜行者",
  impaling: "穿刺",
  infinity: "无限",
  knockback: "击退",
  looting: "抢夺",
  loyalty: "忠诚",
  luck_of_the_sea: "海之眷顾",
  lunge: "突击",
  lure: "饵钓",
  mending: "经验修补",
  multishot: "多重射击",
  piercing: "穿透",
  power: "力量",
  projectile_protection: "弹射物保护",
  protection: "保护",
  punch: "冲击",
  quick_charge: "快速装填",
  respiration: "水下呼吸",
  riptide: "激流",
  sharpness: "锋利",
  silk_touch: "精准采集",
  smite: "亡灵杀手",
  soul_speed: "灵魂疾行",
  swift_sneak: "迅捷潜行",
  thorns: "荆棘",
  unbreaking: "耐久",
  vanishing: "消失诅咒",
  wind_burst: "风爆",
};

/** 取中文名，找不到就返回英文 id */
function cn(id: string): string {
  const stripped = id.replace("minecraft:", "");
  return CN[stripped] ?? stripped;
}

// ─── 运行时附魔缓存 ──────────────────────────────────────────────

/** 获取当前游戏所有可用附魔（运行时动态） */
export function getAllEnchantTypes(): { id: string; name: string; maxLevel: number }[] {
  return EnchantmentTypes.getAll()
    .map((t) => ({
      id: t.id.replace("minecraft:", ""),
      name: cn(t.id),
      maxLevel: t.maxLevel,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

// ─── 物品分析 ──────────────────────────────────────────────────────

export function analyzeHeldItem(player: Player): ItemAnalysis | null {
  const slot = player.getComponent("inventory")?.container?.getSlot(player.selectedSlotIndex);
  if (!slot) return null;
  const item = slot.getItem();
  if (!item) return null;
  return analyzeItem(item);
}

export function analyzeItem(item: ItemStack): ItemAnalysis {
  const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  const enchList = ench?.getEnchantments() ?? [];
  const typeId = item.typeId;

  const enchantments: EnchantEntry[] = enchList.map((e) => {
    const id = e.type.id.replace("minecraft:", "");
    return {
      typeId: id,
      displayName: cn(e.type.id),
      currentLevel: e.level,
      maxVanillaLevel: e.type.maxLevel,
      isOverlimited: e.level > e.type.maxLevel,
    };
  });

  return {
    isValid: isEnchantable(typeId),
    itemName: item.nameTag || typeId.split(":")[1] || "未知",
    itemType: typeId,
    enchantments,
    emptySlots: 0,
  };
}

export function isEnchantable(typeId: string): boolean {
  return /sword|axe|pickaxe|shovel|hoe|helmet|chestplate|leggings|boots|elytra|bow|crossbow|trident|fishing_rod|enchanted_book|book|mace|wolf_armor/.test(typeId);
}

// ─── 附魔铭刻 ──────────────────────────────────────────────────────

export function inscribeEnchant(item: ItemStack, enchantTypeId: string, level: number): string {
  const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!ench) return "§c该物品不支持附魔";

  try {
    ench.addEnchantment({ type: new EnchantmentType(enchantTypeId), level });
    return `§a已铭刻 §f${cn(enchantTypeId)} ${toRoman(level)}`;
  } catch (e: any) {
    return `§c铭刻失败: ${e.message}`;
  }
}

// ─── 附魔超限 ──────────────────────────────────────────────────────

export function overlimitEnchant(item: ItemStack, enchantTypeId: string): string {
  const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!ench) return "§c该物品不支持附魔";

  try {
    const existing = ench.getEnchantment(enchantTypeId);
    const currentLevel = existing ? existing.level : 0;
    const newLevel = Math.min(currentLevel + 1, 10);

    if (existing) ench.removeEnchantment(enchantTypeId);
    ench.addEnchantment({ type: new EnchantmentType(enchantTypeId), level: newLevel });

    return `§a已突破至 §f${cn(enchantTypeId)} ${toRoman(newLevel)}`;
  } catch (e: any) {
    return `§c超限失败: ${e.message}`;
  }
}

// ─── 工具 ──────────────────────────────────────────────────────────

export function getExistingEnchantTypes(item: ItemStack): string[] {
  const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent | undefined;
  if (!ench) return [];
  return ench.getEnchantments().map((e) => e.type.id.replace("minecraft:", ""));
}

function toRoman(n: number): string {
  const map: [number, string][] = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
  let r = "";
  for (const [v, s] of map) while (n >= v) { r += s; n -= v; }
  return r;
}
