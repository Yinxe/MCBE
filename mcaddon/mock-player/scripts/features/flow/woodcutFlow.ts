// ─── 单棵树的砍伐流程（mc 层：woodcut flow） ────────────
// chopOneTree：按 ChopPlan（core 纯逻辑）顺序砍伐一棵已认领的树——
//   阶段编排（用户规格 2026-08-18）：
//     1. 逐目标：靠近（超出挖掘范围 → 导航缩短距离）→ 按模式/目标自动换工具
//       （圆木/原木模式树叶 → 斧头策略；收集模式树叶 → 树叶策略强制应用）
//       → breakBlockOnce 破坏 → 未破坏（far/busy）重试
//     2. 圆木卡叶清理已并入 plan（stuck-cleanup：破树叶让掉落物掉下来）
//     3. 拾取：树范围（pickupRegion）内扫描掉落物实体 → 逐个靠近自动拾取
//
// ⚠️ 本流程为 mc 适配层：core 已由 ChopPlan / WoodcutRules 覆盖并可单测，
//   这里的副作用（导航/破块/换工具/拾取）按 fishingFlow 风格**永不 reject**。
// ⚠️ 工具策略：选工具前从假人**全背包**快照构造 ToolItem（强制策略即靠
//   全背包扫描取最优实现）；未找到匹配工具 → 不换（用当前主手）。

import type { Entity } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { breakBlockOnce } from "../basic/blocks";
import { navigateBot, longNavigateBot, NavigateResult } from "../basic/move";
import { setMainhandSlot } from "../basic/items/mainhand";
import { inventoryContainerOf, enchantableOf } from "../basic/items/ItemComponentRead";
import { waitTicks } from "../utils";
import {
  pickBestTool,
  type ChopMode,
  type ChopTargetKind,
  type ToolItem,
} from "../../rules/woodcut/WoodcutRules";
import type { ChopPlan, ChopTarget } from "../../rules/woodcut/ChopPlan";

// ─── 结果类型 ──────────────────────────────────────────

/** 砍树失败原因 */
export type WoodcutFailureReason = "offline" | "aborted" | "error";

/** 一次砍树流程结果 */
export type WoodcutOutcome =
  | { kind: "done"; broken: number; picked: number }
  | { kind: "failed"; reason: WoodcutFailureReason };

// ─── 常量 ──────────────────────────────────────────────

/** 破坏距离（格，3D 自检；超距 → 靠近后再挖） */
const BREAK_MAX_DISTANCE = 6;
/** 靠近目标后破坏前的微调容差（格）：已够近即可开挖 */
const BREAK_NEAR_DISTANCE = 5;
/** 拾取扫描半径（格，包围盒中心附近） */
const PICKUP_QUERY_RADIUS = 4;
/** 拾取等待（tick，靠近后等物品自动吸入背包） */
const PICKUP_WAIT_TICKS = 10;
/** 拾取轮次上限（防物品异常不可拾取死循环） */
const PICKUP_MAX_PASSES = 3;
/** 单目标破坏重试上限 */
const BREAK_RETRY_LIMIT = 3;

// ─── 背包工具快照（强制策略：全背包扫描取最优） ──────────

/** 将假人背包快照为 ToolItem[]（core 选工具策略入参；所有匹配工具条目） */
function snapshotTools(bot: SimulatedPlayer): ToolItem[] {
  const tools: ToolItem[] = [];
  const container = inventoryContainerOf(bot);
  if (!container) return tools;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const typeId = item.typeId;
    const category: ToolItem["category"] = typeId.endsWith("_axe")
      ? "axe"
      : typeId.endsWith("_hoe")
        ? "hoe"
        : typeId === "minecraft:shears"
          ? "shears"
          : "axe"; // 兜底归 axe 类别（非工具不被选——评分器按类别与附魔甄别）
    const ench = enchantableOf(item);
    let enchantments: { id: string; level: number }[] = [];
    try {
      if (ench) enchantments = ench.getEnchantments().map((e) => ({ id: e.type.id, level: e.level }));
    } catch {
      /* 附魔读取失败按无附魔 */
    }
    tools.push({ slot: i, typeId, enchantments, category });
  }
  return tools;
}

/** 目标方块是否已消失（空气/液体——原方块已破坏，跳过） */
function targetGone(bot: SimulatedPlayer, target: ChopTarget): boolean {
  try {
    const block = bot.dimension.getBlock(target.loc);
    if (!block) return true;
    return block.isAir || block.isLiquid;
  } catch {
    return false;
  }
}

