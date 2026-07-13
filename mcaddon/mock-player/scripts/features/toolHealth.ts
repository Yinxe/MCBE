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

import { Player, Container, system, world } from "@minecraft/server";

import { BOT_TAG } from "./core/tags";

// ─── 配置常量 ──────────────────────────────────────────

/** 耐久百分比阈值：低于此值触发补充 */
const HEALTH_PERCENT_THRESHOLD = 5;

/** 剩余耐久绝对值阈值：低于此值触发补充（兜底低最大耐久工具，如木剑/钓鱼竿） */
const HEALTH_ABSOLUTE_THRESHOLD = 10;

/** 冷却时间（游戏刻）：防止高频事件导致反复扫描 */
const COOLDOWN_TICKS = 60;

/** 假人名 → 最后一次处理时的 game tick */
const cooldowns = new Map<string, number>();

// ─── 工具识别 ──────────────────────────────────────────

interface ToolPattern {
  suffix: string;
  label: string;
}

const TOOL_PATTERNS: ToolPattern[] = [
  { suffix: "_pickaxe", label: "镐" },
  { suffix: "_axe", label: "斧" },
  { suffix: "_sword", label: "剑" },
  { suffix: "_hoe", label: "锄" },
  { suffix: "_shovel", label: "锹" },
];

/** 判断是否为需关注的耐久工具，返回工具描述信息 */
function identifyTool(typeId: string): ToolPattern | undefined {
  if (typeId === "minecraft:fishing_rod") return { suffix: "fishing_rod", label: "钓鱼竿" };
  if (typeId === "minecraft:trident") return { suffix: "trident", label: "三叉戟" };
  if (typeId === "minecraft:shears") return { suffix: "shears", label: "剪刀" };
  for (const p of TOOL_PATTERNS) {
    if (typeId.endsWith(p.suffix)) return p;
  }
  return undefined;
}

// ─── 耐久检查 ──────────────────────────────────────────

const DURABILITY_ID = "minecraft:durability";

/**
 * 检查物品耐久是否健康
 * 返回 true = 无需处理（健康或非耐久物品）
 * 返回 false = 耐久不足需要补充
 */
function isToolHealthy(item: any): boolean {
  if (!item.hasComponent?.(DURABILITY_ID)) return true;
  const durability = item.getComponent(DURABILITY_ID) as any;
  if (!durability) return true;
  if (durability.unbreakable) return true;

  const maxDmg = durability.maxDurability as number;
  const currentDmg = durability.damage as number;
  const remaining = maxDmg - currentDmg;
  const healthPercent = maxDmg > 0 ? (remaining / maxDmg) * 100 : 100;

  const lowHealth = healthPercent < HEALTH_PERCENT_THRESHOLD;
  const lowAbsolute = remaining < HEALTH_ABSOLUTE_THRESHOLD;
  return !(lowHealth || lowAbsolute);
}

// ─── 背包扫描 ──────────────────────────────────────────

/**
 * 从假人背包中查找与主手工具同类且健康的物品
 * 同类定义：typeId 完全相同（同材料同类型）
 */
function findReplacement(container: Container, typeId: string, excludeSlot: number): { slot: number } | undefined {
  for (let i = 0; i < container.size; i++) {
    if (i === excludeSlot) continue;
    const item = container.getItem(i);
    if (!item) continue;
    if (item.typeId !== typeId) continue;
    if (isToolHealthy(item)) return { slot: i };
  }
  return undefined;
}

/** 查找空 slot（不含排除槽位） */
function findEmptySlot(container: Container, excludeSlot: number): number | undefined {
  for (let i = 0; i < container.size; i++) {
    if (i === excludeSlot) continue;
    if (!container.getItem(i)) return i;
  }
  return undefined;
}

/** 查找任意非排除槽位（36 格背包总能找到一个） */
function findAnySlot(excludeSlot: number, containerSize: number): number {
  for (let i = 0; i < containerSize; i++) {
    if (i !== excludeSlot) return i;
  }
  return 0;
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
  world.sendMessage(`§e[${botName}] ${message}`);
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
    if (isToolHealthy(handItem)) return;

    // 触发补充，标记冷却
    markCooldown(bot.name);

    const currentName = getItemDisplayName(handItem);

    // 1) 尝试从背包中寻找同类健康工具替换
    const candidate = findReplacement(container, handItem.typeId, handSlot);

    if (candidate) {
      // 将候选工具换到 slot 0（固定主手位）
      if (handSlot !== 0) {
        swapSlots(container, 0, handSlot); // 受损工具 → slot 0，原 slot 0 物品 → handSlot
      }
      swapSlots(container, 0, candidate.slot); // 健康工具 → slot 0，受损工具 → candidate.slot

      const newItem = container.getItem(0);
      const newName = newItem ? getItemDisplayName(newItem) : currentName;
      broadcast(bot.name, `§a工具已自动更换为 §f${newName}`);
      console.warn(`[MockPlayer] 工具补充 ${bot.name}: ${handItem.typeId} → slot ${candidate.slot}`);
    } else {
      // 2) 无可用替代工具 → 保护性移出主手
      const emptySlot = findEmptySlot(container, handSlot);
      const targetSlot = emptySlot ?? findAnySlot(handSlot, container.size);

      swapSlots(container, handSlot, targetSlot);
      broadcast(bot.name, `§c${currentName} 耐久不足，背包中无替代工具，已保护性收起`);
      console.warn(`[MockPlayer] 工具保护 ${bot.name}: ${handItem.typeId} → slot ${targetSlot}`);
    }

    // 确保主手选中 slot 0（固定主手位）
    bot.selectedSlotIndex = 0;
  } catch (e: any) {
    console.warn(`[MockPlayer] 工具补充异常 ${bot?.name ?? "?"}: ${e?.message ?? e}`);
  }
}
