// ─── 三叉戟投掷 ────────────────────────────────────────
// 扫描背包中所有三叉戟 + 逐把投掷（不含 UI 格式化）
// UI 格式化在 ui/trident.ts 中
// 决策（三叉戟识别/槽位扫描）在 core/rules/items/TridentRules，投掷时序在这里

import { EntityEquippableComponent, EquipmentSlot, ItemStack, Container, system } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { botRegistry } from "../../bootstrap/context";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { pauseFollow, resumeFollow, isFollowing } from "../state/follow";
import { registerPendingTridentItem, discardPendingTridentItem } from "./tridentTracker";
import { TRIDENT_ID, isTrident, scanTridentSlots } from "../../rules/items/TridentRules";
import { inventoryContainerOf } from "../basic/items/ItemComponentRead";

// ─── 投掷互斥（按假人：A 假人投掷不阻塞 B 假人） ─────────
const throwingBots = new Set<string>();

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

  const mainhandSlot = bot.selectedSlotIndex;
  const equip = bot.getComponent("minecraft:equippable") as EntityEquippableComponent | undefined;
  const mainhand = equip?.getEquipment(EquipmentSlot.Mainhand);
  const mainhandIsTrident = !!mainhand && isTrident(mainhand.typeId);

  // 背包（含热栏）数组视图
  const container = getContainer(bot);
  const items: (ItemStack | null)[] = [];
  if (container) {
    for (let i = 0; i < container.size; i++) {
      items.push(container.getItem(i) ?? null);
    }
  }

  const slots = scanTridentSlots(items, mainhandSlot, mainhandIsTrident);

  // 组装回 TridentSlot（附实际物品引用）
  const tridents: TridentSlot[] = slots.map((s) => {
    const item = s.isMainhand && mainhand ? mainhand : items[s.slotIndex];
    return { slotIndex: s.slotIndex, isMainhand: s.isMainhand, item: item! };
  });

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
  return mainhand ? isTrident(mainhand.typeId) : false;
}

// ─── 投掷入口 ──────────────────────────────────────────

/** 投掷结果枚举（多出口：成功 / 各类失败原因） */
export enum ThrowResult {
  /** 投掷一轮完整执行 */
  Ok = "ok",
  /** 投掷已在进行中（防重入） */
  AlreadyThrowing = "already-throwing",
  /** 假人不在线/已死亡/记录不存在 */
  NotOnline = "not-online",
  /** 意外异常 */
  Error = "error",
}

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
 * @param onComplete 兼容回调（Promise resolve 时同样调用，可省略）
 * @returns 多状态结果（见 ThrowResult），永不 reject
 */
