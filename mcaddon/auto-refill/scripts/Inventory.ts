// ─── 背包端口（Port & Adapter） ────────────────────────
// 唯一封装 @minecraft/server Container I/O 的地方：
//   - 构造：InventoryService.of(player)（含 try/catch，失败返回 undefined）
//   - 读写：主手槽 / 换主手 / 残留堆叠回收
//   - 查找：同类物品 / 按候选特征泛型扫描（scanCandidates，配 ToolProfile）
//   - 物品元数据：品质 / 耐久 / 精准采集 / 武器判定
//   - 槽位策略：锁定槽与自定义（非 minecraft:）物品不可换走
// 两端 Manager 都只通过这里操作背包，框架 I/O 与业务解耦，便于 node 单测替身。

import {
  EntityComponentTypes,
  EntityInventoryComponent,
  EquipmentSlot,
  ItemLockMode,
  type Container,
  type EntityEquippableComponent,
  type ItemStack,
  type Player,
} from "@minecraft/server";
import { type RankableCandidate } from "./types";
import { profile } from "./ToolProfile";
import { logger } from "./Logger";

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

// ─── 物品元数据（静态） ────────────────────────────────

export class InventoryService {
  /** 玩家背包容器 */
  readonly container: Container;

  private constructor(
    private readonly player: Player,
    container: Container
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
      logger.error(`swap failed ${this.player.name}: slot ${slot} - ${e}`);
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
      logger.warn(`stack failed ${this.player.name}: slot ${slot} - ${e}`);
      return false;
    }
  }

  // ─── 副手（equipment） ─────────────────────────────────

  /** 玩家副手当前物品；取不到装备组件或异常返回 undefined */
  readOffhand(): ItemStack | undefined {
    try {
      const equipment = this.player.getComponent(EntityComponentTypes.Equippable) as
        EntityEquippableComponent | undefined;
      return equipment?.getEquipment(EquipmentSlot.Offhand);
    } catch {
      return undefined;
    }
  }

  /**
   * 将背包某槽物品原子迁移到副手（防刷物）：
   *   副手非空 → 返回 false（尊重玩家不覆盖；低版本误报也在此安全短路）；
   *   否则"先铺目标（offhandSlot.setItem 存活句柄）、后清源（container 置空）"——
   *   无论引擎按 move 还是 copy 处理，铺了目标即清源 → 最终仅 1 份，不复制不刷物。
   * @param slot 背包源槽位（必须非空）
   */
  refillOffhand(slot: number): boolean {
    try {
      const equipment = this.player.getComponent(EntityComponentTypes.Equippable) as
        EntityEquippableComponent | undefined;
      if (!equipment) return false;
      const offhandSlot = equipment.getEquipmentSlot(EquipmentSlot.Offhand);
      if (offhandSlot.hasItem()) return false; // 副手非空：尊重玩家，不覆盖
      offhandSlot.setItem(this.container.getItem(slot)); // 先铺目标
      this.container.setItem(slot, undefined); // 后清源
      return true;
    } catch (e) {
      logger.error(`offhand refill failed ${this.player.name}: slot ${slot} - ${e}`);
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
   * 泛型扫描：按"候选特征谓词"过滤背包（跳过锁定槽与排除槽位），返回候选列表。
   * 谓词对 RankableCandidate 判定（达标/角色等），语义由调用方决定；保持槽位
   * 升序返回，供选择引擎进一步排序。
   * @param predicate   候选谓词（如 isMineCapable / 武器角色）
   * @param excludeSlot 排除的槽位（主手）
   */
  scanCandidates(predicate: (c: RankableCandidate) => boolean, excludeSlot: number): RankableCandidate[] {
    const out: RankableCandidate[] = [];
    for (let slot = 0; slot < this.container.size; slot++) {
      if (slot === excludeSlot) continue;
      const item = this.container.getItem(slot);
      if (!item) continue;
      if (item.lockMode === ItemLockMode.slot) continue; // 锁定槽不可移动
      let candidate: RankableCandidate | undefined;
      try {
        candidate = profile(item, slot);
      } catch {
        continue; // 个体物品数据异常 → 跳过，不中断整次扫描
      }
      if (candidate === undefined) continue; // 非工具/武器
      if (!predicate(candidate)) continue;
      out.push(candidate);
    }
    return out;
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

  /** 是否已持近战武器（剑/斧/镐/重锤/三叉戟 或 弓弩）。用于"已持武器则不切换"。 */
  static isWeapon(item: ItemStack): boolean {
    const id = item.typeId;
    if (!id.startsWith("minecraft:")) return false;
    return (
      id.endsWith("_sword") ||
      id.endsWith("_axe") ||
      id.endsWith("_pickaxe") ||
      id === "minecraft:mace" ||
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

  /** 最大耐久；无耐久组件视为 0 */
  static maxDurability(item: ItemStack): number {
    try {
      return item.getComponent("minecraft:durability")?.maxDurability ?? 0;
    } catch {
      return 0;
    }
  }

  /** 是否带精准采集附魔（minecraft:enchantable 组件查询） */
  static hasSilkTouch(item: ItemStack): boolean {
    try {
      return item.getComponent("minecraft:enchantable")?.hasEnchantment("silk_touch") ?? false;
    } catch {
      return false;
    }
  }
}
