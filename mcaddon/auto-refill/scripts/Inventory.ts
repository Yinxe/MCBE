// ─── 背包端口（Port & Adapter） ────────────────────────
// 唯一封装 @minecraft/server Container I/O 的地方：
//   - 构造：InventoryService.of(player)（含 try/catch，失败返回 undefined）
//   - 读写：主手槽 / 换主手 / 残留堆叠回收
//   - 查找：同类物品 / 指定类别（含最低品质）/ 精准采集工具
//   - 物品元数据：类别判定 / 品质 / 耐久 / 精准采集 / 择优比较
//   - 槽位策略：锁定槽与自定义（非 minecraft:）物品不可换走
// 两端 Manager 都只通过这里操作背包，框架 I/O 与业务解耦，便于 node 单测替身。

import {
  EntityComponentTypes,
  EntityInventoryComponent,
  ItemLockMode,
  type Container,
  type ItemStack,
  type Player,
} from "@minecraft/server";
import { type ToolCandidate, type ToolCategory, type ToolTarget } from "./types";

// ─── 常量 ──────────────────────────────────────────────

/** typeId 前缀 → 品质等级（木 < 石 < 铁 < 金 < 钻石 < 下界合金） */
const TIER_BY_PREFIX: Record<string, number> = {
  wooden: 1,
  stone: 2,
  iron: 3,
  golden: 4,
  diamond: 5,
  netherite: 6,
};

/** 工具类别 → typeId 后缀（兜底用） */
const CATEGORY_SUFFIX: Record<ToolCategory, string> = {
  pickaxe: "_pickaxe",
  axe: "_axe",
  shovel: "_shovel",
  hoe: "_hoe",
  shears: "shears",
};

/** 工具类别 → 物品原生标签（minecraft:is_*，hasTag 主判） */
const CATEGORY_ITEM_TAG: Record<ToolCategory, string> = {
  pickaxe: "minecraft:is_pickaxe",
  axe: "minecraft:is_axe",
  shovel: "minecraft:is_shovel",
  hoe: "minecraft:is_hoe",
  shears: "minecraft:is_shears",
};

/** 近战武器类别与 typeId 后缀（按切换优先级：剑 → 斧 → 镐） */
const WEAPON_SELECTIONS: ReadonlyArray<readonly [name: string, suffix: string]> = [
  ["sword", "_sword"],
  ["axe", "_axe"],
  ["pickaxe", "_pickaxe"],
];

// ─── 物品元数据（静态） ────────────────────────────────

export class InventoryService {
  /** 玩家背包容器 */
  readonly container: Container;

  private constructor(
    private readonly player: Player,
    container: Container,
  ) {
    this.container = container;
  }

  /**
   * 从玩家构造背包服务；取不到背包容器返回 undefined（不中断调用链）。
   * @param player 目标玩家
   */
  static of(player: Player): InventoryService | undefined {
    try {
      const inventory = player.getComponent(EntityComponentTypes.Inventory) as EntityInventoryComponent | undefined;
      if (inventory?.container === undefined) return undefined;
      return new InventoryService(player, inventory.container);
    } catch {
      return undefined;
    }
  }

  /** 主手（快捷栏选中）槽位 */
  mainhandSlot(): number {
    return this.player.selectedSlotIndex;
  }

  /** 主手当前物品 */
  readMainhand(): ItemStack | undefined {
    return this.container.getItem(this.mainhandSlot());
  }

  /**
   * 交换主手与指定槽位（swapItems 原子操作）。
   * @param slot 背包槽位（必须非空）
   */
  swapMainhand(slot: number): boolean {
    try {
      this.container.swapItems(this.mainhandSlot(), slot, this.container);
      return true;
    } catch (e) {
      console.warn(`[AutoRefill] swap failed ${this.player.name}: slot ${slot} - ${e}`);
      return false;
    }
  }

