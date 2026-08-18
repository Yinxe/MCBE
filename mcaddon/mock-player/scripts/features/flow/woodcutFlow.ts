// ─── 单棵树的砍伐流程（mc 层：woodcut flow） ────────────
// chopOneTree：按 ChopPlan（core 纯逻辑）砍伐一棵已认领的树——
//   阶段编排（用户规格 2026-08-18 优化版）：
//     ① 先导航到树附近（树中心坐标）
//     ② 破除**树桩**，再**向上逐根**砍掉全部圆木资源——每根用 breakBlockAt
//       （"直到破坏方块"模式：看向目标方块中心 + 持续挖掘到目标被破坏）；
//       目标超出挖掘距离（far）→ **靠近目标方块缩短距离再挖**
//     ③ 完整砍树模式（collect）：再挖掘掉**全部树叶**资源（已并入 plan；
//       树叶用树叶策略：精准锄头>剪刀>任意精准工具，强制应用）
//     ④ 圆木卡叶清理并入 plan（stuck-cleanup：破树叶让掉落物掉下来）
//     ⑤ 拾取：独立拾取 flow（runPickupFlow）收集树范围全部掉落物
//
// ⚠️ 本流程为 mc 适配层：core 已由 ChopPlan / WoodcutRules 覆盖并可单测，
//   这里的副作用（导航/破块/换工具/拾取）按 fishingFlow 风格**永不 reject**。
// ⚠️ 工具策略：选工具前从假人**全背包**快照构造 ToolItem（强制策略即靠
//   全背包扫描取最优实现）；未找到匹配工具 → 不换（用当前主手）。

import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { breakBlockAt } from "../basic/blocks";
import { navigateBot, longNavigateBot, NavigateResult } from "../basic/move";
import { setMainhandSlot } from "../basic/items/mainhand";
import { inventoryContainerOf, enchantableOf } from "../basic/items/ItemComponentRead";
import { waitTicks } from "../utils";
import {
  hasSuitableLeafTool,
  pickBestTool,
  toolCategoryOf,
  type ChopMode,
  type ChopTargetKind,
  type ToolItem,
} from "../../rules/woodcut/WoodcutRules";
import { TREE_LEAF_TYPE_IDS, TREE_LOG_TYPE_IDS } from "../../rules/tree/TreeRules";
import type { ChopPlan, ChopStage, ChopTarget } from "../../rules/woodcut/ChopPlan";
import type { PickupTask } from "../../rules/pickup/PickupPlan";
import { runPickupFlow } from "./pickupFlow";

// ─── 结果类型 ──────────────────────────────────────────

/** 砍树失败原因 */
export type WoodcutFailureReason = "offline" | "aborted" | "error";

/** 一次砍树流程结果 */
export type WoodcutOutcome =
  | { kind: "done"; broken: number; picked: number; fellBack?: boolean }
  | { kind: "failed"; reason: WoodcutFailureReason };

// ─── 常量 ──────────────────────────────────────────────

/** 破坏距离（格，3D 自检；translated to breakBlockAt maxDistance） */
const BREAK_MAX_DISTANCE = 6;
/** 单目标破坏重试上限（超距靠近 + 重试的次数） */
const BREAK_RETRY_LIMIT = 3;

// ─── 背包工具快照（强制策略：全背包扫描取最优） ──────────

