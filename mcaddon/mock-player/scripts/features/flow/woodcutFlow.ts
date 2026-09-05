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
//     ⑤ 拾取：磁吸传送拾取（vacuumNearbyDrops）——半径 10 格内圆木/树叶
//        掉落物 teleport 脚下自动入包（零寻路零走动）
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
import { inventoryContainerOf } from "../basic/items/ItemComponentRead";
import { snapshotTools } from "../basic/items/ToolSnapshot";
import { waitTicks } from "../utils";
import {
  hasSuitableLeafTool,
  pickBestTool,
  type ChopMode,
  type ChopTargetKind,
} from "../../rules/woodcut/WoodcutRules";
import { classifyTreeBlock } from "../../rules/tree/TreeRules";
import { WOODCUT_LOOT_TYPES } from "../../rules/woodcut/LootWhitelist";
import type { ChopPlan, ChopStage, ChopTarget } from "../../rules/woodcut/ChopPlan";
import { vacuumNearbyDrops } from "./pickupFlow";

// ─── 结果类型 ──────────────────────────────────────────

/** 砍树失败原因 */
export type WoodcutFailureReason = "offline" | "aborted" | "error";

/** 一次砍树流程结果 */
export type WoodcutOutcome =
  | { kind: "done"; broken: number; picked: number; fellBack?: boolean }
  | { kind: "failed"; reason: WoodcutFailureReason };

// ─── 常量 ──────────────────────────────────────────────

/**
 * 破坏距离（格，3D 自检；透传 breakBlockAt maxDistance）。
 * 用户规格：因砍树时树顶圆木总因挖掘距离不够剩着 → 砍树模式的挖掘距离提升到 10。
 */
const BREAK_MAX_DISTANCE = 10;
/** 单目标破坏重试上限（超距靠近 + 重试的次数） */
const BREAK_RETRY_LIMIT = 3;

// ─── 背包工具快照（强制策略：全背包扫描取最优） ──────────
// 实现已下沉 basic/items/ToolSnapshot（挖掘任务共用）；此处 re-export 兼容旧引用。

export { snapshotTools };

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
 *   breakBlockAt 会**面向目标方块中心**（身体+视线）并定点持续挖掘目标坐标
 *   直到目标消失；超出挖掘距离（far）→ 靠近目标方块缩短距离后重试。
 *   工具每块按模式/目标自动切换。
 *
 * ⚠️ 砍树铁律（挖泥巴/挖坑 BUG 根治闸门）：破坏开始前读一次目标方块——
 *   已消失 → skip；**类型与计划 kind 不符（泥巴/石头/建筑等）→ 绝不挖**；
 *   通过后锁定 expectedTypeId 交 breakBlockAt 全程类型守卫（中途被换 → changed）。
 *
 * @returns "broken"=已摧毁 / "skip"=不存在或类型不符（绝不挖）/ "far"=靠近后
 *   仍超距（竖向够不到——供上层剪枝其上方目标，杜绝大树浮空木下的无效寻路）/
 *   "failed"=其他失败
 */