/** 3D 距离（blockBreakOnce 同款） */
function distance3d(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 拾取区域内最近掉落物实体（minecraft:item） */
function nearestDrops(dimension: Entity["dimension"], center: { x: number; y: number; z: number }): Entity[] {
  try {
    return dimension.getEntities({ type: "minecraft:item", location: center, maxDistance: PICKUP_QUERY_RADIUS });
  } catch {
    return [];
  }
}

// ─── 阶段实现 ──────────────────────────────────────────

/** 破坏单个目标：靠近（若超距）→ 换工具 → 破坏；未破坏重试 */
async function breakTarget(botName: string, bot: SimulatedPlayer, target: ChopTarget, mode: ChopMode): Promise<"broken" | "skip" | "failed"> {
  // 已消失 → 跳过（成功信号）
  if (targetGone(bot, target)) return "skip";

  for (let attempt = 0; attempt < BREAK_RETRY_LIMIT; attempt++) {
    const d = distance3d(bot.location, target.loc);
    // 超出挖掘范围 → 靠近目标方块缩短距离再挖（用户规格）
    if (d > BREAK_NEAR_DISTANCE) {
      const nav = await longNavigateBot(botName, { x: target.loc.x + 0.5, y: target.loc.y, z: target.loc.z + 0.5 });
      if (nav !== NavigateResult.Arrived) {
        // 近程再试（目标就在附近但寻路失败 → navigateBot 直接靠近）
        await navigateBot(botName, { x: target.loc.x + 0.5, y: target.loc.y, z: target.loc.z + 0.5 });
      }
      if (!bot.isValid) return "failed";
      if (distance3d(bot.location, target.loc) > BREAK_NEAR_DISTANCE) continue; // 仍未靠近 → 重试
    }

    // 换工具（全背包强制策略；无匹配 → 不换）
    const kind: ChopTargetKind = target.kind;
    const slot = pickBestTool(kind, mode, snapshotTools(bot));
    if (slot !== undefined) {
      setMainhandSlot(botName, slot);
      await waitTicks(1); // 工具入主手后等待 1 tick 生效
    }

    const res = await breakBlockOnce(bot, target.loc, {
      maxDistance: BREAK_MAX_DISTANCE,
      pollTicks: 3,
      requireLineOfSight: false,
    });
    if (res === "broken" || res === "aborted") {
      // aborted：实体失效/并发取消 → 由调用方续跑或终止
      return res === "broken" ? "broken" : "failed";
    }
    // far/busy/offline/blocked → 等待 3 tick 后重试
    await waitTicks(3);
  }
  return "failed";
}

/** 拾取阶段：扫描树范围附近掉落物实体，逐个靠近等待自动拾取（多轮） */
async function pickupDrops(botName: string, bot: SimulatedPlayer, plan: ChopPlan): Promise<number> {
  const center = {
    x: (plan.pickupMin.x + plan.pickupMax.x) / 2,
    y: (plan.pickupMin.y + plan.pickupMax.y) / 2,
    z: (plan.pickupMin.z + plan.pickupMax.z) / 2,
  };
  let picked = 0;
  for (let pass = 0; pass < PICKUP_MAX_PASSES; pass++) {
    const drops = nearestDrops(bot.dimension, center);
    if (drops.length === 0) break;
    for (const drop of drops) {
      if (!bot.isValid) return picked;
      const p = drop.location;
      await longNavigateBot(botName, { x: p.x, y: p.y, z: p.z });
      await waitTicks(PICKUP_WAIT_TICKS); // 靠近后等待物品自动吸入背包
      picked++;
    }
  }
  return picked;
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 完成一棵树的砍伐流程（闭包异步，永不 reject）：
 *   按 ChopPlan 逐目标（换工具/破块/靠近）→ 拾取阶段收集树范围掉落物。
 *
 * @param botName 假人名
 * @param plan    单树砍伐计划（core ChopPlan 输出）
 * @param mode    砍树模式（原木模式/收集模式）
 * @returns done={broken,picked} / failed={reason}
 */
export async function chopOneTree(botName: string, plan: ChopPlan, mode: ChopMode): Promise<WoodcutOutcome> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return { kind: "failed", reason: "offline" };

  let broken = 0;
  for (const target of plan.targets) {
    if (!bot.isValid) return { kind: "failed", reason: "aborted" };
    const r = await breakTarget(botName, bot, target, mode);
    if (r === "broken") broken++;
    else if (r === "failed") {
      // 单目标多次失败：不中断整树（尽力砍；剩余由共享池后续认领者处理）
      console.warn(`[MockPlayer] chopOneTree ${botName} 目标 ${target.loc.x},${target.loc.y},${target.loc.z} 多次失败，跳过`);
    }
  }

  // 圆木卡叶清理已并入 plan（stuck-cleanup 目标）；此处正式进入拾取阶段
  let picked = 0;
  if (bot.isValid) {
    picked = await pickupDrops(botName, bot, plan);
    await waitTicks(3); // 收尾等待（末班掉落物自动吸入）
  }
  return { kind: "done", broken, picked };
}

// ─── 测试诊断入口（游戏内命令） ─────────────────────────

/** 一次性展示一棵树的砍伐计划（诊断；不实际破坏） */
export function describeChopPlan(plan: ChopPlan): string[] {
  const lines: string[] = [];
  lines.push(`[树] 砍伐计划 ${plan.treeId}（${plan.mode === "logs" ? "原木模式" : "收集模式"}）`);
  lines.push(`[树] 圆木 ${plan.logsCount} / 树叶 ${plan.leafsCount} / 目标 ${plan.targets.length} 个`);
  lines.push(`[树] 拾取范围 (${plan.pickupMin.x},${plan.pickupMin.y},${plan.pickupMin.z})~(${plan.pickupMax.x},${plan.pickupMax.y},${plan.pickupMax.z})`);
  lines.push(`[树] 顺序（前 20）：`);
  plan.targets.slice(0, 20).forEach((t, i) => {
    const kind = t.kind === "log" ? "原木" : "树叶";
    lines.push(`[树]   ${i + 1}. ${kind}(${t.loc.x},${t.loc.y},${t.loc.z}) ${t.reason}`);
  });
  if (plan.targets.length > 20) lines.push(`[树]   ... 共 ${plan.targets.length} 个目标`);
  return lines;
}
