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

import type { BotRecord } from "../../core/model/Types";
import { BOT_TAG } from "../../core/tags/BotTags";

/** 使用后自动停下前的蓄力/延迟（tick）：饮用/进食需 ~32tick 才完成，取 40tick(≈2s) 一并覆盖 */
const USE_AUTO_STOP_DELAY = 40;

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
    const container = (sim.getComponent("inventory") as
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
    const container = (sim.getComponent("inventory") as
      | { container?: { getItem: (i: number) => { typeId?: string } } }
      | undefined)?.container;
    return container?.getItem(slot)?.typeId;
  } catch {
    return undefined;
  }
}

/**
 * 开始使用主手物品，并在 USE_AUTO_STOP_DELAY tick 后自动停止：
 * - 饮用/进食：按住 ~2s 足够喝完/吃完，随后自动松开
 * - 弓/弩：满蓄力后自动松开发射
 * - 投掷类（药水/附魔瓶/三叉戟）：蓄力片刻后自动抛出
 * - 假人不在线：仅保存调用状态
 */
export function startUseItem(player: Player, record: BotRecord): void {
  const sim = resolveBotPlayer(record);
  if (!sim) {
    console.warn(`[MockPlayer] 使用物品：${record.name} 不在线，仅保存开关状态`);
    return;
  }
  system.run(() => {
    try {
      // ⚠️ 实体有效性防护：死亡/下线/重连瞬间实体失效，useItemInSlot 会抛 "entity being invalid"
      if (!sim.isValid) return;
      const slot = findUsableSlot(sim);
      const item = slotItemType(sim, slot);
      const pressed = sim.useItemInSlot(slot);
      console.warn(`[MockPlayer] 使用物品：${record.name} slot=${slot} 手持=${item ?? "空"} 开始使用=${pressed}`);
      if (!pressed) {
        player.sendMessage(`${color.warn}${color.playerName}${record.name}${color.warn} 主手物品当前不可用（空手或不能右键使用）`);
        return;
      }
      // 延迟自动松开：给蓄力（弓/弩）充能，用后即自动停止
      system.runTimeout(() => {
        // ⚠️ 实体有效性防护：假人死亡/下线瞬间实体失效，stopUsingItem 会抛 "entity being invalid"
        if (!sim.isValid) return;
        try {
          const released = sim.stopUsingItem();
          console.warn(`[MockPlayer] 使用物品：${record.name} 自动停止(延迟 ${USE_AUTO_STOP_DELAY}tick, 释放=${released?.typeId ?? "无"})`);
        } catch (e: any) {
          console.warn(`[MockPlayer] 使用物品自动停止异常 ${record.name}: ${e?.message ?? e}`);
        }
      }, USE_AUTO_STOP_DELAY);
    } catch (e: any) {
      console.warn(`[MockPlayer] 使用物品异常 ${record.name}: ${e?.message ?? e}`);
      player.sendMessage(`${color.error}使用物品失败: ${e.message}`);
    }
  });
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