async function breakUntilGone(botName: string, target: ChopTarget, mode: ChopMode): Promise<"broken" | "skip" | "far" | "failed"> {
  let sawFar = false; // 重试期间出现过超距（靠近后仍 far → 竖向不可达信号）
  const bot = resolveBotPlayer(botName);
  if (!bot) return "failed";

  // ── 目标状态 + 类型守卫（一次读块）：砍树只认木头/树叶 ──
  let expectedTypeId: string;
  try {
    const block = bot.dimension.getBlock({
      x: Math.floor(target.loc.x),
      y: Math.floor(target.loc.y),
      z: Math.floor(target.loc.z),
    });
    if (!block || block.isAir || block.isLiquid) return "skip"; // 已消失 → 跳过
    if (classifyTreeBlock(block.typeId) !== target.kind) {
      console.warn(
        `[MockPlayer] chopOneTree ${botName} 目标 (${target.loc.x},${target.loc.y},${target.loc.z}) ` +
          `当前为 ${block.typeId}（非${target.kind === "log" ? "原木" : "树叶"}），跳过——绝不挖非木头方块`,
      );
      return "skip";
    }
    expectedTypeId = block.typeId;
  } catch {
    return "skip"; // 区块未加载/读取失败 → 目标不可信，跳过（重扫计划会纠正）
  }

  // 工具策略（每块破坏前注入；全背包强制策略——core 决策）
  // ⚠️ 传 handSlot：主手已最优 → 不折腾（BUG2 防倒腾；斧头已入主手后
  //   pickBestTool 指向主手槽自身 → setMainhandSlot 抛无效槽位被吞 →
  //   背包明明有斧头却永远换不上）
  const ensureTool = async (): Promise<void> => {
    const cur = resolveBotPlayer(botName);
    if (!cur) return;
    const kind: ChopTargetKind = target.kind;
    const slot = pickBestTool(kind, mode, snapshotTools(cur), cur.selectedSlotIndex);
    if (slot !== undefined) {
      // 换工具失败抛 ActionError → breakBlockOnce 内部消化（按不切换继续挖）
      await setMainhandSlot(botName, slot);
      await waitTicks(1); // 工具入主手后等待 1 tick 生效
    }
  };

  // 靠近目标基座（同 x/z、尽量贴近地面）——"超出挖掘距离则缩短距离再挖"
  const approach = async (): Promise<void> => {
    const cur = resolveBotPlayer(botName);
    if (!cur) return;
    stopMining(botName); // ⚠️ 移动前必须立刻停止正在挖掘的动作
    // 导航到目标正下方（y 用假人当前层——地面可达时生成导航目标）
    // 导航高度钳制在假人脚下 2 格内：不对浮空点寻路（够不到的目标由竖向
    // 不可达判定直接剪枝，走不到这里）
    const navTarget = {
      x: target.loc.x + 0.5,
      y: Math.min(target.loc.y - 1, cur.location.y + 2),
      z: target.loc.z + 0.5,
    };
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
      expectedTypeId, // 全程类型守卫：只挖破坏开始时验证过的那块木头
      skipLook: false, // 看向目标方块中心再挖（breakBlockAt 内置扭头）
    });
    if (res === "broken") return "broken"; // 持续挖掘直到目标被破坏 ✓
    if (res === "changed") {
      // 目标中途被换成其他方块（外部改动/衰亡替换）→ 不挖，跳过（铁律）
      console.warn(
        `[MockPlayer] chopOneTree ${botName} 目标 (${target.loc.x},${target.loc.y},${target.loc.z}) 挖掘中途变为其他方块，跳过`,
      );
      return "skip";
    }
    if (res === "far") {
      sawFar = true;
      // ⚠️ 竖向不可达快速判定（用户拍板 BUG：对着够不着的浮空木疯狂寻路）——
      // 目标就在正上/正下方（水平 ≤2 格）且垂直差已超挖掘距离 → 靠近无意义，
      // 立即判 far 交上层剪枝（其上方目标全部跳过），不做任何导航
      const cur = resolveBotPlayer(botName);
      if (cur) {
        const dx = target.loc.x + 0.5 - cur.location.x;
        const dz = target.loc.z + 0.5 - cur.location.z;
        const dy = target.loc.y - cur.location.y;
        if (dx * dx + dz * dz <= 4 && Math.abs(dy) > BREAK_MAX_DISTANCE - 1) {
          return "far";
        }
      }
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
  return sawFar ? "far" : "failed";
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
  // 大树留顶剪枝（用户拍板 BUG：高大树挖完范围内原木后，剩余浮空木够不到，
  // 旧逻辑会反复寻路）——一旦确认某高度竖向够不到，其上方目标全部跳过
  let unreachableY: number | undefined;
  let pruned = 0;
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
      if (unreachableY !== undefined && target.loc.y > unreachableY + 1) {
        pruned++;
        continue; // 够不着高度以上的目标：不寻路直接跳过（留顶）
      }
      if (!resolveBotPlayer(botName)?.isValid) return { kind: "failed", reason: "aborted" };
      stopMining(botName); // ⚠️ 每个目标处理前（含 move 前）确保停挖
      const r = await breakUntilGone(botName, target, effectiveMode);
      if (r === "broken") {
        broken++;
        unreachableY = undefined; // 回到可达高度（散落圆木等低目标仍要挖）
      } else if (r === "far") {
        // 靠近后仍超距 = 竖向够不到 → 记录高度，上方目标全部剪枝
        unreachableY = unreachableY === undefined ? target.loc.y : Math.min(unreachableY, target.loc.y);
        console.warn(
          `[MockPlayer] chopOneTree ${botName} 高度 ${target.loc.y} 超出竖向挖掘距离，跳过其上方剩余目标（留顶）`,
        );
      } else if (r === "failed") {
        console.warn(
          `[MockPlayer] chopOneTree ${botName} 目标 ${target.loc.x},${target.loc.y},${target.loc.z} 无法破坏，跳过`,
        );
      }
    }
  }
  if (pruned > 0) {
    console.info(`[MockPlayer] chopOneTree ${botName} 剪枝 ${pruned} 个够不着的高处目标（大树留顶）`);
  }

  // ── ④ 拾取：磁吸传送拾取（2026-09-03 用户规格，替代旧导航式 runPickupFlow）
  //    假人半径 10 格内圆木/树叶掉落物 → teleport 脚下 → 0.5s 自动入包；
  //    零寻路零走动（旧思路导航逐个靠近——慢且可能卡地形）。卡叶残留由
  //    收集模式的树叶清理阶段统一磁吸，不再破遮挡专程跑一趟。
  let picked = 0;
  if (resolveBotPlayer(botName)?.isValid) {
    // 白名单 = 圆木本体 + 树叶掉落物（树苗/果实——方块 id ≠ 物品 id，
    // 树叶方块破坏掉的是 sapling 而不是 leaves）
    picked = await vacuumNearbyDrops(botName, WOODCUT_LOOT_TYPES);
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