  /**
   * 将槽位残留物堆叠回背包：优先堆叠到已有同类堆，其次空槽（transferItem 原子转移）。
   * @param slot 残留物所在槽位
   * @returns 是否全部放入（true = 槽位已清空）
   */
  stackRemainder(slot: number): boolean {
    try {
      return this.container.transferItem(slot, this.container) === undefined;
    } catch (e) {
      console.warn(`[AutoRefill] stack failed ${this.player.name}: slot ${slot} - ${e}`);
      return false;
    }
  }

  // ─── 查找 ────────────────────────────────────────────

  /**
   * 背包中与指定类型相同的第一个槽位（跳过锁定槽与排除槽位）。
   * @param typeId      目标物品类型
   * @param excludeSlot 排除的槽位（主手）
   */
  findEqualType(typeId: string, excludeSlot: number): number | undefined {
    for (let slot = 0; slot < this.container.size; slot++) {
      if (slot === excludeSlot) continue;
      const item = this.container.getItem(slot);
      if (!item) continue;
      if (item.lockMode === ItemLockMode.slot) continue; // 锁定槽不可移动
      if (item.typeId !== typeId) continue;
      return slot;
    }
    return undefined;
  }

  /**
   * 泛型扫描：按"类别谓词"过滤背包，取品质/耐久最优（跳过锁定与排除槽位）。
   * @param category    物品类别谓词（如"是某类镐 / 是武器 / 带精准采集"）
   * @param minTier     最低品质要求；低于该品质不可入选
   * @param excludeSlot 排除的槽位（主手）
   */
  private scanTools(
    category: (item: ItemStack) => boolean,
    minTier: number | undefined,
    excludeSlot: number,
  ): ToolCandidate | undefined {
    let best: ToolCandidate | undefined;
    for (let slot = 0; slot < this.container.size; slot++) {
      if (slot === excludeSlot) continue;
      const item = this.container.getItem(slot);
      if (!item) continue;
      if (item.lockMode === ItemLockMode.slot) continue; // 锁定槽不可移动
      if (!category(item)) continue;
      const tier = InventoryService.tierOf(item);
      if (tier === undefined) continue;
      if (minTier !== undefined && tier < minTier) continue; // 达不到要求，不可入选
      const candidate: ToolCandidate = { slot, tier, durability: InventoryService.remainingDurability(item) };
      if (!best || InventoryService.isBetter(candidate, best)) best = candidate;
    }
    return best;
  }

  /**
   * 背包中满足指定"工具目标"（类别 + 可选最低品质/精准采集）的最优原版工具。
   * 评分：品质优先、同品质比耐久；跳过锁定与排除槽位。
   * @param target      工具目标（如"精准采集的锄头"）
   * @param excludeSlot 排除的槽位（主手）
   */
  findByTarget(target: ToolTarget, excludeSlot: number): ToolCandidate | undefined {
    return this.scanTools((item) => InventoryService.matchesTarget(item, target), undefined, excludeSlot);
  }

  /**
   * 背包中带精准采集的最优原版工具（任意类别，跨类别按品质/耐久择优）。
   * @param excludeSlot 排除的槽位（主手）
   */
  findSilkTouch(excludeSlot: number): ToolCandidate | undefined {
    return this.scanTools(
      (item) => InventoryService.isVanillaTool(item) && InventoryService.hasSilkTouch(item),
      undefined,
      excludeSlot,
    );
  }

  /**
   * 背包中按优先级（剑 → 斧 → 镐）取最优武器；
   * 首个有货的类别里选品质/耐久最优，跳过锁定与排除槽位。
   * @param excludeSlot 排除的槽位（主手）
   */
  findBestWeapon(excludeSlot: number): ToolCandidate | undefined {
    for (const [, suffix] of WEAPON_SELECTIONS) {
      const best = this.scanTools(
        (item) => item.typeId.startsWith("minecraft:") && item.typeId.endsWith(suffix),
        undefined,
        excludeSlot,
      );
      if (best) return best;
    }
    return undefined;
  }