/** 将假人背包快照为 ToolItem[]（core 选工具策略入参；所有匹配工具条目） */
export function snapshotTools(bot: SimulatedPlayer): ToolItem[] {
  const tools: ToolItem[] = [];
  const container = inventoryContainerOf(bot);
  if (!container) return tools;
  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (!item) continue;
    const typeId = item.typeId;
    const category = toolCategoryOf(typeId); // 统一入口（core）
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

// ─── 阶段实现 ──────────────────────────────────────────

/**
 * 持续破坏单个目标直到被摧毁（用户规格：breakBlock 的"直到破坏方块"模式）：
 *   breakBlockAt 会**看向目标方块中心**并持续挖掘直到目标消失；超出挖掘距离
 *   （far）→ 靠近目标方块缩短距离后重试。工具每块按模式/目标自动切换。
 *
 * @returns "broken"=已摧毁 / "skip"=本就不存在 / "failed"=多次尝试仍失败（含不可达）
 */
async function breakUntilGone(botName: string, target: ChopTarget, mode: ChopMode): Promise<"broken" | "skip" | "failed"> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return "failed";
  if (targetGone(bot, target)) return "skip"; // 已消失 → 成功信号

  // 工具策略（每块破坏前注入；全背包强制策略——core 决策）
  const ensureTool = async (): Promise<void> => {
    const cur = resolveBotPlayer(botName);
    if (!cur) return;
    const kind: ChopTargetKind = target.kind;
    const slot = pickBestTool(kind, mode, snapshotTools(cur));
    if (slot !== undefined) {
      setMainhandSlot(botName, slot);
      await waitTicks(1); // 工具入主手后等待 1 tick 生效
    }
  };

  // 靠近目标基座（同 x/z、尽量贴近地面）——"超出挖掘距离则缩短距离再挖"
  const approach = async (): Promise<void> => {
    const cur = resolveBotPlayer(botName);
    if (!cur) return;
    stopMining(botName); // ⚠️ 移动前必须立刻停止正在挖掘的动作
    // 导航到目标正下方（y 用假人当前层——地面可达时生成导航目标）
    const navTarget = { x: target.loc.x + 0.5, y: Math.max(target.loc.y - 1, cur.location.y - 2), z: target.loc.z + 0.5 };
    const nav = await longNavigateBot(botName, navTarget);
    if (nav !== NavigateResult.Arrived) {
      await navigateBot(botName, navTarget);
    }
  };

  for (let attempt = 0; attempt < BREAK_RETRY_LIMIT; attempt++) {
    // 已消失（上轮破坏成功/被其它进程清掉）→ 成功
    const cur = resolveBotPlayer(botName);
    if (!cur) return "failed";
    if (targetGone(cur, target)) return "broken";

    const res = await breakBlockAt(botName, target.loc, {
      maxDistance: BREAK_MAX_DISTANCE,
      pollTicks: 3,
      ensureTool, // 每块破坏前自动换工具（斧头/树叶策略）
      skipLook: false, // 看向目标方块中心再挖（breakBlockAt 内置扭头）
    });
    if (res === "broken") return "broken"; // 持续挖掘直到目标被破坏 ✓
    if (res === "far") {
      // 目标超出挖掘距离 → 靠近目标方块缩短距离再挖（用户规格）
      await approach();
      continue;
    }
    if (res === "busy" || res === "offline") {
      await waitTicks(3);
      continue;
    }
    return "failed"; // aborted/error → 交给调用方（尽力砍）
  }
  return "failed";
}

/** 停止假人正在挖掘的动作（用户规格：任何移动操作进行时，都要立刻停止挖矿） */
function stopMining(botName: string): void {
  try {
    resolveBotPlayer(botName)?.stopBreakingBlock();
  } catch {
    /* 实体失效忽略 */
  }
}

