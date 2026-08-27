// DEPRECATED: 订阅已内聚至 lifecycle/components/InventoryComponent，外部不再直接调用 register()。存储实现仍保留于此，组件通过 ctx.inventory 委托。

// ─── 库存存储（独立模块，事件驱动 + 对账式兜底） ────────
// 假人库存（背包 36 格 + 装备 5 槽）↔ NBT 木桶阵列槽位绑定存储的业务模块：
//   - 背包单格：playerInventoryItemChange 事件薄壳转发 → saveInventorySlot
//     （isRestored 守卫 + "什么变了"日志；put 分配 / overwrite 覆盖 / 占位保持绑定）
//   - 装备单槽：botEquipSlotChanged 领域事件（互换/穿卸/受伤触发，槽位粒度）
//     → 读实体该槽 → 与指纹快照对比 → **变化才覆盖写绑定槽**（受伤但没变零写入）
//   - 生命周期兜底：reconcile(player, record)（死亡/下线/离开/vaultMode 调用）
//     → 读实体全部槽 → 指纹对比 → **只写变化的格/槽**（不再全量重写 41 格）
//   - 恢复：restoreInto(player, record)（playerJoin / /mp:recover 复用）
// 与 SaveCoordinator 职责分离：后者管记录写 + 全量兜底编排；本模块管
// 物品的增量保存/对账/恢复。槽位按需分配、空位占位保持绑定、仅删除假人释放。

import { world } from "@minecraft/server";
import type { Player, ItemStack } from "@minecraft/server";

import { readDurability, inventoryContainerOf } from "./basic/items/ItemComponentRead";
import { BotEvents } from "../events/DomainEvents";
import type { BotRecord, EquipSlotName } from "../rules/Types";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../rules/Types";
import type { BotRegistry } from "../service/BotRegistry";
import type { BotStore } from "../service/port/BotStore";
import { EQUIP_SLOT_MAP } from "./basic/items/EquipmentSlots";

/** 物品指纹：摘要（typeId|amount|damage|nameTag），用于"变化才写"判定 */
function itemFingerprint(item: ItemStack | null | undefined): string {
  if (!item) return "";
  const damage = readDurability(item)?.damage ?? 0;
  return `${item.typeId}|${item.amount}|${damage}|${item.nameTag ?? ""}`;
}

export class InventoryStorage {
  /** 物品指纹快照：`${botName}:inv:${slot}` / `${botName}:equip:${slot}` → 指纹（上次保存/检查的状态） */
  private readonly snapshots = new Map<string, string>();

  constructor(
    private readonly registry: BotRegistry,
    private readonly store: BotStore<ItemStack>
  ) {}

  /** 订阅装备槽变化领域事件（worldLoad 后调用一次） */
  register(): void {
    BotEvents.botEquipSlotChanged.subscribe((event) => {
      try {
        this.handleEquipSlotChanged(event.botName, event.slot);
      } catch (e: any) {
        console.warn(`[MockPlayer] 装备保存异常 ${event.botName} ${event.slot}: ${e?.message ?? e}`);
      }
    });
  }

  /** 清空某假人的全部指纹快照（删除假人时调用，防内存残留） */
  forget(botName: string): void {
    for (const key of [...this.snapshots.keys()]) {
      if (key.startsWith(`${botName}:`)) {
        this.snapshots.delete(key);
      }
    }
  }

  // ── 背包单格（playerInventoryItemChange 薄壳转发） ──

  /**
   * 背包单格变化保存（事件驱动）。
   * 恢复完成前守卫：假人刚生成/恢复中触发的变化不写（防空背包覆盖真实数据）。
   */
  saveInventorySlot(player: Player, slot: number, item: ItemStack | null, before?: ItemStack | null): void {
    if (!this.registry.isRestored(player.name)) return;
    this.store.saveSlot(player.name, slot, item);
    this.snapshots.set(`${player.name}:inv:${slot}`, itemFingerprint(item));
    if (before || item) {
      console.info(`[MockPlayer] 背包变化 ${player.name} slot=${slot}: ${itemLabel(before)} → ${itemLabel(item)}`);
    }
  }

  // ── 装备单槽（botEquipSlotChanged 事件驱动） ──

  /**
   * 装备槽变化处理：读实体该槽 → 指纹对比 → 变化才覆盖写绑定槽（空位写占位）。
   * 任何触发源（互换/穿卸/受伤/周期兜底）统一走这里，判断收敛单点。
   */
  handleEquipSlotChanged(botName: string, slotName: EquipSlotName): void {
    const record = this.registry.get(botName);
    if (!record) return;
    // 恢复完成前不保存（恢复流程自己写实体，事件在 markRestored 前被守卫拦截）
    if (!this.registry.isRestored(botName)) return;

    // 实体不可达（离线/死亡/未加载）：跳过（全量兜底保存负责离线状态）
    if (!record.entityId) return;
    let entity: any;
    try {
      entity = world.getEntity(record.entityId);
    } catch {
      return;
    }
    if (!entity) return;

    const equip = entity.getComponent("minecraft:equippable");
    if (!equip) return;
    const item = equip.getEquipment(EQUIP_SLOT_MAP[slotName]);

    this.saveEquipSlotIfChanged(botName, slotName, item ?? null);
  }

