// ─── 拾取目标掉落物流程（mc 层：独立拾取 flow） ────────
// runPickupFlow：可复用的**拾取子流程**——给定工作范围 + 目标 typeId 白名单
// （PickupTask，core PickupPlan 纯规划），执行：
//   1. 扫描范围内 minecraft:item 掉落物实体 → 按范围/白名单过滤（planPickup）
//   2. 先破卡落遮挡（掉落物卡在树叶等薄层 → 破除让掉落物掉下可拾取）
//   3. 就近导航逐个靠近，等待物品自动吸入背包
//   4. 背包满 → onInventoryFull 回调（返回 true 表示已处理可继续，false/缺省停止）
//   5. 单目标多次不可达 → onUnreachable 回调（返回 true 继续下一目标）
//
// ⚠️ mc 适配层：按 flow 风格永不 reject；core 规划在 rules/pickup/PickupPlan（可单测）。

import type { Entity } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { breakBlockOnce } from "../basic/blocks";
import { longNavigateBot, NavigateResult } from "../basic/move";
import { setMainhandSlot } from "../basic/items/mainhand";
import { inventoryContainerOf, enchantableOf } from "../basic/items/ItemComponentRead";
import { waitTicks } from "../utils";
import { planPickup, type PickupItem, type PickupTask } from "../../rules/pickup/PickupPlan";
import { pickBestTool } from "../../rules/woodcut/WoodcutRules";

// ─── 结果类型 ──────────────────────────────────────────

/** 拾取结果 */
export type PickupOutcome =
  | { kind: "done"; picked: number; remained: number }
  | { kind: "inventory-full"; picked: number; remained: number }
  | { kind: "failed"; reason: "offline" | "error"; picked: number; remained: number };

/** 拾取选项（背包满/不可达回调等） */
export interface PickupOptions {
  /**
   * 背包满回调：背包已无空格时触发。返回 true = 已处理（如清理/存入箱子），
   * 调用方决定是否继续本轮；返回 false / 省略 → 停止并返回 inventory-full。
   */
  onInventoryFull?: (freeSlots: number, total: number) => boolean;
  /** 单目标多次无法拾取（异常卡住/不可达）回调；返回 true → 继续下一目标；省略 → 跳过 */
  onUnreachable?: (item: PickupItem) => boolean;
  /** 是否允许破除卡落遮挡（默认 true；false = 只拾取可直达的） */
  allowCleanup?: boolean;
  /** 最大拾取轮次（默认 3） */
  maxPasses?: number;
  /** 靠近后等待自动吸入（tick，默认 10） */
  waitPickupTicks?: number;
}

// ─── 常量 ──────────────────────────────────────────────

/** 破坏遮挡距离（格，3D 自检） */
const CLEANUP_MAX_DISTANCE = 6;
/** 靠近后等待自动吸入（tick，默认 10 = 0.5 秒） */
const DEFAULT_WAIT_PICKUP_TICKS = 10;
/** 最大拾取轮次（外层循环） */
const DEFAULT_MAX_PASSES = 3;
/** 单目标不可达重试上限 */
const UNREACHABLE_RETRY = 2;
/** 无效旧 id 下物品扫描量上限（防超大范围卡顿） */
const SCAN_CAP = 64;

// ─── 工具/背包辅助 ─────────────────────────────────────

