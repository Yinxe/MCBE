// ─── 三叉戟投掷 ──────────────────────────────────────
// 扫描背包中所有三叉戟，支持模式切换、扭头投掷、主手恢复

import {
  EntityEquippableComponent,
  EquipmentSlot,
  ItemStack,
  system,
  ItemEnchantableComponent,
} from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, resolveBotPlayer } from "./core/persistence";

const TRIDENT_ID = "minecraft:trident";
const SLOT_HOTBAR = 9; // 热栏格数

// ─── 公开类型 ──────────────────────────────────────────

export interface TridentInfo {
  slotIndex: number;
  isMainhand: boolean;
  /** 展示用的格式化标签，如 "§7[热栏1] §f三叉戟 §b锋利III §7(123/250)" */
  label: string;
  customName?: string;
  enchantments: string;
  durability: string;
}

// ─── 扫描背包 ──────────────────────────────────────────

/**
 * 扫描假人全部背包，收集所有三叉戟信息。
 * @returns undefined 表示假人不可用，空数组表示无三叉戟
 */
export function scanTridents(botName: string): TridentInfo[] | undefined {
  const bot = resolveBotPlayer(botName);
  if (!bot) return undefined;

  const tridents: TridentInfo[] = [];
  const mainhandSlot = bot.selectedSlotIndex;
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
  const mainhand = equip?.getEquipment(EquipmentSlot.Mainhand);

  // 主手三叉戟
  if (mainhand?.typeId === TRIDENT_ID) {
    try {
      tridents.push(makeTridentInfo(bot, mainhand, mainhandSlot, true));
    } catch (e) {
      console.warn(`[MockPlayer] ⚠️ 主手三叉戟扫描失败: ${e}`);
    }
  }

  // 背包（含热栏，排除主手已找到的格子）
  const inv = bot.getComponent("minecraft:inventory") as any;
  if (inv?.container) {
    for (let i = 0; i < inv.container.size; i++) {
      if (i === mainhandSlot && mainhand?.typeId === TRIDENT_ID) continue;
      const item = inv.container.getItem(i);
      if (item?.typeId === TRIDENT_ID) {
        try {
          tridents.push(makeTridentInfo(bot, item, i, false));
        } catch (e) {
          console.warn(`[MockPlayer] ⚠️ 背包三叉戟 slot ${i} 扫描失败: ${e}`);
        }
      }
    }
  }

  console.warn(`[MockPlayer] 扫描到 ${tridents.length} 把三叉戟 (${botName})`);
  return tridents;
}

/**
 * 检查主手是否已有三叉戟。
 */
export function isMainhandTrident(botName: string): boolean {
  const bot = resolveBotPlayer(botName);
  if (!bot) return false;
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent;
  const mainhand = equip.getEquipment(EquipmentSlot.Mainhand);
  return mainhand?.typeId === TRIDENT_ID;
}

// ─── 投掷入口 ──────────────────────────────────────────

/**
 * 让假人投掷指定槽位的三叉戟。
 *
 * 保持假人当前朝向投掷，不扭头、不切换模式。
 *
 * @param botName 假人名
 * @param slots 要投掷的三叉戟所在容器槽位数组
 */
export function throwTridents(
  botName: string,
  playerId: string,
  slots: number[],
  onComplete?: () => void,
): void {
  const record = botRegistry.get(botName);
  if (!record || !record.online || record.death) { onComplete?.(); return; }

  // ⚠️ 不切换模式：保持假人当前实体，三叉戟所属权不丢失
  // 扭头已移除，chunkload 模式也可以直接投掷
  system.run(() => doThrowLoop(botName, playerId, slots, onComplete ?? (() => {})));
}

// ─── 投掷循环 ──────────────────────────────────────────