  // ── 生命周期兜底（对账式全量：只写变化的格/槽） ──

  /**
   * 全量对账保存：读实体全部背包/装备 → 指纹对比 → 只写变化的格/槽。
   * 死亡（entityDie）/下线（offlineBot）/离开（playerLeave）/回收前（reclaim）/
   * 重连周期（vaultMode）等生命周期兜底调用——确保存储 = 实体最终状态，
   * 但**不再全量重写**（事件驱动已实时保存，无变化零写入）。
   */
  reconcile(player: Player, record: BotRecord): void {
    const container = inventoryContainerOf(player);
    if (container) {
      const changes: { slot: number; item: ItemStack | null }[] = [];
      const size = Math.min(container.size, INVENTORY_SIZE);
      for (let i = 0; i < size; i++) {
        const item = container.getItem(i) ?? null;
        const key = `${record.name}:inv:${i}`;
        const fp = itemFingerprint(item);
        if (this.snapshots.get(key) === fp) continue;
        changes.push({ slot: i, item });
        this.snapshots.set(key, fp);
      }
      if (changes.length > 0) {
        this.store.saveSlots?.(record.name, changes);
      }
    }

    const equip = player.getComponent("minecraft:equippable");
    if (equip) {
      const changes: { slot: string; item: ItemStack | null }[] = [];
      for (const slotName of EQUIP_SLOT_NAMES) {
        const item = equip.getEquipment(EQUIP_SLOT_MAP[slotName]) ?? null;
        const key = `${record.name}:equip:${slotName}`;
        const fp = itemFingerprint(item);
        if (this.snapshots.get(key) === fp) continue;
        changes.push({ slot: slotName, item });
        this.snapshots.set(key, fp);
      }
      if (changes.length > 0) {
        this.store.saveEquipSlots?.(record.name, changes);
      }
    }
  }

  // ── 恢复（playerJoin / /mp:recover 复用） ──

  /**
   * 上线恢复：从 NBT 槽复制（get 克隆）真实物品写回假人实体。
   * 占位物品（structure_void）跳过（视为空位）；失败不中断（坏数据跳过）。
   * 恢复后同步指纹快照（实体 = 存储状态），后续事件/对账不再重复写。
   * @returns 是否有任何数据被恢复（背包或装备）
   */
  restoreInto(player: Player, record: BotRecord): boolean {
    let restored = false;

    const savedInv = this.store.loadInventory(record.name);
    if (savedInv) {
      const container = inventoryContainerOf(player);
      if (container) {
        for (let i = 0; i < Math.min(container.size, savedInv.length); i++) {
          container.setItem(i, savedInv[i] ?? undefined);
          this.snapshots.set(`${record.name}:inv:${i}`, itemFingerprint(savedInv[i] ?? null));
        }
        restored = true;
      }
    }

    const savedEquip = this.store.loadEquipment(record.name);
    if (savedEquip) {
      const equip = player.getComponent("minecraft:equippable");
      if (equip) {
        for (const [name, slot] of Object.entries(EQUIP_SLOT_MAP)) {
          const item = savedEquip[name];
          if (item) {
            equip.setEquipment(slot, item);
            this.snapshots.set(`${record.name}:equip:${name}`, itemFingerprint(item));
          }
        }
        restored = true;
      }
    }

    // 恢复 buff（效果）：离线时效果暂停，用最后保存的剩余时长重新施加；
    // 单个效果失败不影响其余（坏数据跳过）
    if (record.effects?.length) {
      try {
        const effectsComp = player.getComponent("minecraft:effects") as any;
        for (const e of record.effects) {
          try {
            effectsComp?.addEffect(e.id, e.duration, { amplifier: e.amplifier });
          } catch {
            // 单个效果恢复失败跳过
          }
        }
        restored = true;
      } catch {
        // 效果组件不可用：跳过（不影响背包/装备恢复）
      }
    }

    return restored;
  }

  // ── 私有 ──

  private saveEquipSlotIfChanged(botName: string, slotName: EquipSlotName, item: ItemStack | null): void {
    const key = `${botName}:equip:${slotName}`;
    const fp = itemFingerprint(item);
    if (this.snapshots.get(key) === fp) return; // 无变化：零写入

    this.store.saveEquipSlot(botName, slotName, item);
    this.snapshots.set(key, fp);
    console.info(`[MockPlayer] 装备变化 ${botName} ${slotName}: ${itemLabel(item)}`);
  }
}

/** 物品 → 简短展示（空位显示"空"） */
function itemLabel(item: ItemStack | null | undefined): string {
  if (!item) return "空";
  return item.amount > 1 ? `${item.typeId.replace("minecraft:", "")}×${item.amount}` : item.typeId.replace("minecraft:", "");
}