/** 靠近某坐标（longNavigate → navigate 兜底，容错；移动前先停挖） */
async function approachPoint(botName: string, loc: { x: number; y: number; z: number }): Promise<void> {
  stopMining(botName); // ⚠️ 移动前必须立刻停止正在挖掘的动作
  const nav = await longNavigateBot(botName, { x: loc.x, y: loc.y, z: loc.z });
  if (nav !== NavigateResult.Arrived) {
    await navigateBot(botName, { x: loc.x, y: loc.y, z: loc.z });
  }
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 完成一棵树的砍伐流程（闭包异步，永不 reject）：
 *   ① 先导航到树附近（树中心坐标 base；移动前 stopBreakingBlock）
 *   ② 树桩 → 移动进入树中心向上垂直砍主干 → 移到散落圆木正下方破除
 *     （每根用 breakBlockAt：看向目标 + 持续挖掘直到被破坏；超出挖掘距离
 *       → 靠近目标正下方缩短距离再挖）
 *   ③ 收集模式：挖掉**所有挖掘范围内**的树叶（超距 → 正下方缩短距离）；
 *     没有合适树叶工具 → **自动 fallback 圆木模式**（跳过树叶，直接拾取）
 *   ④ 拾取：树中心 7×7 范围内**圆木 + 树叶两类**掉落物（独立拾取 flow）
 *
 * @param botName 假人名
 * @param plan    单树砍伐计划（core ChopPlan 输出；分阶段）
 * @param mode    砍树模式（原木模式/收集模式）
 * @returns done={broken,picked} / failed={reason}
 */
export async function chopOneTree(botName: string, plan: ChopPlan, mode: ChopMode): Promise<WoodcutOutcome> {
  const bot = resolveBotPlayer(botName);
  if (!bot) return { kind: "failed", reason: "offline" };

  // ── ① 先导航到树附近（树中心坐标；移动前停挖） ──
  await approachPoint(botName, plan.base);

  // ── ②/③ 分阶段推进：树桩→主干→散落→[收集模式]全部树叶 ──
  let broken = 0;
  let effectiveMode: ChopMode = mode;
  let fellBack = false;
  for (const stage of plan.stages) {
    if (stage.kind === "leaf" && effectiveMode === "collect") {
      // 收集模式挖树叶：无合适树叶工具 → 自动 fallback 圆木模式
      const cur = resolveBotPlayer(botName);
      const tools = cur ? snapshotTools(cur) : [];
      if (!cur || !hasSuitableLeafTool(tools)) {
        fellBack = true;
        console.warn(`[MockPlayer] chopOneTree ${botName} 收集模式无合适树叶工具，自动 fallback 圆木模式`);
        // 通知（如果有附近玩家）——flow 内不直接依赖 world 通知，交给能力层/日志
        break; // 跳过树叶阶段，进入拾取
      }
    }
    for (const target of stage.targets) {
      if (!resolveBotPlayer(botName)?.isValid) return { kind: "failed", reason: "aborted" };
      stopMining(botName); // ⚠️ 每个目标处理前（含 move 前）确保停挖
      const r = await breakUntilGone(botName, target, effectiveMode);
      if (r === "broken") broken++;
      else if (r === "failed") {
        console.warn(
          `[MockPlayer] chopOneTree ${botName} 目标 ${target.loc.x},${target.loc.y},${target.loc.z} 无法破坏（可能超出竖向挖掘距离），跳过`,
        );
      }
    }
  }

  // ── ④ 拾取：树中心 7×7 范围内圆木/树叶两类掉落物（独立拾取 flow，卡叶破除） ──
  let picked = 0;
  if (resolveBotPlayer(botName)?.isValid) {
    const task: PickupTask = {
      rangeMin: plan.pickupMin,
      rangeMax: plan.pickupMax,
      origin: resolveBotPlayer(botName)!.location,
      includeTypes: [...(TREE_LOG_TYPE_IDS as readonly string[]), ...(TREE_LEAF_TYPE_IDS as readonly string[])],
      isBlockingBelow: (loc) =>
        plan.targets.some((t) => t.kind === "leaf" && t.loc.x === loc.x && t.loc.y === loc.y && t.loc.z === loc.z),
    };
    const outcome = await runPickupFlow(botName, task, {
      allowCleanup: true,
      maxPasses: 2,
      waitPickupTicks: 10,
      onUnreachable: (item) => {
        console.warn(
          `[MockPlayer] chopOneTree ${botName} 掉落物不可达（${item.typeId} @ ${item.loc.x},${item.loc.y},${item.loc.z}），跳过`,
        );
        return true;
      },
    });
    picked = outcome.kind === "failed" ? 0 : outcome.picked;
    await waitTicks(3); // 收尾等待（末班掉落物自动吸入）
  }
  return { kind: "done", broken, picked, fellBack };
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
