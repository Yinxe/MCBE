// ─── 自动工具补充 ──────────────────────────────────────
//
// 监听假人主手工具耐久变化，自动从背包中寻找同类健康工具替换；
// 无可用替代品时将损坏工具移出主手保护，防止工具损坏。
//
// 由 playerInventoryItemChange 事件驱动调用（确认耐久变化会触发该事件）
//
// 触发条件（双重保障）：耐久百分比 < 5%  OR  剩余耐久点数 < 10
//
// 广播：假人名称发送消息通知全体玩家
//
// 决策（工具识别/耐久判定/槽位搜索）在 core/rules/items/ToolDurability，容器读写在这里

import { Player, Container, system, world } from "@minecraft/server";

import { BOT_TAG } from "../../../rules/tags/BotTags";
import { identifyTool, isToolHealthy, findReplacementIndex, findEmptySlotIndex, findAnySlot } from "../../../rules/items/ToolDurability";
import { color } from "@yinxe/toolkit";

// ─── 配置常量 ──────────────────────────────────────────

/** 冷却时间（游戏刻）：防止高频事件导致反复扫描 */
const COOLDOWN_TICKS = 60;

/** 假人名 → 最后一次处理时的 game tick */
const cooldowns = new Map<string, number>();

// ─── 耐久检查（ItemStack 适配） ────────────────────────

const DURABILITY_ID = "minecraft:durability";

/** 从 mc ItemStack 提取耐久组件数值后委托 core isToolHealthy 判定 */
function isToolHealthyItem(item: any): boolean {
  if (!item.hasComponent?.(DURABILITY_ID)) return true;
  const durability = item.getComponent(DURABILITY_ID) as any;
  if (!durability) return true;
  return isToolHealthy(
    durability.damage as number | undefined,
    durability.maxDurability as number | undefined,
    durability.unbreakable as boolean | undefined
  );
}

// ─── 容器交换 ──────────────────────────────────────────

function swapSlots(container: Container, slotA: number, slotB: number): void {
  const itemA = container.getItem(slotA);
  const itemB = container.getItem(slotB);
  container.setItem(slotA, itemB);
  container.setItem(slotB, itemA);
}

// ─── 广播 ──────────────────────────────────────────────

function broadcast(botName: string, message: string): void {
  world.sendMessage(`${color.playerName}[${botName}] ${message}`);
}

// ─── 冷却 ──────────────────────────────────────────────

function isOnCooldown(botName: string): boolean {
  const lastTick = cooldowns.get(botName);
  if (lastTick === undefined) return false;
  return system.currentTick - lastTick < COOLDOWN_TICKS;
}

function markCooldown(botName: string): void {
  cooldowns.set(botName, system.currentTick);
}

// ─── 工具名称辅助 ──────────────────────────────────────

function getItemDisplayName(item: any): string {
  if (item.nameTag) return item.nameTag;
  const id = item.typeId as string;
  const parts = id.split(":");
  if (parts.length >= 2) return parts.slice(1).join(":");
  return id;
}

// ─── 公开入口 ──────────────────────────────────────────

/**
 * 检查假人主手工具耐久，必要时自动替换或保护性收起
 * 由 playerInventoryItemChange 事件回调调用
 *
 * @param bot          假人玩家
 * @param changedSlot  事件中发生变化的槽位（用于提前过滤）
 */
export function checkMainHandDurability(bot: Player, changedSlot: number): void {
  try {
    if (!bot.hasTag(BOT_TAG)) return;

    // 确定当前手部选中的槽位
    const handSlot = bot.selectedSlotIndex;

    // 仅当变化的槽位正是手部槽位时才检查，避免无关槽位变化触发扫描
    if (changedSlot !== handSlot) return;

    // 冷却检查，防止高频事件反复触发
    if (isOnCooldown(bot.name)) return;

    const inv = bot.getComponent("minecraft:inventory") as any;
    if (!inv?.container) return;
    const container = inv.container as Container;

    // 获取主手物品
    const handItem = container.getItem(handSlot);
    if (!handItem) return;

    // 检查是否为受关注的耐久工具
    const toolInfo = identifyTool(handItem.typeId);
    if (!toolInfo) return;

    // 检查耐久是否健康
    if (isToolHealthyItem(handItem)) return;

    // 触发补充，标记冷却
    markCooldown(bot.name);

    const currentName = getItemDisplayName(handItem);

    // 容器 → 数组视图（slots 与 container 一一对应，null = 空位）
    const itemView: any[] = [];
    for (let i = 0; i < container.size; i++) {
      itemView.push(container.getItem(i));
    }

    // 1) 尝试从背包中寻找同类健康工具替换
    const candidate = findReplacementIndex(itemView, handItem.typeId, handSlot, isToolHealthyItem);

    if (candidate !== undefined) {
      // 将候选健康工具换到 slot 0（固定主手位）
      if (candidate === 0) {
        // 健康工具已在主手位（slot 0）：仅切换选中，受损工具留在原槽
        // ⚠️ 原实现 swap(0,0) 自交换会把受损工具留在主手、健康工具挤到原槽
      } else if (handSlot !== 0) {
        swapSlots(container, 0, handSlot); // 受损工具 → slot 0，原 slot 0 物品 → handSlot
        swapSlots(container, 0, candidate); // 健康工具 → slot 0，受损工具 → candidate
      } else {
        swapSlots(container, 0, candidate); // 受损工具在 0（handSlot=0）：与健康工具互换
      }

      const newItem = container.getItem(0);
      const newName = newItem ? getItemDisplayName(newItem) : currentName;
      broadcast(bot.name, `${color.success}工具已自动更换为 ${color.info}${newName}`);
      console.info(`[MockPlayer] 工具补充 ${bot.name}: ${handItem.typeId} → slot ${candidate}`);
    } else {
      // 2) 无可用替代工具 → 保护性移出主手
      const emptySlot = findEmptySlotIndex(itemView, handSlot);
      let targetSlot = emptySlot ?? findAnySlot(handSlot, container.size);
      // ⚠️ 防御：目标槽不能是主手位 slot 0——swap 后受损工具回到主手，保护失效
      if (targetSlot === 0 && handSlot !== 0) {
        for (let i = 1; i < container.size; i++) {
          if (i !== handSlot) { targetSlot = i; break; }
        }
      }

      swapSlots(container, handSlot, targetSlot);
      broadcast(bot.name, `${color.error}${currentName} 耐久不足，背包中无替代工具，已保护性收起`);
      console.info(`[MockPlayer] 工具保护 ${bot.name}: ${handItem.typeId} → slot ${targetSlot}`);
    }

    // 确保主手选中 slot 0（固定主手位）
    bot.selectedSlotIndex = 0;
  } catch (e: any) {
    console.error(`[MockPlayer] 工具补充异常 ${bot?.name ?? "?"}: ${e?.message ?? e}`);
  }
}