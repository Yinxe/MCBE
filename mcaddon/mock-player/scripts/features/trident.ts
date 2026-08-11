// ─── 三叉戟投掷 — 纯业务逻辑 ─────────────────────────────
// 扫描背包中所有三叉戟 + 逐把投掷（不含 UI 格式化）
// UI 格式化在 ui/trident.ts 中

import { EntityEquippableComponent, EquipmentSlot, ItemStack, system } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry, resolveBotPlayer } from "./core/persistence";
import { pauseFollow, resumeFollow, isFollowing } from "./follow";

const TRIDENT_ID = "minecraft:trident";

// ─── 投掷互斥 ──────────────────────────────────────────
let isThrowing = false;

// ─── 公开类型 ──────────────────────────────────────────

export interface TridentSlot {
  slotIndex: number;
  isMainhand: boolean;
  item: ItemStack;
}

// ─── 扫描背包 ──────────────────────────────────────────

/**
 * 扫描假人全部背包，收集所有三叉戟的原始槽位信息。
 * @returns undefined 表示假人不可用，空数组表示无三叉戟
 */
export function scanTridents(botName: string): TridentSlot[] | undefined {
  const bot = resolveBotPlayer(botName);
  if (!bot) return undefined;

  const tridents: TridentSlot[] = [];
  const mainhandSlot = bot.selectedSlotIndex;
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
  const mainhand = equip?.getEquipment(EquipmentSlot.Mainhand);

  // 主手三叉戟
  if (mainhand?.typeId === TRIDENT_ID) {
    tridents.push({ slotIndex: mainhandSlot, isMainhand: true, item: mainhand });
  }

  // 背包（含热栏，排除主手已找到的格子）
  const container = getContainer(bot);
  if (container) {
    for (let i = 0; i < container.size; i++) {
      if (i === mainhandSlot && mainhand?.typeId === TRIDENT_ID) continue;
      const item = container.getItem(i);
      if (item?.typeId === TRIDENT_ID) {
        tridents.push({ slotIndex: i, isMainhand: false, item });
      }
    }
  }

  console.info(`[MockPlayer] 扫描到 ${tridents.length} 把三叉戟 (${botName})`);
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
 * chunkload 模式先切普通模式让假人能投掷（useItemInSlot 需要普通模式），
 * 投掷完成后再恢复原模式。
 * 实体重建导致的三叉戟所属权丢失由 tridentTracker 自动恢复。
 *
 * @param botName 假人名
 * @param playerId 操作玩家 ID
 * @param slots 要投掷的三叉戟所在容器槽位数组
 */
export function throwTridents(
  botName: string,
  playerId: string,
  slots: number[],
  onComplete?: () => void,
): void {
  if (isThrowing) {
    console.warn(`[MockPlayer] 投掷已在进行中 ${botName}`);
    onComplete?.();
    return;
  }

  const record = botRegistry.get(botName);
  if (!record || !record.online || record.death) { onComplete?.(); return; }

  // 常加载模式拒绝投掷（useItemInSlot 需要普通模式）
  if (record.spawnMode === "chunkload") { onComplete?.(); return; }

  isThrowing = true;

  const wasFollowing = isFollowing(botName);
  if (wasFollowing) pauseFollow();

  const done = () => {
    isThrowing = false;
    if (wasFollowing) resumeFollow();
    onComplete?.();
  };

  system.run(() => doThrowLoop(botName, playerId, slots, done));
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
          // ⚠️ 实体有效性防护：假人死亡/下线瞬间实体失效
          if (!b.isValid) return;
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
        container.setItem(slot, undefined);
      }
    }
  } catch {
    // 恢复失败时忽略
  }
}
