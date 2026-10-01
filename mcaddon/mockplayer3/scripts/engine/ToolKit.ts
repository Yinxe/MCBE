// ─── 背包工具快照与策略换装钩子（"按目标选工具→换主手"的 engine 侧） ──
// ensureTool 由破坏原子每块开挥前调用：全背包扫描取优（domain/pickToolSlot 纯函数），
// 最优槽≠当前主手才置换；破损换件归 ToolGuard，不归这里。
// 挖掘侧按方块选策略（makeEnsureToolForBlock）：目标需工具却背包无合适件时，保持徒手并
// 按 botId 节流外发一条报警（经 Hooks→应用层送主人），掘进不因缺工具停摆。
// 容器/附魔/耐久读取失败按无物品/无附魔/健康处理（不致命）。

import type { ItemStack } from "@minecraft/server";
import type { DurabilitySnapshot } from "../domain/ToolRules";
import type { ToolItem, ToolStrategy } from "../domain/HarvestRules";
import { pickToolSlot, toolCategoryOf, toolStrategyLabel } from "../domain/HarvestRules";
import { botOf, inventoryContainer, itemEnchantments } from "./Atomic";
import { clock } from "./Clock";
import { miningNoToolFired } from "./Hooks";
import { wielder } from "./Wielder";

/** 无工具报警冷却（tick，按 botId 节流——掘进逐格触发，缺冷却会刷屏） */
const NO_TOOL_ALERT_COOLDOWN_TICKS = 200;
/** 各 bot 上次无工具报警时刻 */
const lastNoToolAlert = new Map<number, number>();

/** 工具耐久快照（读不到组件=空对象，domain 侧视为健康） */
function readDurability(item: ItemStack): DurabilitySnapshot {
  try {
    const dur = item.getComponent("minecraft:durability") as { damage?: number; maxDurability?: number } | undefined;
    const unbreakable = item.getComponent("minecraft:unbreakable") !== undefined;
    return { damage: dur?.damage, maxDurability: dur?.maxDurability, unbreakable };
  } catch {
    return {};
  }
}

/** 假人背包工具条目快照（全部槽位；空槽跳过——选工具策略入参） */
export function snapshotTools(botId: number): ToolItem[] {
  const tools: ToolItem[] = [];
  const bot = botOf(botId);
  if (!bot) return tools;
  const container = inventoryContainer(bot);
  if (!container) return tools;
  for (let i = 0; i < container.size; i++) {
    let item;
    try {
      item = container.getItem(i);
    } catch {
      continue;
    }
    if (!item) continue;
    let enchantments: { id: string; level: number }[] = [];
    try {
      enchantments = itemEnchantments(item);
    } catch {
      /* 附魔读取失败按无附魔 */
    }
    tools.push({
      slot: i,
      typeId: item.typeId,
      enchantments,
      category: toolCategoryOf(item.typeId),
      durability: readDurability(item),
    });
  }
  return tools;
}

/**
 * 构造固定策略的 ensureTool 钩子（采集侧一种对象一策略：本钩子忽略 blockTypeId，
 * 只管"全背包选优→非当前主手才置换"；异常由破坏原子侧统一捕获，不影响破坏）。
 */
export function makeEnsureTool(strategy: ToolStrategy): (botId: number, blockTypeId: string) => void {
  return (botId) => {
    const slot = pickToolSlot(strategy, snapshotTools(botId));
    if (slot === undefined) return; // 背包无该策略工具——保持当前主手（徒手也能磨）
    wielder.setMainhand(botId, slot);
  };
}

/**
 * 构造按方块选策略的 ensureTool 钩子（挖掘侧命中格类型逐格变化）：
 * resolveStrategy 返回 undefined 即该方块不可归类——保持当前主手不换装。
 * 目标需工具但背包无合适件时，保持徒手并节流外发一条无工具报警（掘进不停）。
 */
export function makeEnsureToolForBlock(
  resolveStrategy: (blockTypeId: string) => ToolStrategy | undefined
): (botId: number, blockTypeId: string) => void {
  return (botId, blockTypeId) => {
    const strategy = resolveStrategy(blockTypeId);
    if (!strategy) return;
    const slot = pickToolSlot(strategy, snapshotTools(botId));
    if (slot === undefined) {
      alertNoTool(botId, strategy); // 缺该工具——徒手继续挖，节流报警
      return;
    }
    wielder.setMainhand(botId, slot);
  };
}

/** 会话销毁清该假人的无工具报警冷却态（botId 会被复用，不得继承旧时刻） */
export function forgetToolAlert(botId: number): void {
  lastNoToolAlert.delete(botId);
}

/** 无合适工具报警：距上次冷却外发一条，经 Hooks 送应用层 */
function alertNoTool(botId: number, strategy: ToolStrategy): void {
  const now = clock.now();
  const last = lastNoToolAlert.get(botId);
  if (last !== undefined && now - last < NO_TOOL_ALERT_COOLDOWN_TICKS) return;
  lastNoToolAlert.set(botId, now);
  miningNoToolFired(botId, toolStrategyLabel(strategy));
}
