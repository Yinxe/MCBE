// ─── 闭包钓鱼流程（mc 层） ─────────────────────────────
// fishOnce：一次调用完成一次完整钓鱼（发杆 → 稳定 → 监听上钩 → 收竿），
// 返回明确结果（caught / timeout / failed + 失败原因）。
//
// 流程（用户规格）：
//   1. 发杆（无鱼钩才发杆）——**鱼钩抛竿即生成**（无需轮询等生成）
//   2. await + timeout 等待 STABILIZE_TICKS（1.25 秒）：鱼钩下落至稳定目标
//      位置（入水先下沉再上浮，稳定后记录坐标才可信——稳定期内下沉会被
//      咬钩判定误判）
//   3. 落点检查：鱼钩不在水中 = 本次钓鱼直接失败（勾中实体生物 → snagged /
//      勾中固体方块 → landed），返回失败原因
//   4. 监听上钩（最长 BITE_TIMEOUT_TICKS = 45 秒）：窗口累计净下降超阈值
//      连续 2 窗口 = 明显下沉（咬钩）→ 触发收杆信号（通知主人 + 自动收竿）
//   5. 超时 → 收竿无获（timeout）；鱼钩中途消失 → hook-lost 失败
//
// 通知：主人收到 [模拟玩家][钓鱼] 提醒（上钩 / 超时 / 失败原因）

import { system, world } from "@minecraft/server";
import type { Entity } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { isBiteDrop, isWaterBlock, judgeHookPlacement, type HookPlacement } from "../../core/tasks/FishingRules";
import { botRegistry } from "../bootstrap/context";
import { castFishingRod, findOwnHooks, reelFishingRod } from "./fishing";

// ─── 常量 ────────────────────────────────────────────────

/** 浮漂稳定等待（tick，=1.25 秒：鱼钩抛竿即生成，下落至稳定目标位置的时间） */
const STABILIZE_TICKS = 25;
/** 下沉检测窗口（tick，=4 tick：咬钩下沉持续时间仅约 10 tick（收竿窗口），
 *  检测窗口必须足够密，保证在收竿窗口内捕获净下降并完成 2 窗口确认） */
const BITE_CHECK_TICKS = 4;
/** 连续净下降窗口数（防抖动误判） */
const BITE_CONFIRM_WINDOWS = 2;
/** 上钩监听上限（tick，=45 秒，用户规格） */
const BITE_TIMEOUT_TICKS = 900;
/** 挂实体检测半径（格，=0.25 极小值：鱼钩**直接勾住**实体才算挂住——物理贴合；
 *  getEntities 按实体中心点计算距离，半径放大即误判水中正常游动的鱼） */
const PLACEMENT_ENTITY_RADIUS = 0.25;

// ─── 结果类型（区分度：成功 / 无获超时 / 失败+原因） ────

/** 钓鱼失败原因（offline/no-rod 可重试；landed/snagged 需换点；hook-lost 异常） */
export type FishingFailureReason =
  | "offline" // 假人不可用
  | "no-rod" // 无鱼竿（主手与热键栏都没有）
  | "landed" // 鱼钩勾中固体方块（落陆地，未入水）
  | "snagged" // 鱼钩勾中实体生物
  | "hook-lost" // 监听中鱼钩消失（异常）
  | "busy" // 已有进行中的钓鱼流程（防重入）
  | "error"; // 执行失败（可重试）

/** 一次钓鱼的结果：caught=上钩收竿 / timeout=45 秒无鱼超时收竿 / failed=失败+原因 */
export type FishingOutcome = { kind: "caught" } | { kind: "timeout" } | { kind: "failed"; reason: FishingFailureReason };

// ─── 防重入 ──────────────────────────────────────────────

/** 进行中的钓鱼流程（按假人键控，防并发双收竿） */
const runningFishing = new Set<string>();

// ─── 工具 ────────────────────────────────────────────────

function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

/** 通知假人主人（[模拟玩家][钓鱼] 前缀 + 详细；玩家不可达忽略） */
function notifyOwner(botName: string, detail: string): void {
  try {
    const record = botRegistry.get(botName);
    if (!record?.ownerName) return;
    world
      .getPlayers({ name: record.ownerName })[0]
      ?.sendMessage(`${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${color.muted}${detail}`);
  } catch {
    /* 通知失败不影响主流程 */
  }
}

/** 失败原因 → 中文描述（通知用） */
function failureLabel(reason: FishingFailureReason): string {
  switch (reason) {
    case "offline":
      return "假人不在线";
    case "no-rod":
      return "没有鱼竿";
    case "landed":
      return "鱼钩勾中固体方块（落陆地），本次钓鱼失败";
    case "snagged":
      return "鱼钩勾中实体生物，本次钓鱼失败";
    case "hook-lost":
      return "鱼钩中途消失，本次钓鱼失败";
    case "busy":
      return "已有钓鱼流程进行中";
    default:
      return "执行失败";
  }
}

// ─── 流程阶段 ────────────────────────────────────────────

/**
 * 稳定后落点检查：鱼钩所在方块是否水 + 附近是否勾中实体生物。
 * @returns 落点状态；鱼钩实体丢失（收回/消失）返回 undefined（调用方按 hook-lost 处理）
 */