/** 将背包快照为 ToolItem[]（破卡落遮挡用树叶策略选工具；含附魔——强制策略在 Core） */
function snapshotTools(bot: SimulatedPlayer): Array<{ slot: number; typeId: string; enchantments: { id: string; level: number }[]; category: "axe" | "hoe" | "shears" }> {
  const tools: Array<{ slot: number; typeId: string; enchantments: { id: string; level: number }[]; category: "axe" | "hoe" | "shears" }> = [];
  const container = inventoryContainerOf(bot);
  if (!container) return tools;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const typeId = item.typeId;
    const category = typeId.endsWith("_axe") ? "axe" : typeId.endsWith("_hoe") ? "hoe" : typeId === "minecraft:shears" ? "shears" : "axe";
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

/** 背包剩余空格数 */
function freeSlots(bot: SimulatedPlayer): { free: number; total: number } {
  const container = inventoryContainerOf(bot);
  if (!container) return { free: 0, total: 0 };
  let free = 0;
  for (let i = 0; i < container.size; i++) {
    if (!container.getItem(i)) free++;
  }
  return { free, total: container.size };
}

/** 读掉落物物品 typeId（minecraft:item 组件；读取失败返回 "minecraft:item"） */
function dropTypeId(entity: Entity): string {
  try {
    const comp = entity.getComponent("minecraft:item") as { itemStack?: { typeId: string } } | undefined;
    return comp?.itemStack?.typeId ?? "minecraft:item";
  } catch {
    return "minecraft:item";
  }
}

/** 扫描范围内掉落物实体（getEntities 以范围中心 + 覆盖半径；core 再精确过滤） */
function scanDrops(bot: SimulatedPlayer, task: PickupTask): PickupItem[] {
  try {
    const center = {
      x: (task.rangeMin.x + task.rangeMax.x) / 2,
      y: (task.rangeMin.y + task.rangeMax.y) / 2,
      z: (task.rangeMin.z + task.rangeMax.z) / 2,
    };
    const span = Math.max(
      task.rangeMax.x - task.rangeMin.x,
      task.rangeMax.y - task.rangeMin.y,
      task.rangeMax.z - task.rangeMin.z,
    );
    const entities = bot.dimension.getEntities({
      type: "minecraft:item",
      location: center,
      maxDistance: span + 1,
    });
    const items: PickupItem[] = [];
    for (const e of entities) {
      if (items.length >= SCAN_CAP) break;
      const p = e.location;
      items.push({ loc: { x: p.x, y: p.y, z: p.z }, typeId: dropTypeId(e) });
    }
    return items;
  } catch {
    return [];
  }
}

// ─── 阶段实现 ──────────────────────────────────────────

/** 破除卡落遮挡（树叶等薄层）：按树叶策略换工具后 breakBlockOnce */
async function breakCleanup(botName: string, bot: SimulatedPlayer, loc: { x: number; y: number; z: number }): Promise<void> {
  const d = Math.hypot(bot.location.x - loc.x, bot.location.y - loc.y, bot.location.z - loc.z);
  if (d > CLEANUP_MAX_DISTANCE) {
    await longNavigateBot(botName, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 });
  }
  if (!bot.isValid) return;
  // 树叶策略（收集模式语义：精准锄头 > 剪刀 > 任意工具）选工具
  const slot = pickBestTool("leaf", "collect", snapshotTools(bot));
  if (slot !== undefined) {
    setMainhandSlot(botName, slot);
    await waitTicks(1);
  }
  try {
    await breakBlockOnce(bot, loc, { maxDistance: CLEANUP_MAX_DISTANCE, pollTicks: 3 });
  } catch {
    /* 破遮挡失败不致命（下轮再试/不可达回调） */
  }
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 拾取目标掉落物（独立 flow，永不 reject）：
 *   按 PickupTask（范围/白名单）规划 → 破卡落遮挡 → 就近导航逐个拾取；
 *   背包满 / 不可达通过回调处理。
 *
 * @param botName 假人名
 * @param task    拾取任务（rangeMin/Max、includeTypes、isBlockingBelow、origin）
 * @param options 选项（背包满回调/不可达回调/是否破遮挡/轮次）
 */
export async function runPickupFlow(botName: string, task: PickupTask, options: PickupOptions = {}): Promise<PickupOutcome> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return { kind: "failed", reason: "offline", picked: 0, remained: 0 };
  const {
    onInventoryFull,
    onUnreachable,
    allowCleanup = true,
    maxPasses = DEFAULT_MAX_PASSES,
    waitPickupTicks = DEFAULT_WAIT_PICKUP_TICKS,
  } = options;

  let picked = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (!bot.isValid) return { kind: "failed", reason: "error", picked, remained: 0 };
    const scanned = scanDrops(bot, task);
    const plan = planPickup(scanned, task);
    if (plan.targets.length === 0 && plan.cleanups.length === 0) break;

    // ① 破卡落遮挡（让掉落物掉下来）
    if (allowCleanup) {
      for (const loc of plan.cleanups) {
        if (!bot.isValid) return { kind: "failed", reason: "error", picked, remained: 0 };
        await breakCleanup(botName, bot, loc);
      }
    }

    // ② 就近拾取
    for (const item of plan.targets) {
      if (!bot.isValid) return { kind: "failed", reason: "error", picked, remained: 0 };
      // 背包满 → 回调（返回 true 表示已处理可继续，false/缺省停止）
      const slots = freeSlots(bot);
      if (slots.free === 0) {
        const proceed = onInventoryFull ? onInventoryFull(slots.free, slots.total) : false;
        if (!proceed) return { kind: "inventory-full", picked, remained: plan.targets.length };
      }
      // 导航靠近（多次尝试；不可达 → 回调）
      for (let retry = 0; retry <= UNREACHABLE_RETRY; retry++) {
        const nav = await longNavigateBot(botName, { x: item.loc.x, y: item.loc.y, z: item.loc.z });
        if (nav === NavigateResult.Arrived || nav === NavigateResult.TooFar) break;
        await waitTicks(5);
      }
      // 靠近后等待少量 tick 让自动吸入生效；仍不可达 → onUnreachable
      await waitTicks(waitPickupTicks);
      const stillThere = scanDrops(bot, task).some((i) => i.typeId === item.typeId);
      if (stillThere) {
        const proceed = onUnreachable ? onUnreachable(item) : true;
        void proceed; // 回调语义：返回 true 继续（默认跳过）
      }
      picked++;
    }
  }
  const remained = scanDrops(bot, task).length;
  return { kind: "done", picked, remained };
}
