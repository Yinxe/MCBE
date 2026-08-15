// ─── 使用物品特征（一次性使用，用后自动停下） ─────────────────
//
// 对齐云梦假人(FlashFakePlayerPack)的实现模型：
//   useItemInSlot(选中槽) = 按下/开始使用（按住：进食/饮用/蓄力弓）
//   stopUsingItem()       = 松开（弓发射/投掷抛出/中止使用）
//
// 本模块做了「用后自动停下」的优化：
//   startUseItem → useItemInSlot 开始使用 → 延迟 USE_AUTO_STOP_DELAY tick → 自动 stopUsingItem。
//   统一时长取 40tick≈2s，一次覆盖全部动作：
//     吃食物/喝药水  ：需要按住 ~1.6s(32tick) 才消耗完 → 40tick 能完整吃完喝完
//     弓/弩          ：满蓄力 20tick，40tick 能满蓄力后自动松开发射
//     投掷类         ：蓄力片刻后自动松开抛出
// 本模块不参与任何 tick 循环，均为主菜单/行为表单触发的单次动作。
// 每个环节都打日志（[MockPlayer] 前缀），方便确认假人到底做了什么。

import { Player, system, world } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { BotRecord } from "../../../rules/Types";
import { BOT_TAG } from "../../../rules/tags/BotTags";
import { BotUiEvent } from "../../../events/UiEvents";
import { botRegistry } from "../../../bootstrap/context";

/**
 * 非食物使用自动停止延时（tick）：弓/弩满蓄力 20tick、投掷类蓄力片刻，40tick(≈2s) 足够覆盖。
 * 普通右键物品（水桶/烟花等）即时生效，等待 40tick 后松开无副作用。
 */
const USE_AUTO_STOP_DELAY = 40;

/**
 * 食物使用自动停止延时（tick）。
 * 调研（Minecraft Wiki）：基岩版食物食用时长——干海带 16tick(0.8s)、
 * 绝大多数食物 32tick(1.6s)、蜂蜜瓶 40tick(2s)；加上 useItemInSlot 启动/动画延迟与
 * 系统调度开销，40tick 的旧统一延时会在进食完成前触发 stopUsingItem →
 * 中途松开 = 取消进食（食物不消耗）。取 80tick(≈4s) 保证所有食物完整吃完再停。
 */
const USE_FOOD_STOP_DELAY = 80;

/** 取在线（且未死亡）的假人实体 */
function resolveBotPlayer(record: BotRecord): SimulatedPlayer | undefined {
  if (!record.online || record.death || !record.entityId) return undefined;
  try {
    const e = world.getEntity(record.entityId);
    return e?.hasTag(BOT_TAG) ? (e as SimulatedPlayer) : undefined;
  } catch {
    return undefined;
  }
}

/** 找一个当前可用的物品槽位：优先当前选中的手；其次快捷栏第一个非空 */
function findUsableSlot(sim: SimulatedPlayer): number {
  try {
    // ⚠️ 组件 ID 必须带 minecraft: 前缀（不带前缀的调用返回 undefined，容器永远拿不到）
    const container = (sim.getComponent("minecraft:inventory") as
      | { container?: { getItem: (i: number) => unknown } }
      | undefined)?.container;
    const sel = sim.selectedSlotIndex ?? 0;
    if (container?.getItem(sel)) return sel;
    for (let i = 0; i < 9; i++) {
      if (container?.getItem(i)) return i;
    }
    return sel;
  } catch {
    return sim.selectedSlotIndex ?? 0;
  }
}

/** 槽位里物品的 typeId（用于日志/校验），取不到返回 undefined */
function slotItemType(sim: SimulatedPlayer, slot: number): string | undefined {
  try {
    const container = (sim.getComponent("minecraft:inventory") as
      | { container?: { getItem: (i: number) => { typeId?: string } } }
      | undefined)?.container;
    return container?.getItem(slot)?.typeId;
  } catch {
    return undefined;
  }
}

/** 槽位物品是否为食物（带 minecraft:food 组件）：食物需要更长按住时间才能吃完 */
function isFoodItem(sim: SimulatedPlayer, slot: number): boolean {
  try {
    const container = (sim.getComponent("minecraft:inventory") as
      | { container?: { getItem: (i: number) => { getComponent?: (id: string) => unknown } } }
      | undefined)?.container;
    return container?.getItem(slot)?.getComponent?.("minecraft:food") !== undefined;
  } catch {
    return false;
  }
}

/** 使用物品结果（多状态，带失败原因） */
export type UseItemResult =
  | "ok"             // 完整执行（按下并自动停止）
  | "offline"        // 假人不在线/已死亡
  | "entity-invalid" // 使用中实体失效（死亡/下线瞬间）
  | "unavailable"    // 主手物品不可用（空手或不能右键使用）
  | "error";         // 意外异常

