// ─── 保存协调器（mc 层统一写入口） ─────────────────────
// 所有持久化**写**操作的唯一入口（读操作保持 botStore 直接调用）：
//   - saveRecord      记录写穿（botRegistry.save 的包装）
//   - saveSlot        背包单格（带"什么变了"变化日志）
//   - saveInventory   背包全量
//   - saveEquipment   装备全量
//   - saveEquipSlot   装备单槽（装备槽变化事件驱动）
//   - saveFullState   全量状态（物品对账 + 经验 + 记录，含 isBotRestored 守卫）
//   - removeInventory 背包/装备清理（删除/回收清空场景）
//
// 集中收益：恢复标记守卫、变化日志、静默策略、防刷物校验全部收敛单点，
// 新保存时机只需调对应方法，不再散落各处直接操作 store。
//
// 物品数据经 NBT 木桶阵列后端（McBotStore）存**真实 ItemStack**（完整 NBT），
// 事件驱动单格/单槽实时保存（InventoryStorage）；saveFullState 的"物品"部分
// 走对账式 reconcile——只写变化的格/槽，不再全量重写。

import type { ItemStack, Player } from "@minecraft/server";

import type { BotRecord } from "../rules/Types";
import { captureExperience, captureEffects } from "../features/basic/McItemCodec";
import type { BotRegistry } from "../service/BotRegistry";
import type { BotStore } from "../service/BotStore";
import type { InventoryStorage } from "../features/inventoryStorage";

export class SaveCoordinator {
  constructor(
    private readonly registry: BotRegistry,
    private readonly store: BotStore<ItemStack>,
    private readonly inventory: InventoryStorage
  ) {}

  /** 记录写穿（高频周期路径传 silent 防刷日志） */
  saveRecord(record: BotRecord, silent = false): void {
    this.registry.save(record, silent);
  }

  /**
   * 背包单格保存（事件驱动，真实 ItemStack 直存）。
   * @param before 变化前的物品（"什么变了"日志用）
   */
  saveSlot(name: string, slot: number, item: ItemStack | null, before?: ItemStack | null): void {
    this.store.saveSlot(name, slot, item);
    if (before || item) {
      console.info(`[MockPlayer] 背包变化 ${name} slot=${slot}: ${itemLabel(before)} → ${itemLabel(item)}`);
    }
  }

  /** 背包全量保存 */
  saveInventory(name: string, items: (ItemStack | null)[]): void {
    this.store.saveInventory(name, items);
  }

  /** 装备全量保存（高频周期路径传 silent 防刷日志） */
  saveEquipment(name: string, equipment: Record<string, ItemStack | null>, silent = false): void {
    this.store.saveEquipment(name, equipment, silent);
  }

  /** 装备单槽保存（装备槽变化事件驱动；空位写入占位保持绑定） */
  saveEquipSlot(name: string, slot: string, item: ItemStack | null): void {
    this.store.saveEquipSlot(name, slot, item);
  }

  /**
   * 全量状态保存（物品对账 + 经验 + 记录）。
   * 适用：下线（offlineBot）、死亡存储（entityDie）、离开兜底（playerLeave）、
   *      在线回收前（reclaim）、重连周期（vaultMode 经 safeReconnect）。
   * 物品部分走 InventoryStorage.reconcile：与指纹快照对比，**只写变化的格/槽**
   * （事件驱动已实时保存，无变化零写入）。
   * ⚠️ 恢复标记守卫：假人刚生成时背包为空，恢复完成前禁止保存，
   *    否则空背包会覆盖持久化的真实数据（高危漏洞防护）。
   */
  saveFullState(bot: Player, record: BotRecord): void {
    if (!this.registry.isRestored(record.name)) {
      console.warn(`[MockPlayer] ⛔ 全量保存被拦截 ${record.name}——尚未恢复完成`);
      return;
    }

    this.inventory.reconcile(bot, record);
    record.experience = captureExperience(bot);
    record.effects = captureEffects(bot); // buff 持久化（排除流程性效果；离线时暂停，恢复时用最后时长）
    this.registry.save(record);
    console.info(`[MockPlayer] 全量状态保存完成 ${record.name}`);
  }

  /** 背包/装备持久化清理（删除假人、离线回收清空场景） */
  removeInventory(name: string): void {
    this.store.removeInventory(name);
  }
}

/** 物品 → 简短展示（空位显示"空"） */
function itemLabel(item: ItemStack | null | undefined): string {
  if (!item) return "空";
  return item.amount > 1 ? `${item.typeId.replace("minecraft:", "")}×${item.amount}` : item.typeId.replace("minecraft:", "");
}