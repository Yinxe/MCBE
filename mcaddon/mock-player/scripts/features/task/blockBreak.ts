// ─── 方块破坏能力（mc 层） ─────────────────────────────
// breakBlockOnce：原子破坏单个方块（异步协程，直到该块消失）——功能完备：
//   - 工具策略注入：ensureTool 回调（每块破坏前调用一次，默认不换）
//   - 实时检测：实体有效性（isValid）/ 3D 距离 / 方块消失（pollTicks 轮询）
//   - 持续挖掘：每 1 tick 起手 breakBlock（自动挖掘同款实测有效；
//     **不传 direction**——引擎可选参数默认方向，2026-08-15 确认非必要）
//   - 并发防护：同一假人已有进行中的破坏 → **拒绝处理并返回当前状态 busy**
//   - 成功信号：方块被摧毁 → 返回 "broken"；全退出路径 stopBreakingBlock 清理
// breakBlockAt：持续破坏直到指定方块被摧毁——每轮感知射线方块（viewBlock）
//   → 工具策略 → breakBlockOnce 原子破掉该块 → 直到目标消失。
// 自动挖掘（TAG_AUTO_MINE）协程与 breakBlockAt 共用 viewBlock + breakBlockOnce。
//
// 用户规格（2026-08-14/15，含修正）：工具替换以回调注入、看向目标方块中心
// 等待扭头到位后循环内不再 lookAt、无超时（破到目标消失为止）。

