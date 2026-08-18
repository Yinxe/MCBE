// ─── 自动砍树能力（新框架 scripts/ai：Behavior 状态机，跨假人共享树资源池） ──
// 用户规格（2026-08-18，基于生物 AI；树共享池对齐钓鱼共享池）：
//   - **共享树资源**：所有砍树假人共用 SharedMemory "woodcut:pool" 池
//     （renewing TTL 活跃即延长）——一个假人发现的树全体可见
//   - **只认领附近 16 格**：pick/count 按树中心距假人 3D 距离过滤
//   - **多假人不抢夺**：claimTree 独占占用，他人 pick 跳过
//   - **可认领不足**（POOL_MIN_TREES=3）→ 下次寻找的假人主动扫描发现新树
//     并合并进池共享
//   - **处理完移除树资源**：chopOneTree 完成后 removeTree 从池删除
//   - **模式枚举**：logs=原木模式（斧头策略）/ collect=收集模式（圆木斧头 +
//     树叶强制策略）；工具策略与单树砍伐计划在 core（WoodcutRules/ChopPlan）
//
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   init → find（取池/不足则扫描合并/选树/独占认领/生成计划）→ chop
//   （chopOneTree 协程轮询）→ finish（移除树资源+通知）→ 回 find。

import { world } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { color } from "@yinxe/toolkit";

import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { scanTreesFromSets } from "../../flow/treeScan";
import { chopOneTree, type WoodcutOutcome } from "../../flow/woodcutFlow";
import { planChop, type ChopWorld } from "../../../rules/woodcut/ChopPlan";
import { TREE_LEAF_TYPE_IDS, TREE_LOG_TYPE_IDS } from "../../../rules/tree/TreeRules";
import {
  claimTree,
  countClaimable,
  mergeScannedTrees,
  pickBestTree,
  POOL_MIN_TREES,
  POOL_TTL_TICKS,
  releaseTree,
  removeTree,
  TREE_POOL_KEY,
  TREE_POOL_MAX_DISTANCE,
  type PoolTree,
  type TreePickOptions,
} from "../../../rules/woodcut/TreePool";
import { normalizeChopMode, type ChopMode } from "../../../rules/woodcut/WoodcutRules";

/** 自动砍树行为配置 */
export interface WoodcutBehaviorConfig {
  /** 扫描半径（格，发现新树；16） */
  scanRadius: number;
  /** 只认领附近 maxDistance 格内的树资源（用户规格 16） */
  maxDistance: number;
  /** 池内可认领树资源下限：不足则主动扫描发现新树并共享 */
  minPoolTrees: number;
  /** 扫描冷却（引擎周期 = 10 tick） */
  scanCooldownCycles: number;
  /** 无树等待周期 */
  recheckCycles: number;
  /** 通知节流（引擎周期 = 10 tick；附近 16 格玩家） */
  notifyCooldownCycles: number;
  /** 砍树模式（原木模式 / 收集模式） */
  mode: ChopMode;
  /**
   * 是否破除阻碍挖掘圆木的**其他实心障碍**（泥土/石子等非树方块，紧贴圆木；
   * 用户规格"其他障碍物阻碍挖掘圆木，则需要破除"）。缺省 true；若希望
   * 只挖树内方块、绝不碰周围建筑方块，可置 false（此时仅破树内树叶）。
   */
  breakObstacles: boolean;
}

/** 默认配置 */
export const DEFAULT_WOODCUT_CONFIG: WoodcutBehaviorConfig = {
  scanRadius: 16,
  maxDistance: TREE_POOL_MAX_DISTANCE,
  minPoolTrees: POOL_MIN_TREES,
  scanCooldownCycles: 12, // 120 tick = 6 秒
  recheckCycles: 5, // 50 tick = 2.5 秒
  notifyCooldownCycles: 10, // 100 tick = 5 秒
  mode: "logs",
  breakObstacles: true,
};

