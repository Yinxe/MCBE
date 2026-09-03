// ─── 自动钓鱼任务（natural：共享点池 + fishOnce 阶段机） ──
// workMode="fishing"。四阶段循环：find（共享池选点/不足则扫描合并/认领）→
// navigate（前往钓位）→ align（贴近站位 + 面向水域）→ fish（fishOnce 单次
// 钓鱼，结果回写池：成功清零/失败计 strikes ≥3 标记不可用/超时不计）。
// 认领键与选中点经 ctx.data 传递；cleanup 兜底释放认领。
// 跨假人共享池存 runtime/SharedMemory "fishing:pool"（renewing TTL）。

import { system } from "@minecraft/server";

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { hasFishingRod, findFishingSpots, isSpotUsable } from "../../basic/fishing";
import { faceTowards } from "../../basic/PoseGateway";
import { NavigateResult, longNavigateBot, navigateBot } from "../../basic/move";
import { horizontalDistance } from "../../utils";
import {
  claimSpot,
  countUsable,
  FISH_POOL_KEY,
  markFailSpot,
  mergeScanned,
  pickBestSpot,
  POOL_MIN_USABLE,
  POOL_TTL_TICKS,
  releaseSpot,
  resetFailSpot,
  SPOT_MAX_DISTANCE,
  type PoolSpot,
  type SpotPickOptions,
} from "../../../rules/FishingPool";
import type { SharedMemory } from "../../../runtime";
import { fishOnce, type FishingOutcome } from "../fishingFlow";
import { defineLoopTask, type PhaseContext } from "./spec";

// ─── 配置（tick / 格） ─────────────────────────────────

/** 只选自身 16 格内的点（用户规格） */
const MAX_DISTANCE = SPOT_MAX_DISTANCE;
/** 扫描半径（格） */
const SCAN_RADIUS = 16;
/** 池内可用点下限：不足则主动扫描发现并共享 */
const MIN_POOL_USABLE = POOL_MIN_USABLE;
/** 扫描冷却（tick = 6 秒；getBlocks 扫描有开销，限频） */
const SCAN_COOLDOWN_TICKS = 120;
/** 各类失败/等待的重查间隔（tick = 2.5 秒） */
const RECHECK_TICKS = 50;
/** 对齐判定距离（格） */
const ALIGN_DIST = 0.8;
/** 对齐失败距离（格：超出则放弃该点） */
const ALIGN_FAIL_DIST = 3;
/** 导航速度 */
const SPEED = 1;
/** busy 重试等待（tick） */
const BUSY_WAIT_TICKS = 20;

/** 钓鱼任务共享状态 */
interface FishingData {
  /** 当前认领的点（池键；undefined = 未认领） */
  key?: string;
  /** 当前认领的钓鱼点 */
  spot?: PoolSpot;
  /** 下次允许扫描的 tick（限频 getBlocks） */
  nextScanTick: number;
}

// ─── 池操作（阶段辅助） ────────────────────────────────

/** 回写共享池（renewing TTL：活跃即延长） */
function writePool(shared: SharedMemory, pool: PoolSpot[]): void {
  shared.set(FISH_POOL_KEY, pool, POOL_TTL_TICKS, "renewing", system.currentTick);
}

/** 站立点中心（导航目标：格子中心水平坐标，y 取站立层） */
function standCenter(spot: PoolSpot): { x: number; y: number; z: number } {
  return { x: spot.stand.x + 0.5, y: spot.stand.y, z: spot.stand.z + 0.5 };
}

/** 释放当前认领点（幂等；清空 data 记录） */
function releaseClaim(ctx: PhaseContext<FishingData>): void {
  if (!ctx.data.key) return;
  writePool(ctx.shared, releaseSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], ctx.data.key));
  ctx.data.key = undefined;
  ctx.data.spot = undefined;
}

/** 失败计数回写；返回是否已标记不可用（连续失败 ≥ 上限） */
function markFail(ctx: PhaseContext<FishingData>): boolean {
  if (!ctx.data.key) return false;
  const prob = markFailSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], ctx.data.key);
  writePool(ctx.shared, prob.spots);
  return prob.unavailable;
}

/** 对齐到认领点：贴近站位 → 面向水域。失败返回原因（occupied=占用/失效） */
async function alignToSpot(ctx: PhaseContext<FishingData>): Promise<{ ok: boolean; occupied?: boolean }> {
  const spot = ctx.data.spot;
  const bot = resolveBotPlayer(ctx.botName);
  if (!bot || !spot) return { ok: false };
  const center = standCenter(spot);
  if (!isSpotUsable(bot.dimension, spot.stand, bot.id)) return { ok: false, occupied: true };

  // 距离超容差 → 短导航贴近；仍超失败距离 → 放弃（调用方换点）
  let d = horizontalDistance(bot.location, center);
  if (d > ALIGN_DIST) {
    const nav = await navigateBot(ctx.botName, center, SPEED);
    const refreshed = resolveBotPlayer(ctx.botName);
    if (!refreshed) return { ok: false };
    d = horizontalDistance(refreshed.location, center);
    if (nav !== NavigateResult.Arrived && d > ALIGN_FAIL_DIST) return { ok: false };
  }

  // 面向水域（兴趣点原则：身体朝向 + 视线都对准瞄准点——视线影响抛竿落点）
  const cur = resolveBotPlayer(ctx.botName);
  if (!cur) return { ok: false };
  try {
    await faceTowards(cur, spot.aim.target);
  } catch {
    /* 转向失败不致命（抛竿仍可用朝向近似） */
  }
  return { ok: true };
}