import { system } from "@minecraft/server";
import type { Block, Container, Dimension, Vector3 } from "@minecraft/server";
import { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { lookAt } from "../basic/PoseGateway";
import { botRegistry } from "../../bootstrap/context";

// ─── 结果类型 ──────────────────────────────────────────

/** 破坏结果：broken=目标已被摧毁（成功信号）/ far=超距放弃 /
 *  aborted=实体丢失 / offline=假人不可用 / busy=同假人已有进行中的破坏（拒绝） */
export type BreakResult = "broken" | "far" | "aborted" | "offline" | "busy";

// ─── 常量 ──────────────────────────────────────────────

/** 默认最大挖掘距离（格，3D 自检——引擎不限制距离，须显式判定） */
const DEFAULT_MAX_DISTANCE = 6;
/** 默认状态检测间隔（tick） */
const DEFAULT_POLL_TICKS = 5;
/** 扭头等待（tick，=0.25 秒——用户规格：看向目标方块后等待扭头到位再进入循环） */
const LOOK_SETTLE_TICKS = 5;
/** 空气方块 ID（目标破坏判定） */
const AIR_BLOCK_ID = "minecraft:air";
/** 液体方块 ID（目标位置被液体填充 = 目标方块已破坏，不再继续破） */
const LIQUID_BLOCK_IDS = ["minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"] as const;

/** 目标是否已"消失"（空气或液体——液体流入即原方块已破坏；液体不挡射线，
 *  若不判定会继续破坏目标后方的无关方块） */
function isGoneTypeId(typeId: string): boolean {
  return typeId === AIR_BLOCK_ID || (LIQUID_BLOCK_IDS as readonly string[]).includes(typeId);
}

// ─── 工具替换回调上下文 ────────────────────────────────

/** 工具替换回调上下文（每块破坏前注入；是否换工具完全由回调判断） */
export interface EnsureToolContext {
  /** 假人实体（SimulatedPlayer；读位置/状态） */
  bot: SimulatedPlayer;
  /** 假人背包容器（读槽位/工具/耐久；读不到时 undefined——回调可跳过工具处理） */
  container?: Container;
  /** 当前主手槽（selectedSlotIndex） */
  handSlot: number;
  /** 即将破坏的方块类型（射线方块——可能是路径上的障碍块，不一定是终点目标） */
  blockTypeId: string;
}

// ─── 选项 ──────────────────────────────────────────────

/** 单块破坏选项 */
export interface BreakOnceOptions {
  /** 工具替换策略回调（每块破坏前调用；是否换工具完全由回调判断；默认不切换） */
  ensureTool?: (ctx: EnsureToolContext) => Promise<void> | void;
  /** 最大挖掘距离（格，3D 自检） */
  maxDistance?: number;
  /** 状态检测间隔（tick） */
  pollTicks?: number;
  /**
   * 外部中止回调（每 pollTicks 检测一次；返回 true → 中止并返回 "aborted"）。
   * 用于调用方掌控协程生命周期（如自动挖掘的 tag 移除/假人死亡检查）——
   * 不传则保持"直到破坏"无超时语义（breakBlockAt 不传）。
   */
  shouldStop?: () => boolean;
}

/** 持续破坏选项（breakBlockAt） */
export interface BreakBlockOptions extends BreakOnceOptions {
  /**
   * 跳过扭头（默认 false）：连续破坏同一方向方块（如持续挖掘）时视线已
   * 对准，跳过 lookAt + 扭头等待——每块省 5 tick 停顿，挖掘更流畅
   * （3.3.9）。目标方向变化时不要传（须重新对准）。
   */
  skipLook?: boolean;
}

// ─── 工具 ──────────────────────────────────────────────

/** 延迟等待（异步协程节奏控制——闭包内部自调度，不走主循环） */
export function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/** 假人记录是否可用（在线且未死亡）——区分 offline（记录不可用）与 aborted（实体丢失） */
function botRegistryAlive(botName: string): boolean {
  const record = botRegistry.get(botName);
  return !!record && record.online && !record.death;
}

/** 3D 距离 */
function distance3d(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** 读取方块（自动 floor；不可读/未加载返回 undefined） */
function readBlock(dimension: Dimension, pos: Vector3): Block | undefined {
  try {
    return dimension.getBlock({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  } catch {
    return undefined;
  }
}

/** 方块是否已消失（undefined/空 typeId/空气/液体 → 不可读或已破坏） */
function blockGone(block: Block | undefined): boolean {
  if (!block) return true;
  const typeId = block.typeId;
  return typeId === "" || isGoneTypeId(typeId);
}

/**
 * 感知射线方块：读取假人**视角方向**射线命中的首个方块（引擎计算，
 * 无需自行算射线——用户拍板）。getBlockFromViewDirection 默认跳过可穿过
 * 方块（空气/藤蔓/花），返回第一个实心方块；目标被障碍挡住时返回障碍块。
 * center 用引擎权威值 `block.center()`（X/Y/Z 三轴中心）。
 * 读取失败返回 undefined → 调用方按目标块处理。
 * 供自动挖掘协程 / breakBlockAt 复用（单块破坏 breakBlockOnce 按指定坐标破，
 * 不做射线探测——探测是调用方的职责）。
 */
export function viewBlock(
  bot: SimulatedPlayer,
  maxDistance: number
): { typeId: string; location: Vector3; center: Vector3 } | undefined {
  try {
    const hit = bot.getBlockFromViewDirection({ maxDistance });
    if (hit && hit.block) {
      const loc = hit.block.location;
      return {
        typeId: hit.block.typeId,
        location: { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) },
        center: hit.block.center(), // 引擎权威方块中心
      };
    }
  } catch {
    /* 读取失败回退目标块 */
  }
  return undefined;
}

/** 取假人背包容器（读不到返回 undefined） */
function botContainer(bot: SimulatedPlayer): Container | undefined {
  try {
    const inv = bot.getComponent("minecraft:inventory") as { container?: Container } | undefined;
    return inv?.container;
  } catch {
    return undefined;
  }
}

// ─── 并发防护 ──────────────────────────────────────────

/** 同假人进行中的单块破坏（拒绝重复执行并返回 busy） */
const activeBreaks = new Set<string>();

// ─── 原子破坏单块（功能完备，可被持续破坏/自动挖掘复用） ──

/**
 * 原子破坏单个方块（异步协程，直到该块被摧毁）。
 * 功能完备：工具策略注入（ensureTool 每块一次）/ 实时检测（实体有效性、
 * 3D 距离、方块消失按 pollTicks 轮询）/ 持续挖掘（每 1 tick 起手，
 * 不传 direction）/ 并发防护（同假人重复执行 → 拒绝并返回 busy）/
 * 成功信号（broken）/ 全退出路径 stopBreakingBlock 清理。
 *
 * @param bot    假人实体（调用方持有；失效返回 aborted，由调用方重新解析）
 * @param loc    目标方块坐标（自动 floor）
 * @param options 选项（工具策略回调 / 距离 / 检测间隔）
 * @returns broken（已摧毁）/ far / aborted / busy（拒绝）
 */
export async function breakBlockOnce(
  bot: SimulatedPlayer,
  loc: Vector3,
  options: BreakOnceOptions = {}
): Promise<BreakResult> {
  const {
    ensureTool = () => undefined,
    maxDistance = DEFAULT_MAX_DISTANCE,
    pollTicks = DEFAULT_POLL_TICKS,
    shouldStop,
  } = options;
  const dimension = bot.dimension;
  const targetLoc: Vector3 = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) };

  // 并发防护：同一假人已有进行中的破坏 → 拒绝处理，返回当前状态（busy）
  if (activeBreaks.has(bot.name)) return "busy";
  activeBreaks.add(bot.name);

  try {
    // 前置：目标可读检查（已消失 → 快路径 broken 成功信号）+ 距离自检（超距放弃）
    const targetBlock = readBlock(dimension, targetLoc);
    if (blockGone(targetBlock)) return "broken";
    if (distance3d(bot.location, targetLoc) > maxDistance) return "far";

    // 工具替换策略（每块一次，破坏前注入；异常不影响破坏）
    try {
      await ensureTool({
        bot,
        container: botContainer(bot),
        handSlot: bot.selectedSlotIndex,
        blockTypeId: targetBlock!.typeId,
      });
    } catch {
      /* 回调失败按不切换处理 */
    }

    // 持续挖掘循环（每 1 tick 起手；敲击失败静默下 tick 重试）
    let sinceCheck = 0;
    while (true) {
      await waitTicks(1);
      sinceCheck++;

      // 每 tick 起手（不传 direction——引擎可选参数默认方向）
      try {
        bot.breakBlock(targetLoc);
      } catch {
        /* 敲击失败下 tick 重试 */
      }

      // 实时检测（按 pollTicks 轮询——读块/距离有开销，不每 tick 做）
      if (sinceCheck < pollTicks) continue;
      sinceCheck = 0;

      if (shouldStop?.()) return "aborted"; // 外部中止（调用方生命周期控制）
      if (!bot.isValid) return "aborted"; // 实体失效（重连/移除）
      if (distance3d(bot.location, targetLoc) > maxDistance) return "far";
      if (blockGone(readBlock(dimension, targetLoc))) return "broken"; // 成功信号：已摧毁
    }
  } finally {
    // 释放并发锁 + 清理挖掘状态（所有退出路径；传送后引擎可能不自动打断）
    activeBreaks.delete(bot.name);
    try {
      bot.stopBreakingBlock();
    } catch {
      /* 清理失败忽略 */
    }
  }
}

// ─── 持续破坏（直到指定方块被摧毁，复用单块破坏） ───────

/**
 * 持续破坏指定坐标方块（异步协程，直到该方块被摧毁）。
 * 每轮：外部中止检查（shouldStop）→ 死亡检查（记录标记，尸体实体仍在世界
 * 但记录 death=true）→ 刷新实体（每块一次，非每 tick）→ 目标状态检查
 * （消失 → broken）→ 距离自检（far）→ 感知射线方块（viewBlock，读取失败
 * 回退目标块——看哪破哪）→ 工具策略（透传单块破坏）→ 原子破坏射线方块
 * （breakBlockOnce）→ 直到目标消失。前置：可用性 → 距离自检 → 目标可读 →
 * 看向目标方块中心（引擎 Block.center() 权威值）→ 等待 0.25 秒扭头到位。
 * **无超时**（破到目标消失为止；不可破方块由调用方通过 shouldStop 放弃）；
 * 循环内不再 lookAt，视线稳定。
 *
 * @param botName 假人名
 * @param target 目标方块坐标（自动 floor）
 * @param options 选项（工具策略回调 / 距离 / 检测间隔 / 外部中止）
 * @returns 破坏结果（broken 表示目标已摧毁）
 */
export async function breakBlockAt(botName: string, target: Vector3, options: BreakBlockOptions = {}): Promise<BreakResult> {
  const {
    ensureTool = () => undefined,
    maxDistance = DEFAULT_MAX_DISTANCE,
    pollTicks = DEFAULT_POLL_TICKS,
    shouldStop,
    skipLook = false,
  } = options;

  let bot = resolveBotPlayer(botName);
  if (!bot) return "offline";
  const dimension = bot.dimension;
  const targetLoc: Vector3 = { x: Math.floor(target.x), y: Math.floor(target.y), z: Math.floor(target.z) };

  // 距离自检（3D——引擎不限制距离，须显式判定；超距直接放弃不发起敲击）
  if (distance3d(bot.location, target) > maxDistance) return "far";

  // 目标可读检查 + 目标中心（引擎权威值；已破坏/液体 → 快路径 broken）
  const targetBlock = readBlock(dimension, targetLoc);
  if (blockGone(targetBlock)) return "broken";
  const targetCenter = targetBlock!.center();

  // 扭头看向目标方块中心（引擎权威值），等待 0.25 秒扭头到位；
  // **循环内不再 lookAt**——视线全程稳定指向目标，射线不因转头偏移。
  // skipLook（连续同向破坏）：视线已对准 → 跳过扭头（每块省 5 tick 停顿）
  if (!skipLook) {
    lookAt(bot, targetCenter);
    await waitTicks(LOOK_SETTLE_TICKS);
  }

  try {
    while (true) {
      // 外部中止（调用方生命周期控制——不可破方块由调用方决定放弃）
      if (shouldStop?.()) return "aborted";

      // 假人死亡（实体可能仍在世界（尸体）→ 显式查记录标记）
      if (botRegistry.get(botName)?.death) return "offline";

      // 每轮刷新实体（每破一块一次——getEntity 有开销，不每 tick 解析）
      bot = resolveBotPlayer(botName);
      if (!bot) return botRegistryAlive(botName) ? "aborted" : "offline";

      // 目标状态（每轮读块；空气/液体/不可读 = 已消失）→ 完成
      if (blockGone(readBlock(dimension, targetLoc))) return "broken";

      // 距离超限（目标掉落/被推走/假人被传送）→ 放弃
      if (distance3d(bot.location, target) > maxDistance) return "far";

      // 感知射线方块（引擎视角射线；失败回退目标块——看哪破哪；
      // 循环头已保证目标可读未消失 → fallback 必然命中，无 undefined 分支）
      const inSight =
        viewBlock(bot, maxDistance) ?? { typeId: targetBlock!.typeId, location: targetLoc, center: targetCenter };

      // 原子破坏射线方块（工具策略透传；内部实时检测/并发防护/成功信号/中止）
      const result = await breakBlockOnce(bot, inSight.location, { ensureTool, maxDistance, pollTicks, shouldStop });
      if (result === "broken") continue; // 该块已摧毁 → 下一轮（目标可能还没消失）
      if (result === "busy") {
        await waitTicks(pollTicks); // 并发保护（另一破坏进行中）→ 等待后重试
        continue;
      }
      return result; // far / aborted / offline 直接结束
    }
  } finally {
    // 所有退出路径清理（取最新实体——破坏中假人重连/重生后初始实体可能失效）
    try {
      resolveBotPlayer(botName)?.stopBreakingBlock();
    } catch {
      /* 清理失败忽略 */
    }
  }
}