async function checkPlacement(botName: string, hookId: string): Promise<HookPlacement | undefined> {
  const hook = world.getEntity(hookId) as Entity | undefined;
  if (!hook) return undefined;
  const pos = hook.location;
  const block = hook.dimension.getBlock({
    x: Math.floor(pos.x),
    y: Math.floor(pos.y),
    z: Math.floor(pos.z),
  });
  const inWater = block ? isWaterBlock(block.typeId) : false;
  // 附近实体检测（用户规格：**任何实体**都算勾中——玩家/鱼/水生生物/其他
  // 生物都不行；仅鱼钩本身除外）
  let hasEntityNearby = false;
  try {
    hasEntityNearby = hook.dimension
      .getEntities({ location: pos, maxDistance: PLACEMENT_ENTITY_RADIUS })
      .some((e) => e.id !== hookId && e.typeId !== "minecraft:fishing_hook");
  } catch {
    /* 维度不可访问按无实体处理 */
  }
  return judgeHookPlacement(inWater, hasEntityNearby);
}

/**
 * 监听上钩（最长 45 秒）：窗口累计净下降超阈值连续 2 窗口 = 咬钩 → 收竿。
 * 鱼钩中途消失 → hook-lost；超时 → 收竿（无获）返回 timeout。
 */
async function watchForBite(botName: string, hookId: string): Promise<FishingOutcome> {
  // 稳定后基准高度（用户规格：记录鱼钩坐标）
  let baseY: number | undefined;
  let winStartY: number | undefined;
  let downStreak = 0;

  for (let waited = 0; waited < BITE_TIMEOUT_TICKS; waited += BITE_CHECK_TICKS) {
    await waitTicks(BITE_CHECK_TICKS);
    const hook = world.getEntity(hookId) as Entity | undefined;
    if (!hook) return { kind: "failed", reason: "hook-lost" };
    const y = hook.location.y;
    if (baseY === undefined) {
      baseY = y;
      console.warn(`[MockPlayer] fishOnce ${botName} hook stabilized at y=${y}`);
    }
    if (winStartY === undefined) winStartY = y;

    // 窗口净下降 = 当前 - 窗口开头（负值=下沉）
    if (isBiteDrop(y - winStartY)) {
      downStreak++;
      if (downStreak >= BITE_CONFIRM_WINDOWS) {
        // ── 咬钩：触发收杆信号（通知主人 + 自动收竿） ──
        console.warn(`[MockPlayer] fishOnce ${botName} bite detected (drop ${(y - winStartY).toFixed(2)} from base ${baseY.toFixed(2)})`);
        notifyOwner(botName, `${color.success}鱼上钩了，正在收竿！`);
        const reel = await reelFishingRod(botName);
        if (reel === "reeled") return { kind: "caught" };
        // 收竿异常：no-hook=钩已消失 / offline=假人下线 / no-rod=鱼竿没了 / error=执行失败
        const reason: FishingFailureReason =
          reel === "no-hook" ? "hook-lost" : reel === "offline" ? "offline" : reel === "no-rod" ? "no-rod" : "error";
        return { kind: "failed", reason };
      }
    } else {
      downStreak = 0;
    }
    winStartY = y;
  }

  // ── 超时（45 秒无鱼）：收竿无获 ──
  console.warn(`[MockPlayer] fishOnce ${botName} bite timeout (${BITE_TIMEOUT_TICKS} ticks), reeling`);
  notifyOwner(botName, `${color.warn}等待 ${BITE_TIMEOUT_TICKS / 20} 秒无鱼上钩，收竿结束`);
  const reel = await reelFishingRod(botName);
  if (reel !== "reeled") {
    // 收杆失败（假人下线 offline / 钩已消失 no-hook / 执行失败）——日志可见，钩残留由下次流程 already-cast 接管
    console.warn(`[MockPlayer] fishOnce ${botName} timeout reel=${reel}`);
  }
  return { kind: "timeout" };
}

// ─── 公开入口 ────────────────────────────────────────────

/**
 * 完成一次完整钓鱼（闭包流程）：发杆 → 稳定等待 → 落点检查 → 监听上钩
 * （45 秒）→ 下沉触发收杆。异常（勾中实体/固体方块/鱼钩消失）直接判定
 * 失败并返回原因。
 *
 * @param botName - 假人名
 * @returns 结果：caught=上钩收竿 / timeout=超时收竿 / failed=失败+原因
 */
export async function fishOnce(botName: string): Promise<FishingOutcome> {
  if (runningFishing.has(botName)) return { kind: "failed", reason: "busy" };
  runningFishing.add(botName);
  try {
    // ── 1. 发杆（无钩才发；already-cast=已有钩 → 直接进入流程） ──
    const cast = await castFishingRod(botName);
    if (cast === "offline") return { kind: "failed", reason: "offline" };
    if (cast === "no-rod") return { kind: "failed", reason: "no-rod" };
    if (cast === "error") return { kind: "failed", reason: "error" };
    console.warn(`[MockPlayer] fishOnce ${botName} cast=${cast}`);

    // ── 2. 稳定等待（await + timeout 1.25 秒：鱼钩抛竿即生成，下落至稳定位置） ──
    await waitTicks(STABILIZE_TICKS);

    // ── 3. 读取鱼钩状态 + 落点检查（勾中实体/固体方块/钩丢失 = 直接失败） ──
    const hookId = findOwnHooks(botName)[0]?.id;
    if (!hookId) return { kind: "failed", reason: "hook-lost" }; // 发杆成功但钩不在 = 异常丢失
    const placement = await checkPlacement(botName, hookId);
    if (placement !== "water") {
      const reason: FishingFailureReason = placement === undefined ? "hook-lost" : placement;
      console.warn(`[MockPlayer] fishOnce ${botName} placement=${placement ?? "missing"}`);
      notifyOwner(botName, `${color.error}${failureLabel(reason)}`);
      return { kind: "failed", reason };
    }

    // ── 4. 记录坐标 + 监听上钩（45 秒） ──
    return await watchForBite(botName, hookId);
  } finally {
    runningFishing.delete(botName);
  }
}