// ─── 任务定义 ──────────────────────────────────────────

/** 自动钓鱼（自然流程循环）任务 */
export const fishingTask = defineLoopTask<FishingData>({
  workMode: "fishing",
  kind: "natural",
  label: "自动钓鱼",
  createData: () => ({ nextScanTick: 0 }),
  initial: "find",
  cleanup: (ctx) => {
    // 兜底：任务结束（取消/完成/失败）释放认领（正常流转中已释放则空操作）
    if (ctx.data.key) {
      ctx.shared.set(
        FISH_POOL_KEY,
        releaseSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], ctx.data.key),
        POOL_TTL_TICKS,
        "renewing",
        system.currentTick,
      );
    }
  },
  phases: {
    find: {
      label: "找点",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        if (!bot) {
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        if (!hasFishingRod(ctx.botName)) {
          ctx.notify("没有鱼竿，等待装备后自动开始");
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        const dimensionId = bot.dimension.id;
        const spotOptions: SpotPickOptions = {
          center: bot.location,
          maxDistance: MAX_DISTANCE,
          isValid: (spot) => isSpotUsable(bot.dimension, spot.stand, bot.id),
        };
        // 池内可用点不足 → 主动扫描（限频；getBlocks 有开销）
        const pool = ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [];
        if (countUsable(pool, ctx.botName, dimensionId, spotOptions) < MIN_POOL_USABLE && system.currentTick >= ctx.data.nextScanTick) {
          const scanned = findFishingSpots(bot.location, bot.dimension, SCAN_RADIUS);
          if (!scanned.reason && scanned.spots.length > 0) {
            writePool(ctx.shared, mergeScanned(pool, scanned.spots, dimensionId));
          }
          ctx.data.nextScanTick = system.currentTick + SCAN_COOLDOWN_TICKS;
        }
        const pick = pickBestSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], ctx.botName, bot.location, dimensionId, spotOptions);
        if (!pick) {
          ctx.notify("附近没有可用钓鱼点，继续等待");
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        // 换点前释放旧认领（防泄漏占用——占用者本人才能再次通过可用性判定）
        if (ctx.data.key && ctx.data.key !== pick.key) releaseClaim(ctx);
        ctx.data.key = pick.key;
        ctx.data.spot = pick;
        writePool(ctx.shared, claimSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], pick.key, ctx.botName));
        ctx.notify(`找到钓鱼点，前往（${pick.aim.level} 星）`);
        return "navigate";
      },
    },
    navigate: {
      label: "前往",
      run: async (ctx) => {
        const spot = ctx.data.spot;
        if (!spot) return "find";
        const nav = await longNavigateBot(ctx.botName, standCenter(spot), SPEED);
        if (nav !== NavigateResult.Arrived) {
          ctx.notify("前往钓鱼点失败，换点");
          releaseClaim(ctx);
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        return "align";
      },
    },
    align: {
      label: "对齐",
      run: async (ctx) => {
        if (!ctx.data.spot) return "find";
        const aligned = await alignToSpot(ctx);
        if (!aligned.ok) {
          if (aligned.occupied) ctx.notify("钓鱼点被占用或失效，换点");
          releaseClaim(ctx);
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        return "fish";
      },
    },
    fish: {
      label: "钓鱼",
      run: async (ctx) => {
        const spot = ctx.data.spot;
        if (!spot) return "find";
        const outcome = await fishOnce(ctx.botName);
        return handleOutcome(ctx, outcome);
      },
    },
  },
});

/** 单次钓鱼结果 → 阶段流转（回写池 + 释放/续钓决策） */
function handleOutcome(ctx: PhaseContext<FishingData>, outcome: FishingOutcome): string {
  if (outcome.kind === "caught") {
    // 成功：清零失败计数，同点续钓
    if (ctx.data.key) {
      writePool(ctx.shared, resetFailSpot(ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [], ctx.data.key));
    }
    return "align";
  }
  if (outcome.kind === "timeout") {
    return "align"; // 超时不计失败，同点重试
  }
  switch (outcome.reason) {
    case "offline":
    case "no-rod":
      releaseClaim(ctx);
      return "find";
    case "busy":
      return "align"; // 保留认领，对齐后重钓（fishOnce 有内部重试节流）
    default: {
      // landed/snagged/hook-lost/error：失败计数；≥3 次标记不可用换点
      if (markFail(ctx)) {
        ctx.notify("钓鱼点多次失败，已标记不可用");
        releaseClaim(ctx);
        return "find";
      }
      ctx.notify("钓鱼点异常，原地重试");
      return "align";
    }
  }
}