/**
 * 使用主手物品一次（闭包异步，多状态返回）：
 * system.run 下一 tick 按下（useItemInSlot）→ 延迟后自动松开（stopUsingItem）→ resolve。
 * - 食物：延时 80tick 保证完整吃完再停（中途松开会取消进食）
 * - 弓/弩：满蓄力后自动松开发射；投掷类（药水/附魔瓶/三叉戟）：蓄力片刻后自动抛出
 * @returns 多状态结果（见 UseItemResult），永不 reject
 */
export function useItemOnce(record: BotRecord, player?: Player): Promise<UseItemResult> {
  const sim = resolveBotPlayer(record);
  if (!sim) {
    console.warn(`[MockPlayer] 使用物品：${record.name} 不在线`);
    return Promise.resolve("offline");
  }
  return new Promise<UseItemResult>((resolve) => {
    system.run(() => {
      try {
        // ⚠️ 实体有效性防护：死亡/下线/重连瞬间实体失效，useItemInSlot 会抛 "entity being invalid"
        if (!sim.isValid) { resolve("entity-invalid"); return; }
        const slot = findUsableSlot(sim);
        const item = slotItemType(sim, slot);
        const food = isFoodItem(sim, slot);
        const pressed = sim.useItemInSlot(slot);
        console.warn(`[MockPlayer] 使用物品：${record.name} slot=${slot} 手持=${item ?? "空"} 食物=${food} 开始使用=${pressed}`);
        if (!pressed) {
          player?.sendMessage(`${color.warn}${color.playerName}${record.name}${color.warn} 主手物品当前不可用（空手或不能右键使用）`);
          resolve("unavailable");
          return;
        }
        // 延迟自动松开：给蓄力（弓/弩）充能，用后即自动停止。
        // 食物类延时更长（80tick）——中途松开会取消进食（食物不消耗），必须保证吃完再停。
        const stopDelay = food ? USE_FOOD_STOP_DELAY : USE_AUTO_STOP_DELAY;
        system.runTimeout(() => {
          // ⚠️ 实体有效性防护：假人死亡/下线瞬间实体失效，stopUsingItem 会抛 "entity being invalid"
          if (!sim.isValid) { resolve("entity-invalid"); return; }
          try {
            const released = sim.stopUsingItem();
            console.warn(`[MockPlayer] 使用物品：${record.name} 自动停止(延迟 ${stopDelay}tick, 食物=${food}, 释放=${released?.typeId ?? "无"})`);
            resolve("ok");
          } catch (e: any) {
            console.warn(`[MockPlayer] 使用物品自动停止异常 ${record.name}: ${e?.message ?? e}`);
            resolve("error");
          }
        }, stopDelay);
      } catch (e: any) {
        console.warn(`[MockPlayer] 使用物品异常 ${record.name}: ${e?.message ?? e}`);
        player?.sendMessage(`${color.error}使用物品失败: ${e.message}`);
        resolve("error");
      }
    });
  });
}

/**
 * 开始使用主手物品（一次性动作入口：UI 事件用，fire-and-forget）。
 * 见 useItemOnce（闭包异步版，含完整执行结果）。
 */
export function startUseItem(player: Player, record: BotRecord): void {
  void useItemOnce(record, player);
}

/**
 * 停止使用主手物品（松开）：
 * - 弓：完成蓄力松开发射；投掷类（药水/附魔瓶/三叉戟）：抛出
 * - 食物/饮用中途松开：取消进食（不会消耗）
 * - 无进行中的使用：no-op，安全
 */
export function stopUseItem(player: Player, record: BotRecord): void {
  const sim = resolveBotPlayer(record);
  if (!sim) {
    console.warn(`[MockPlayer] 停止使用：${record.name} 不在线，仅保存开关状态`);
    return;
  }
  system.run(() => {
    try {
      // ⚠️ 实体有效性防护：死亡/下线/重连瞬间实体失效，stopUsingItem 会抛 "entity being invalid"
      if (!sim.isValid) return;
      const released = sim.stopUsingItem();
      console.warn(`[MockPlayer] 停止使用：${record.name} 已停止(释放=${released?.typeId ?? "无"})`);
    } catch (e: any) {
      console.warn(`[MockPlayer] 停止使用异常 ${record.name}: ${e?.message ?? e}`);
      player.sendMessage(`${color.error}停止使用失败: ${e.message}`);
    }
  });
}

// ─── UI 事件订阅（行为菜单提交 → 感知使用物品字段） ─────

/** 订阅行为菜单提交事件：使用物品勾选=使用一次 / 取消=停止（一次性动作，不落库） */
export function registerUiSubscriptions(): void {
  BotUiEvent.behaviorSubmitted.subscribe((e) => {
    const record = botRegistry.get(e.botName);
    if (!record) return;
    const player = world.getEntity(e.playerId) as Player | undefined;
    if (!player) return;
    if (e.useItem) {
      startUseItem(player, record);
    } else {
      stopUseItem(player, record);
    }
  });
}