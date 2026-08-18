// ─── 自动钓鱼能力（新框架 scripts/ai：Behavior 状态机，跨假人共享钓鱼点） ──
// 用户规格（2026-08-18，基于生物 AI 重写；旧 legacy 树钓鱼/TAG 保留）：
//   - **共享钓鱼点**：所有钓鱼假人共用 SharedMemory "fishing:pool" 池
//     （renewing TTL 活跃即延长）——一个假人发现的点全体可见
//   - **只选 16 格内**：假人只能从池里选**自身 16 格内**的有效钓鱼点
//     （maxDistance 过滤）
//   - **现场无实体**：有效钓鱼点上不能有其他实体，点位半径 1 格内也不能有
//     其他实体（isSpotUsable 现场判定——选点/就位都复核）
//   - **有效点不足**：池内**有效点**（状态 + 距离 + 现场实体全合格）不足
//     下限时，下次寻找的假人主动扫描发现新钓鱼点并合并进池共享
//   - **占用机制**：池状态占用（occupied）可被独占者使用；现场实体占点 =
//     不可用（实时判定，实体离开自动释放）
//   - **看向目标水域**：抛竿前 setBodyRotation 朝向水域 + lookAt 持续注视
//     （看向水域才能正常抛竿）
//   - **连续 3 次抛竿失败** → 标记该点不可用并共享（markFailSpot），从共享池
//     重新选点；池有效点不足/无效 → 发现新点并共享
//
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   init → find（取池/不足则扫描合并/选点/独占占用）→ navigate（longNavigateBot
//   协程轮询）→ align（对齐 + 朝向水域 + lookAt）→ fish（fishOnce 协程轮询）
//   → 成败分流回 find/align/wait。协程有界，reset（切换/下线）→ stopMoving +
//   释放占点。