export function throwTridents(
  botName: string,
  playerId: string,
  slots: number[],
  onComplete?: () => void,
): Promise<ThrowResult> {
  try {
    if (throwingBots.has(botName)) {
      console.warn(`[MockPlayer] 投掷已在进行中 ${botName}`);
      onComplete?.();
      return Promise.resolve(ThrowResult.AlreadyThrowing);
    }

    const record = botRegistry.get(botName);
    if (!record || !record.online || record.death) {
      onComplete?.();
      return Promise.resolve(ThrowResult.NotOnline);
    }

    throwingBots.add(botName);

    const wasFollowing = isFollowing(botName);
    if (wasFollowing) pauseFollow();

    // 闭包异步：done（doThrowLoop 的 finishThrow 统一出口）时 resolve + 兼容回调
    return new Promise<ThrowResult>((resolve) => {
      const done = () => {
        throwingBots.delete(botName);
        if (wasFollowing) resumeFollow();
        onComplete?.();
        resolve(ThrowResult.Ok);
      };

      system.run(() => doThrowLoop(botName, playerId, slots, done));
    });
  } catch (e: any) {
    // ⚠️ 永不 reject：构造期任何异常（registry/跟随状态读取等）→ 清理标记后 resolve
    console.warn(`[MockPlayer] 投掷启动异常 ${botName}: ${e?.message ?? e}`);
    try { throwingBots.delete(botName); } catch { /* ignore */ }
    onComplete?.();
    return Promise.resolve(ThrowResult.Error);
  }
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
  // ⚠️ 闭包内保持精确 Container 类型（控制流收窄不会贯通异步闭包 → 用非空别名）
  const c: Container = container;

  const mainhandSlot = b.selectedSlotIndex;

  // 保存当前主手物品
  const savedMainhand = c.getItem(mainhandSlot);

  // ⚠️ 收尾统一出口：任何断链路径（实体失效/投掷失败/异常）都必须走到这里，
  // 否则 isThrowing 永久为 true（全服投掷被拒）+ resumeFollow 永不执行（跟随被永久暂停）
  function finishThrow(): void {
    try {
      // 若 savedMainhand 本身就是被投掷的三叉戟（如快速路径），不恢复
      const mainhandConsumed = savedMainhand?.typeId === TRIDENT_ID
        && slots.includes(mainhandSlot);
      restoreMainhand(c, mainhandSlot, mainhandConsumed ? undefined : savedMainhand);
    } catch (e) {
      console.warn(`[MockPlayer] 投掷收尾恢复主手失败: ${e}`);
    }
    onDone();
  }

  // 逐把投掷
  let index = 0;

  function throwNext(): void {
    if (index >= slots.length) {
      finishThrow();
      return;
    }

    const tridentSlot = slots[index++];
    if (tridentSlot === undefined) { throwNext(); return; }
    const tridentItem = c.getItem(tridentSlot);

    if (!tridentItem || !isTrident(tridentItem.typeId)) {
      throwNext();
      return;
    }

    // 投掷前注册物品信息（entitySpawn 消费 → 打 mp:item: tag 供认主 UI 展示附魔）
    registerPendingTridentItem(botName, tridentItem);

    // 换到主手
    if (tridentSlot !== mainhandSlot) {
      c.setItem(mainhandSlot, tridentItem);
      c.setItem(tridentSlot, undefined);
    }
    b.selectedSlotIndex = mainhandSlot;

    // ── 投掷 ──
    // 不扭头：保持假人当前朝向投掷
    system.runTimeout(() => {
      let used = false;
      try {
        used = b.useItemInSlot(mainhandSlot);
      } catch (e) {
        // 实体瞬间失效等异常：丢弃本次物品信息，稍后继续下一把（链不断，最终走到 finishThrow）
        console.warn(`[MockPlayer] ⚠️ useItemInSlot 异常 (slot ${mainhandSlot}): ${e}`);
        discardPendingTridentItem(botName);
        system.runTimeout(throwNext, 20);
        return;
      }
      if (!used) {
        console.warn(`[MockPlayer] ⚠️ useItemInSlot 失败 (slot ${mainhandSlot})`);
        // 投掷未发生：丢弃本次注册的物品信息，防止旧附魔错配到下一把投掷物
        discardPendingTridentItem(botName);
        // 可能已失败，等短时间后继续下一把
        system.runTimeout(throwNext, 20);
        return;
      }
      // 蓄力后释放（trident 约需 15-20 tick 蓄力）
      system.runTimeout(() => {
        try {
          // ⚠️ 实体有效性防护：假人死亡/下线瞬间实体失效 → 收尾整个投掷链
          if (!b.isValid) {
            discardPendingTridentItem(botName);
            finishThrow();
            return;
          }
          b.stopUsingItem();
        } catch {
          // 释放失败时继续（物品信息仍可能被 entitySpawn 消费，不丢弃）
        }
        system.runTimeout(throwNext, 20);
      }, 20);
    }, 2);
  }

  throwNext();
}

// ─── 工具函数 ──────────────────────────────────────────

function getContainer(bot: SimulatedPlayer): Container | undefined {
  return inventoryContainerOf(bot);
}

function restoreMainhand(container: Container, slot: number, saved: ItemStack | undefined): void {
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