function doThrowLoop(
  botName: string,
  playerId: string,
  slots: number[],
  onDone: () => void,
): void {
  const bot = resolveBotPlayer(botName);
  if (!bot) { onDone(); return; }
  const b = bot;

  const container = getContainer(b);
  if (!container) { onDone(); return; }

  const mainhandSlot = b.selectedSlotIndex;

  // 保存当前主手物品
  const savedMainhand = container.getItem(mainhandSlot);

  // 逐把投掷
  let index = 0;

  function throwNext(): void {
    if (index >= slots.length) {
      // 若 savedMainhand 本身就是被投掷的三叉戟（如快速路径），不恢复
      const mainhandConsumed = savedMainhand?.typeId === TRIDENT_ID
        && slots.includes(mainhandSlot);
      restoreMainhand(container, mainhandSlot, mainhandConsumed ? undefined : savedMainhand);
      onDone();
      return;
    }

    const tridentSlot = slots[index++];
    const tridentItem = container.getItem(tridentSlot);

    if (!tridentItem || tridentItem.typeId !== TRIDENT_ID) {
      throwNext();
      return;
    }

    // 换到主手
    if (tridentSlot !== mainhandSlot) {
      container.setItem(mainhandSlot, tridentItem);
      container.setItem(tridentSlot, undefined);
    }
    b.selectedSlotIndex = mainhandSlot;

    // ── 投掷 ──
    // 不扭头：保持假人当前朝向投掷
    system.runTimeout(() => {
      const used = b.useItemInSlot(mainhandSlot);
      if (!used) {
        console.warn(`[MockPlayer] ⚠️ useItemInSlot 失败 (slot ${mainhandSlot})`);
        // 可能已失败，等短时间后继续下一把
        system.runTimeout(throwNext, 20);
        return;
      }
      // 蓄力后释放（trident 约需 15-20 tick 蓄力）
      system.runTimeout(() => {
        try {
          b.stopUsingItem();
        } catch {
          // 释放失败时继续
        }
        system.runTimeout(throwNext, 20);
      }, 20);
    }, 2);
  }

  throwNext();
}

// ─── 工具函数 ──────────────────────────────────────────

function getContainer(bot: SimulatedPlayer): any {
  const inv = bot.getComponent("minecraft:inventory") as any;
  return inv?.container;
}

function restoreMainhand(container: any, slot: number, saved: ItemStack | undefined): void {
  try {
    if (saved) {
      container.setItem(slot, saved);
    } else {
      const current = container.getItem(slot);
      if (current?.typeId === TRIDENT_ID) {
        // 主手还是三叉戟（投掷失败残留），清空
        container.setItem(slot, undefined);
      }
    }
  } catch {
    // 恢复失败时忽略
  }
}

// ─── 三叉戟信息构建 ────────────────────────────────────

function makeTridentInfo(
  bot: SimulatedPlayer,
  item: ItemStack,
  slotIndex: number,
  isMainhand: boolean,
): TridentInfo {
  const slotLabel = isMainhand
    ? "§e[主手]"
    : slotIndex < SLOT_HOTBAR
      ? `§7[热栏${slotIndex + 1}]`
      : `§7[背包${slotIndex + 1}]`;

  const customName = item.nameTag || undefined;
  const displayName = customName ? `§f${customName}` : "§f三叉戟";

  // 附魔
  const enchParts: string[] = [];
  if (item.hasComponent("minecraft:enchantable")) {
    const ench = item.getComponent("minecraft:enchantable") as ItemEnchantableComponent;
    for (const e of ench.getEnchantments()) {
      const levelNum = e.level;
      const roman = levelToRoman(levelNum);
      enchParts.push(`§b${e.type.id}${roman}`);
    }
  }
  const enchStr = enchParts.length > 0 ? enchParts.join(" ") : "";

  // 耐久
  let durStr: string;
  const dur = item.getComponent("minecraft:durability") as any;
  if (dur) {
    const maxD = dur.maxDurability ?? 250;
    const dmg = dur.damage ?? 0;
    const cur = maxD - dmg;
    const pct = Math.floor((cur / maxD) * 100);
    const color = pct > 50 ? "§a" : pct > 20 ? "§e" : "§c";
    durStr = `${color}(${cur}/${maxD})`;
  } else {
    durStr = "§7(∞)";
  }

  const label = `${slotLabel} ${displayName} ${enchStr} ${durStr}`;

  return { slotIndex, isMainhand, label, customName, enchantments: enchStr, durability: durStr };
}

function levelToRoman(level: number): string {
  const map: Record<number, string> = {
    1: "I", 2: "II", 3: "III", 4: "IV", 5: "V",
    6: "VI", 7: "VII", 8: "VIII", 9: "IX", 10: "X",
  };
  return map[level] || `[${level}]`;
}
