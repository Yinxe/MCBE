// ─── 装备原子（装备槽读写与跨实体互换） ──────────────────────────────
// F-10：装备槽无原生变化事件——每次成功写入必须回读 + 外发 botEquipSlotChanged。
// equipFromInventory：背包槽 ↔ 装备槽交叉互换（穿戴/卸下同一原语，
// 旧装备必回背包槽，绝不静默覆盖有物槽）。
// swapWithPlayer：与真人逐槽互换；主手走选中槽互换、不发装备事件（主手非装备槽）。

import type { EntityEquippableComponent, Player } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { EquipSlotName } from "../domain/Record";
import { EQUIP_SLOT_NAMES } from "../domain/Record";
import type { SlotDigest } from "../domain/Fingerprint";
import { EQUIP_SLOT_MAP } from "./EquipSlots";
import { botOf, botValid, inventoryContainer } from "./Atomic";
import { entityGateway } from "./EntityGateway";
import { equipChanged, inventoryChanged } from "./Hooks";

export type EquipResult = "ok" | "occupied" | "empty" | "offline" | "no-component" | "verify-failed";

function digestOf(item: { typeId: string; amount: number } | undefined | null): SlotDigest | null {
  return item ? { typeId: item.typeId, amount: item.amount } : null;
}

function sameDigest(a: SlotDigest | null, b: SlotDigest | null): boolean {
  if (!a || !b) return !a && !b;
  return a.typeId === b.typeId && a.amount === b.amount;
}

function equippableOf(entity: Player): EntityEquippableComponent | undefined {
  try {
    return entity.getComponent("minecraft:equippable");
  } catch {
    return undefined;
  }
}

export class Equpper {
  /** 读装备槽指纹（能力层对账输入） */
  readSlot(botId: number, slot: EquipSlotName): SlotDigest | null {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return null;
    const equip = equippableOf(bot);
    if (!equip) return null;
    try {
      return digestOf(equip.getEquipment(EQUIP_SLOT_MAP[slot]));
    } catch {
      return null;
    }
  }

  /**
   * 背包槽 ↔ 装备槽穿戴互换：invSlot 有物时旧装备回该槽；两边皆空返回 empty；
   * 替换旧装备时背包槽无物 → 拒绝（occupied）——绝不静默覆盖，调用方先腾位。
   */
  equipFromInventory(botId: number, slot: EquipSlotName, invSlot: number, opts: { force?: boolean } = {}): EquipResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const equip = equippableOf(bot);
    const container = inventoryContainer(bot);
    if (!equip || !container) return "no-component";
    const engineSlot = EQUIP_SLOT_MAP[slot];
    const old = equip.getEquipment(engineSlot);
    const incoming = container.getItem(invSlot);
    if (!incoming && !old) return "empty";
    if (old && !opts.force) {
      // 卸旧须有去处：incoming 槽位天然承接（交叉互换），incoming 空则拒绝
      if (!incoming) return "occupied";
    }
    const handDigest = digestOf(incoming);
    const oldDigest = digestOf(old);
    try {
      if (incoming) container.setItem(invSlot, old ?? undefined);
      equip.setEquipment(engineSlot, incoming ?? undefined);
    } catch {
      return "no-component"; // 引擎拒写（非常规槽等）——按不可用处理
    }
    // 回读（F-10 补偿）
    const backEquip = digestOf(equip.getEquipment(engineSlot));
    const backInv = digestOf(container.getItem(invSlot));
    if (!sameDigest(backEquip, handDigest) || (incoming && !sameDigest(backInv, oldDigest))) return "verify-failed";
    equipChanged(botId, slot);
    inventoryChanged(botId);
    return "ok";
  }

  /** 与真人逐槽互换（"all"=五装备槽+主手；单槽名=仅该槽）。@returns 成功互换的槽数 */
  swapWithPlayer(playerName: string, botId: number, scope: EquipSlotName | "all"): number {
    const player = entityGateway.findRealPlayer(playerName);
    if (!player) return 0;
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return 0;
    const pEquip = equippableOf(player);
    const bEquip = equippableOf(bot);
    if (!pEquip || !bEquip) return 0;
    const slots: EquipSlotName[] = scope === "all" ? [...EQUIP_SLOT_NAMES] : [scope];
    let swapped = 0;
    for (const name of slots) {
      const engineSlot = EQUIP_SLOT_MAP[name];
      try {
        const pItem = pEquip.getEquipment(engineSlot);
        const bItem = bEquip.getEquipment(engineSlot);
        pEquip.setEquipment(engineSlot, bItem);
        bEquip.setEquipment(engineSlot, pItem);
        // 回读确认假人侧（真人侧异常不追溯——以假人侧写入成功为准）
        if (sameDigest(digestOf(bEquip.getEquipment(engineSlot)), digestOf(pItem))) {
          swapped++;
          equipChanged(botId, name);
        }
      } catch {
        /* 单槽失败继续其余槽（逐槽容错） */
      }
    }
    if (scope === "all") {
      if (this.swapMainhand(player, bot)) swapped++; // 主手互换不发装备事件
      inventoryChanged(botId);
    }
    return swapped;
  }

  // ─── 私有 ──

  /** 主手=选中槽的跨实体互换（双 setItem 交叉，防吞物） */
  private swapMainhand(player: Player, bot: SimulatedPlayer): boolean {
    const pContainer = player.getComponent("minecraft:inventory")?.container;
    const bContainer = inventoryContainer(bot);
    if (!pContainer || !bContainer) return false;
    const pSlot = player.selectedSlotIndex;
    const bSlot = bot.selectedSlotIndex;
    try {
      const pItem = pContainer.getItem(pSlot);
      const bItem = bContainer.getItem(bSlot);
      if (!pItem && !bItem) return false;
      pContainer.setItem(pSlot, bItem);
      bContainer.setItem(bSlot, pItem);
      return true;
    } catch {
      return false;
    }
  }
}

/** 进程级单例 */
export const equpper = new Equpper();