/** 状态机阶段 */
type Phase = "init" | "find" | "chop" | "finish" | "wait";

/**
 * 创建自动砍树行为（record.workMode === "woodcut" 时由引擎注册）。
 * ⚠️ 依赖 ctx.shared（跨假人共享记忆池）——生物 AI 引擎每周期注入同一实例。
 */
export function makeWoodcutBehavior(config: WoodcutBehaviorConfig = DEFAULT_WOODCUT_CONFIG): Behavior {
  let phase: Phase = "init";
  let wait = 2; // 初始停顿
  let notifyCooldown = 0;
  let scanCooldown = 0;

  /** 当前独占认领的树 */
  let currentId: string | undefined;
  let currentTree: PoolTree | undefined;
  /** 砍树协程 + 完成标志 */
  let chopRun: Promise<unknown> | undefined;
  let chopResult: WoodcutOutcome | undefined;

  let lastShared: (import("../../../ai").SharedMemory) | undefined;
  let lastBot: SimulatedPlayer | undefined;

  /** 通知附近玩家（节流；[模拟玩家][砍树] 前缀，附近 16 格） */
  const notify = (botName: string, detail: string): void => {
    if (notifyCooldown > 0) return;
    notifyCooldown = config.notifyCooldownCycles;
    try {
      const bot = lastBot;
      if (!bot) return;
      const msg = `${color.accent}[模拟玩家][砍树] ${color.playerName}${botName} ${color.muted}${detail}`;
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

  /** 写池回共享内存（renewing 延长过期） */
  const writePool = (ai: AiBehaviorContext, pool: PoolTree[]): void => {
    ai.shared.set(TREE_POOL_KEY, pool, POOL_TTL_TICKS, "renewing", ai.tick);
  };

  /** 释放认领（回 free 共享——树还在/砍不完） */
  const releaseCurrent = (ai: AiBehaviorContext): void => {
    if (currentId) {
      let pool = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
      pool = releaseTree(pool, currentId);
      writePool(ai, pool);
      currentId = undefined;
      currentTree = undefined;
    }
  };

  /** 处理完移除树资源（从池删除不再共享） */
  const removeCurrent = (ai: AiBehaviorContext): void => {
    if (currentId) {
      let pool = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
      pool = removeTree(pool, currentId);
      writePool(ai, pool);
      currentId = undefined;
      currentTree = undefined;
    }
  };

  /** 当前砍树模式（运行时：优先大脑记忆注入，规格化；缺省配置默认值） */
  const currentMode = (ai: AiBehaviorContext): ChopMode => {
    return normalizeChopMode(ai.memory.get<string>("woodcutMode"), config.mode);
  };

  /** 障碍查看器（mc 层注入 planChop）：紧贴圆木的非树实心方块 = 障碍 */
  const buildChopWorld = (ai: AiBehaviorContext, breakObstacles: boolean): ChopWorld => {
    return {
      isSolidForeign: (loc) => {
        if (!breakObstacles) return false;
        const bot = ai.bot;
        if (!bot) return false;
        try {
          const block = bot.dimension.getBlock(loc);
          if (!block) return false;
          if (block.isAir || block.isLiquid) return false; // 空气/液体不阻
          // 树自身方块（原木/树叶）是计划主目标，不算障碍
          if ((TREE_LOG_TYPE_IDS as readonly string[]).includes(block.typeId)) return false;
          if ((TREE_LEAF_TYPE_IDS as readonly string[]).includes(block.typeId)) return false;
          return true; // 其他实心方块（泥土/石子等）= 阻碍挖圆木的障碍
        } catch {
          return false;
        }
      },
    };
  };

  /** 发起砍树协程（chopOneTree：逐目标破块 + 独立拾取 flow） */
  const startChop = (ai: AiBehaviorContext, tree: PoolTree): void => {
    chopResult = undefined;
    const mode = currentMode(ai);
    const world = buildChopWorld(ai, config.breakObstacles);
    const plan = planChop(tree, mode, world);
    chopRun = chopOneTree(ai.botName, plan, mode)
      .then((o) => {
        chopResult = o;
      })
      .catch(() => {
        chopResult = { kind: "failed", reason: "error" };
      });
  };

  /** 复位（切换/卸载/下线）——释放认领 + 中断协程 */
  const reset = (): void => {
    if (lastShared && currentId) {
      let pool = lastShared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
      pool = releaseTree(pool, currentId);
      lastShared.set(TREE_POOL_KEY, pool, POOL_TTL_TICKS, "renewing");
    }
    phase = "init";
    wait = 2;
    notifyCooldown = 0;
    scanCooldown = 0;
    currentId = undefined;
    currentTree = undefined;
    chopRun = chopResult = undefined;
    lastShared = undefined;
    lastBot = undefined;
  };

  /** find：取池 → 不足则扫描合并共享 → 选树认领 → 生成计划并发起砍树 */
  const doFind = (ai: AiBehaviorContext): void => {
    const botName = ai.botName;
    const bot = ai.bot;
    if (!bot) {
      phase = "wait";
      wait = 2;
      return;
    }
    let pool = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
    const botLocation = bot.location;
    const pickOptions: TreePickOptions = {
      center: botLocation,
      maxDistance: config.maxDistance,
    };
    // 可认领树资源不足 → 主动扫描发现新树并合并共享
    if (countClaimable(pool, botName, pickOptions) < config.minPoolTrees && scanCooldown <= 0) {
      scanCooldown = config.scanCooldownCycles;
      // 异步扫描：启动后由引擎下一周期继续（扫描完成后合并写池，直接选树）
      scanTreesFromSets(botLocation, bot.dimension, config.scanRadius)
        .then((result) => {
          if (result.trees.length > 0) {
            const fresh = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
            const merged = mergeScannedTrees(fresh, result.trees);
            ai.shared.set(TREE_POOL_KEY, merged, POOL_TTL_TICKS, "renewing", ai.tick);
          }
        })
        .catch(() => {
          /* 扫描失败下次重试 */
        });
    } else if (scanCooldown > 0) {
      scanCooldown--;
    }
    const pick = pickBestTree(pool, botName, botLocation, pickOptions);
    if (!pick) {
      notify(botName, "附近没有可砍的树，稍后再找");
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    // 独占认领（共享——其他假人不再抢它）
    currentId = pick.id;
    currentTree = pick;
    pool = claimTree(pool, currentId, botName);
    writePool(ai, pool);
    const label = currentMode(ai) === "collect" ? "收集模式" : "原木模式";
    notify(botName, `认领大树（${label}，${Math.floor(pick.base.y)} 层）`);
    startChop(ai, pick);
    phase = "chop";
  };

  /** chop：轮询 chopOneTree 完成 → finish */
  const doChop = (ai: AiBehaviorContext): void => {
    if (chopResult === undefined) return; // 砍树进行中
    const outcome = chopResult;
    chopRun = chopResult = undefined;
    if (outcome.kind === "done") {
      notify(ai.botName, `砍伐完成（破 ${outcome.broken} 块，拾取 ${outcome.picked} 件）`);
    } else {
      notify(ai.botName, "本次砍树中断（可重试）");
    }
    phase = "finish";
  };

  /** finish：处理完移除树资源 → 回 find */
  const doFinish = (ai: AiBehaviorContext): void => {
    removeCurrent(ai);
    phase = "find";
  };

  return {
    name: "woodcut",
    priority: 10,
    canActivate: (ctx) => {
      return ctx.memory.get<string>("workMode") === "woodcut";
    },
    onActivate: () => {
      /* 无常驻协程需启动——砍树按目标逐个推进 */
    },
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
        case "chop":
          doChop(ai);
          break;
        case "finish":
          doFinish(ai);
          break;
        case "wait":
          if (--wait > 0) return;
          phase = "find";
          break;
      }
    },
  };
}