import { world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { longNavigateBot, navigateBot, NavigateResult } from "../../basic/move";
import { findFishingSpots, hasFishingRod, isSpotUsable } from "../../basic/fishing";
import { fishOnce, type FishingOutcome } from "../../flow/fishingFlow";
import { computeTargetYaw } from "../../../rules/FishingRules";
import { lookAt } from "../../basic/PoseGateway";
import {
  claimSpot,
  countUsable,
  FISH_POOL_KEY,
  mergeScanned,
  markFailSpot,
  pickBestSpot,
  POOL_MIN_USABLE,
  POOL_TTL_TICKS,
  releaseSpot,
  resetFailSpot,
  SPOT_MAX_DISTANCE,
  type PoolSpot,
  type SpotPickOptions,
} from "../../../rules/FishingPool";

/** 自动钓鱼行为配置（统一管理；makeFishingBehavior 可传自定义覆盖） */
export interface FishingBehaviorConfig {
  /** 选点最大距离（格，用户规格：假人只能从池里选**自身 16 格内**的钓鱼点） */
  maxDistance: number;
  /** 扫描半径（格，发现新钓鱼点；默认 16——用户调参） */
  scanRadius: number;
  /** 池内可用点下限：不足则主动发现新点并共享（默认 3） */
  minPoolUsable: number;
  /** 扫描冷却（引擎周期 = 10 tick）：避免每周期重扫 */
  scanCooldownCycles: number;
  /** 无可用点/无竿等待周期 */
  recheckCycles: number;
  /** 到达对齐距离（格，坐标正中心） */
  alignDist: number;
  /** 微调失败容忍距离（格）：对齐失败但已够近 → 仍可抛竿 */
  alignFailDist: number;
  /** 通知节流（引擎周期 = 10 tick） */
  notifyCooldownCycles: number;
  /** 初始准备周期（init 阶段停顿，等实体稳定） */
  initCycles: number;
  /** 导航速度 */
  speed: number;
}

/** 默认配置（统一管理） */
export const DEFAULT_FISH_CONFIG: FishingBehaviorConfig = {
  maxDistance: SPOT_MAX_DISTANCE, // 16——用户规格：只选自身 16 格内
  scanRadius: 16,
  minPoolUsable: POOL_MIN_USABLE,
  scanCooldownCycles: 12, // 120 tick = 6 秒
  recheckCycles: 5, // 50 tick = 2.5 秒
  alignDist: 0.8,
  alignFailDist: 3,
  notifyCooldownCycles: 10, // 100 tick = 5 秒
  initCycles: 2,
  speed: 1,
};

/** 状态机阶段 */
type Phase = "init" | "find" | "navigate" | "align" | "fish" | "wait";

/** 站立方格中心（导航/对齐目标） */
function standCenter(spot: PoolSpot): { x: number; y: number; z: number } {
  return { x: spot.stand.x + 0.5, y: spot.stand.y, z: spot.stand.z + 0.5 };
}

/** 停止假人移动（reset/切换时中断进行中导航） */
function stopBotMoving(bot: SimulatedPlayer | undefined): void {
  if (!bot) return;
  try {
    bot.stopMoving();
  } catch {
    /* 实体失效忽略 */
  }
}

/**
 * 创建自动钓鱼行为（record.workMode === "fishing" 时由引擎注册）。
 * ⚠️ 依赖 ctx.shared（跨假人共享内存池）——生物 AI 引擎每周期注入同一实例。
 */
export function makeFishingBehavior(config: FishingBehaviorConfig = DEFAULT_FISH_CONFIG): Behavior {
  let phase: Phase = "init";
  let wait = config.initCycles; // 当前阶段剩余周期计数
  let notifyCooldown = 0; // 通知节流（周期递减）

  /** 当前独占占用的共享钓鱼点 */
  let currentKey: string | undefined;
  let currentSpot: PoolSpot | undefined;
  /** 导航协程 + 完成标志 */
  let navRun: Promise<unknown> | undefined;
  let navResult: NavigateResult | undefined;
  /** 对齐微调协程 + 完成标志 */
  let alignRun: Promise<unknown> | undefined;
  let alignResult: NavigateResult | undefined;
  /** 钓鱼协程（fishOnce）+ 完成标志 */
  let fishRun: Promise<unknown> | undefined;
  let fishResult: FishingOutcome | undefined;
  let scanCooldown = 0; // 扫描冷却（周期）
  // ⚠️ reset 无参——闭包内捕获共享池引用与实体，用于释放占点/中断移动
  let lastShared: (import("../../../ai").SharedMemory) | undefined;
  let lastBot: SimulatedPlayer | undefined;

  /** 通知附近玩家（节流；[模拟玩家][钓鱼] 前缀，附近 16 格） */
  const notify = (botName: string, detail: string): void => {
    if (notifyCooldown > 0) return;
    notifyCooldown = config.notifyCooldownCycles;
    try {
      const bot = lastBot;
      if (!bot) return;
      const msg = `${color.accent}[模拟玩家][钓鱼] ${color.playerName}${botName} ${color.muted}${detail}`;
      for (const p of world.getPlayers()) {
        if (p.name === botName) continue;
        const dx = p.location.x - bot.location.x;
        const dz = p.location.z - bot.location.z;
        if (Math.hypot(dx, dz) <= 16) p.sendMessage(msg);
      }
    } catch {
      /* 通知失败不影响主流程 */
    }
  };

  /** 写池回共享内存（renewing 延长过期——活跃即延长） */
  const writePool = (ctx: AiBehaviorContext, pool: PoolSpot[]): void => {
    ctx.shared.set(FISH_POOL_KEY, pool, POOL_TTL_TICKS, "renewing", ctx.tick);
  };

  /** 释放当前独占占点（重新回池共享） */
  const releaseCurrent = (ctx: AiBehaviorContext): void => {
    if (currentKey) {
      let pool = ctx.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [];
      pool = releaseSpot(pool, currentKey);
      writePool(ctx, pool);
      currentKey = undefined;
      currentSpot = undefined;
    }
  };

  /** 发起导航到站立格中心（longNavigateBot 段切，支持共享远点） */
  const startNav = (botName: string, spot: PoolSpot): void => {
    navResult = undefined;
    navRun = longNavigateBot(botName, standCenter(spot), config.speed)
      .then((r) => {
        navResult = r;
      })
      .catch(() => {
        navResult = NavigateResult.Error;
      });
  };

  /** 发起对齐微调导航（短距到中心） */
  const startAlignNav = (botName: string, spot: PoolSpot): void => {
    alignResult = undefined;
    alignRun = navigateBot(botName, standCenter(spot), config.speed)
      .then((r) => {
        alignResult = r;
      })
      .catch(() => {
        alignResult = NavigateResult.Error;
      });
  };

  /** 发起一次钓鱼协程（fishOnce 闭包：抛竿→稳定→监听→收竿） */
  const startFish = (botName: string): void => {
    fishResult = undefined;
    fishRun = fishOnce(botName)
      .then((o) => {
        fishResult = o;
      })
      .catch(() => {
        fishResult = { kind: "failed", reason: "error" };
      });
  };

  /** 状态机复位（切换/卸载/下线） */
  const reset = (): void => {
    if (lastBot) stopBotMoving(lastBot);
    // 释放占点（回池共享）
    if (lastShared && currentKey) {
      let pool = lastShared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [];
      pool = releaseSpot(pool, currentKey);
      lastShared.set(FISH_POOL_KEY, pool, POOL_TTL_TICKS, "renewing");
    }
    phase = "init";
    wait = config.initCycles;
    notifyCooldown = 0;
    currentKey = undefined;
    currentSpot = undefined;
    navRun = navResult = undefined;
    alignRun = alignResult = undefined;
    fishRun = fishResult = undefined;
    scanCooldown = 0;
    lastShared = undefined;
    lastBot = undefined;
  };

  // ── 各阶段实现（同步短步） ──

  /** find：取池 → 不足则扫描合并共享 → 选点 → 独占占用 */
  const doFind = (ai: AiBehaviorContext): void => {
    const botName = ai.botName;
    const bot = ai.bot;
    if (!bot) {
      phase = "wait";
      wait = 2;
      return;
    }
    const dim = bot.dimension.id;
    // 无鱼竿：提示 + 等待（不扫描/不选点；鱼竿可放任意背包——hasFishingRod 全背包感知）
    if (!hasFishingRod(botName)) {
      notify(botName, "没有鱼竿，请放入背包");
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    let pool = ai.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [];
    // 选点约束（用户规格）：只选**自身 maxDistance(16) 内** + **点位半径 1 内
    // 无其他实体**（isSpotUsable = 现场实体占用 + 点位仍构成钓鱼点）的有效点。
    const botLocation = bot.location;
    const spotOptions: SpotPickOptions = {
      center: botLocation,
      maxDistance: config.maxDistance,
      // 现场有效性：排除查询者自己 + 鱼钩（钓具不阻挡抛竿）；
      // 其他任何实体（含其他假人）在点位半径 1 内 → 该点不可用
      isValid: (spot) => isSpotUsable(bot.dimension, spot.stand, bot.id),
    };
    // 有效点不足（状态 + 距离 + 现场实体全判定）→ 主动扫描发现新点并合并共享
    if (countUsable(pool, botName, dim, spotOptions) < config.minPoolUsable && scanCooldown <= 0) {
      const scanned = findFishingSpots(botLocation, bot.dimension, config.scanRadius);
      if (!scanned.reason && scanned.spots.length > 0) {
        pool = mergeScanned(pool, scanned.spots, dim);
        writePool(ai, pool);
      }
      scanCooldown = config.scanCooldownCycles;
    } else if (scanCooldown > 0) {
      scanCooldown--;
    }
    const pickGap = pickBestSpot(pool, botName, botLocation, dim, spotOptions);
    if (!pickGap) {
      notify(botName, "附近没有可用的钓鱼点，稍后再找");
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    // 独占占用（共享——其他假人不再选它）
    currentKey = pickGap.key;
    currentSpot = pickGap;
    pool = claimSpot(pool, currentKey, botName);
    writePool(ai, pool);
    notify(botName, `找到钓鱼点，前往（${pickGap.aim.level} 星）`);
    startNav(botName, pickGap);
    phase = "navigate";
  };

  /** navigate：轮询导航完成 → 到达进 align；失败释放占点回 find */
  const doNavigate = (ai: AiBehaviorContext): void => {
    if (navResult === undefined) return; // 导航中
    const r = navResult;
    navRun = navResult = undefined;
    if (r !== NavigateResult.Arrived) {
      releaseCurrent(ai);
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    phase = "align"; // 到达站位 → 对齐 + 看向水域
  };

  /** align：对准中心（必要时微调）→ 身体朝向水域 + lookAt 持续注视 → 抛竿 */
  const doAlign = (ai: AiBehaviorContext): void => {
    const bot = ai.bot;
    if (!bot || !currentSpot || !currentKey) {
      phase = "find";
      return;
    }
    // 占用复核：现场被其他实体占用 / 点已失效 → 释放重找（isSpotUsable 需 Dimension）
    if (!isSpotUsable(bot.dimension, currentSpot.stand, bot.id)) {
      releaseCurrent(ai);
      notify(ai.botName, "钓鱼点被占用或失效，换点");
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    const center = standCenter(currentSpot);
    const dist = Math.hypot(bot.location.x - center.x, bot.location.z - center.z);
    if (dist > config.alignDist) {
      // 需要微调对齐（短距导航；轮询完成）
      if (alignResult === undefined) {
        if (!alignRun) startAlignNav(ai.botName, currentSpot);
        return;
      }
      const r = alignResult;
      alignRun = alignResult = undefined;
      if (r !== NavigateResult.Arrived) {
        const d2 = Math.hypot(bot.location.x - center.x, bot.location.z - center.z);
        if (d2 > config.alignFailDist) {
          releaseCurrent(ai);
          phase = "find";
          return;
        }
        // 已够近（容忍内）→ 继续抛竿
      }
    }
    // 身体朝向水域 + 持续看向目标水域（用户规格：看向水域才能正常抛竿）
    try {
      bot.setBodyRotation(computeTargetYaw(center, currentSpot.aim.target));
      lookAt(bot, {
        x: currentSpot.aim.target.x,
        y: currentSpot.aim.target.y + 0.5,
        z: currentSpot.aim.target.z,
      });
    } catch {
      /* 朝向/注视失败（chunkload 受限等）不影响抛竿 */
    }
    startFish(ai.botName);
    phase = "fish";
  };

  /** fish：轮询 fishOnce 完成 → 成败分流（失败计数/不可用标记/换点） */
  const doFish = (ai: AiBehaviorContext): void => {
    if (fishResult === undefined) return; // 钓鱼进行中（最长 45 秒）
    const outcome = fishResult;
    fishRun = fishResult = undefined;
    if (!currentKey) {
      phase = "find";
      return;
    }
    let pool = ai.shared.get<PoolSpot[]>(FISH_POOL_KEY) ?? [];
    if (outcome.kind === "caught") {
      // 钓到鱼：清零失败计数，同点继续垂钓（重新看向水域）
      pool = resetFailSpot(pool, currentKey);
      writePool(ai, pool);
      phase = "align";
    } else if (outcome.kind === "failed") {
      if (outcome.reason === "offline" || outcome.reason === "no-rod") {
        // 假人不可用/无竿：与点无关 → 释放占点重找
        releaseCurrent(ai);
        phase = "find";
        return;
      }
      if (outcome.reason === "busy") {
        phase = "wait";
        wait = 2;
        return;
      }
      // landed/snagged/hook-lost/error → 记该点连续失败
      const prob = markFailSpot(pool, currentKey);
      pool = prob.spots;
      writePool(ai, pool);
      if (prob.unavailable) {
        // 连续 3 次失败 → 标记不可用并共享 → 从共享池挑下一点
        notify(ai.botName, "该钓鱼点连续抛竿失败，已标记不可用并共享，换点");
        currentKey = undefined;
        currentSpot = undefined;
        phase = "find";
      } else {
        notify(ai.botName, "本次抛竿失败，重新尝试");
        phase = "align"; // 同点再试（连续计数累计）
      }
    } else {
      // timeout：45 秒无鱼收竿——无钓获属正常，同点继续（不清失败计数）
      phase = "align";
    }
  };

  return {
    name: "fishing",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验（可用性由引擎门卫统一处理）
      return ctx.memory.get<string>("workMode") === "fishing";
    },
    onActivate: (ctx) => stopBotMoving((ctx as AiBehaviorContext).bot),
    reset,
    step: (ctx) => {
      const ai = ctx as AiBehaviorContext;
      lastShared = ai.shared;
      lastBot = ai.bot;
      if (notifyCooldown > 0) notifyCooldown--;
      switch (phase) {
        case "init":
          if (--wait > 0) return;
          phase = "find";
          break;
        case "find":
          doFind(ai);
          break;
        case "navigate":
          doNavigate(ai);
          break;
        case "align":
          doAlign(ai);
          break;
        case "fish":
          doFish(ai);
          break;
        case "wait":
          if (--wait > 0) return;
          phase = "find";
          break;
      }
    },
  };
}
