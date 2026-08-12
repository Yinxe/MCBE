// ─── 保存协调器（mc 层统一写入口） ─────────────────────
// 所有持久化**写**操作的唯一入口（读操作保持 botStore 直接调用）：
//   - saveRecord      记录写穿（botRegistry.save 的包装）
//   - saveSlot        背包单格（带"什么变了"变化日志）
//   - saveInventory   背包全量
//   - saveEquipment   装备全量
//   - saveFullState   全量状态（背包+装备+经验+记录，含 isBotRestored 守卫）
//   - removeInventory 背包/装备清理（删除/回收清空场景）
//
// 集中收益：恢复标记守卫、变化日志、静默策略、未来防刷物校验全部收敛单点，
// 新保存时机只需调对应方法，不再散落各处直接操作 store。

import type { Player } from "@minecraft/server";

import type { BotRecord, SerializedItemStack } from "../../core/model/Types";
import { captureExperience, serializeContainer, serializeEquipment } from "../adapters/McItemCodec";
import type { BotRegistry } from "../../core/service/BotRegistry";
import type { BotStore } from "../../core/storage/BotStore";

export class SaveCoordinator {
  constructor(
    private readonly registry: BotRegistry,
    private readonly store: BotStore
  ) {}

  /** 记录写穿（高频周期路径传 silent 防刷日志） */
  saveRecord(record: BotRecord, silent = false): void {
    this.registry.save(record, silent);
  }

  /**
   * 背包单格保存（事件驱动）。
   * @param before 变化前的物品（"什么变了"日志用）
   */
  saveSlot(name: string, slot: number, item: SerializedItemStack | null, before?: SerializedItemStack | null): void {
    this.store.saveSlot(name, slot, item);
    if (before || item) {
      console.info(`[MockPlayer] 背包变化 ${name} slot=${slot}: ${itemLabel(before)} → ${itemLabel(item)}`);
    }
  }

  /** 背包全量保存 */
  saveInventory(name: string, items: (SerializedItemStack | null)[]): void {
    this.store.saveInventory(name, items);
  }

  /** 装备全量保存（高频周期路径传 silent 防刷日志） */
  saveEquipment(name: string, equipment: Record<string, SerializedItemStack | null>, silent = false): void {
    this.store.saveEquipment(name, equipment, silent);
  }

  /**
   * 全量状态保存（背包 + 装备 + 经验 + 记录）。
   * 适用：下线（offlineBot）、死亡存储（entityDie）、离开兜底（playerLeave）、
   *      在线回收前（reclaim）、重连周期（vaultMode 经 safeReconnect）。
   * ⚠️ 恢复标记守卫：假人刚生成时背包为空，恢复完成前禁止保存，
   *    否则空背包会覆盖持久化的真实数据（高危漏洞防护）。
   */
  saveFullState(bot: Player, record: BotRecord): void {
    if (!this.registry.isRestored(record.name)) {
      console.warn(`[MockPlayer] ⛔ 全量保存被拦截 ${record.name}——尚未恢复完成`);
      return;
    }

    const inv = bot.getComponent("minecraft:inventory") as any;
    if (inv?.container) {
      this.store.saveInventory(record.name, serializeContainer(inv.container));
    }
    const equip = bot.getComponent("minecraft:equippable") as any;
    if (equip) {
      this.store.saveEquipment(record.name, serializeEquipment(equip));
    }
    record.experience = captureExperience(bot);
    this.registry.save(record);
    console.info(`[MockPlayer] 全量状态保存完成 ${record.name}`);
  }

  /** 背包/装备持久化清理（删除假人、离线回收清空场景） */
  removeInventory(name: string): void {
    this.store.removeInventory(name);
  }
}

/** 物品 → 简短展示（空位显示"空"） */
function itemLabel(item: SerializedItemStack | null | undefined): string {
  if (!item) return "空";
  return item.amount > 1 ? `${item.typeId.replace("minecraft:", "")}×${item.amount}` : item.typeId.replace("minecraft:", "");
}