  /**
   * 主手物品是否可被换走：锁定槽与自定义（非 minecraft: 命名空间）物品都尊重玩家。
   * @param item 主手物品
   */
  slotIsSwappable(item: ItemStack): boolean {
    if (item.lockMode === ItemLockMode.slot) return false; // 锁定：不可移动/不可丢弃
    if (!item.typeId.startsWith("minecraft:")) return false; // 自定义物品
    return true;
  }

  // ─── 物品元数据（静态工具方法） ────────────────────────

  /**
   * 物品是否属于该类别的原版工具。
   * 主判物品原生标签（minecraft:is_pickaxe 等），typeId 后缀兜底——
   * 无需维护物品列表，且能识别挂了对应标签的自定义工具。
   */
  static isVanillaToolOf(item: ItemStack, tool: ToolCategory): boolean {
    const id = item.typeId;
    const suffixOk =
      tool === "shears" ? id === "minecraft:shears" : id.startsWith("minecraft:") && id.endsWith(CATEGORY_SUFFIX[tool]);
    if (suffixOk) return true;
    try {
      return item.hasTag(CATEGORY_ITEM_TAG[tool]);
    } catch {
      return false;
    }
  }

  /** 物品是否满足指定工具目标（类别 + 可选最低品质 + 可选精准采集） */
  static matchesTarget(item: ItemStack, target: ToolTarget): boolean {
    if (!InventoryService.isVanillaToolOf(item, target.category)) return false;
    if (target.minTier !== undefined) {
      const tier = InventoryService.tierOf(item);
      if (tier === undefined || tier < target.minTier) return false;
    }
    if (target.silk && !InventoryService.hasSilkTouch(item)) return false;
    return true;
  }

  /** 是否为任意类别的原版挖掘工具（镐/斧/锹/锄/剪刀） */
  static isVanillaTool(item: ItemStack): boolean {
    const id = item.typeId;
    if (!id.startsWith("minecraft:")) return false;
    if (id === "minecraft:shears") return true;
    return ["_pickaxe", "_axe", "_shovel", "_hoe"].some((suffix) => id.endsWith(suffix));
  }

  /** 是否已持近战武器（剑/斧/镐/三叉戟 或 弓弩）。用于"已持武器则不切换"。 */
  static isWeapon(item: ItemStack): boolean {
    const id = item.typeId;
    if (!id.startsWith("minecraft:")) return false;
    return (
      id.endsWith("_sword") ||
      id.endsWith("_axe") ||
      id.endsWith("_pickaxe") ||
      id === "minecraft:trident" ||
      id === "minecraft:bow" ||
      id === "minecraft:crossbow"
    );
  }

  /** 解析原版工具品质等级；非原版工具返回 undefined */
  static tierOf(item: ItemStack): number | undefined {
    if (item.typeId === "minecraft:shears") return 0;
    const prefix = item.typeId.split(":")[1]?.split("_")[0];
    return prefix ? TIER_BY_PREFIX[prefix] : undefined;
  }

  /** 剩余耐久；无耐久组件视为 0 */
  static remainingDurability(item: ItemStack): number {
    const durability = item.getComponent("minecraft:durability");
    if (!durability) return 0;
    return durability.maxDurability - durability.damage;
  }

  /** 是否带精准采集附魔（minecraft:enchantable 组件查询） */
  static hasSilkTouch(item: ItemStack): boolean {
    try {
      return item.getComponent("minecraft:enchantable")?.hasEnchantment("silk_touch") ?? false;
    } catch {
      return false;
    }
  }

  /** 是否严格优于参考方：品质更高，或同品质更耐久 */
  static isBetter(a: ToolCandidate, b: Pick<ToolCandidate, "tier" | "durability">): boolean {
    return a.tier > b.tier || (a.tier === b.tier && a.durability > b.durability);
  }
}