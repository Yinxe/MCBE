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
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { scanTreesFromSets, rescanTree7x7 } from "../../flow/treeScan";
import { chopOneTree, type WoodcutOutcome } from "../../flow/woodcutFlow";
import { planChop, refreshTreeResource } from "../../../rules/woodcut/ChopPlan";
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
  /** 无树等待周期 */
  recheckCycles: number;
  /** 通知节流（引擎周期 = 10 tick；附近 16 格玩家） */
  notifyCooldownCycles: number;
  /** 砍树模式（原木模式 / 收集模式） */
  mode: ChopMode;
}

/** 默认配置 */
export const DEFAULT_WOODCUT_CONFIG: WoodcutBehaviorConfig = {
  scanRadius: 16,
  maxDistance: TREE_POOL_MAX_DISTANCE,
  minPoolTrees: POOL_MIN_TREES,
  recheckCycles: 5, // 50 tick = 2.5 秒
  notifyCooldownCycles: 10, // 100 tick = 5 秒
  mode: "logs",
};

/**
 * 状态机阶段。
 * exhausted = **扫描耗尽终态**：会话内已主动扫描一次且没扫到可砍的新树 →
 * 报告"任务完成"并停下，**不再原地空扫描**（树扫描很贵 ~50ms≈1 游戏刻）。
 * 重新激活（切换 workMode / 下线重连 → reset）会清标志，允许再次扫描。
 */
type Phase = "init" | "find" | "chop" | "finish" | "wait" | "exhausted";

/**
 * 创建自动砍树行为（record.workMode === "woodcut" 时由引擎注册）。
 * ⚠️ 依赖 ctx.shared（跨假人共享记忆池）——生物 AI 引擎每周期注入同一实例。
 */
export function makeWoodcutBehavior(config: WoodcutBehaviorConfig = DEFAULT_WOODCUT_CONFIG): Behavior {
  let phase: Phase = "init";
  let wait = 2; // 初始停顿
  let notifyCooldown = 0;

  /** 本会话树扫描节流（⚠️ 树扫描昂贵 ~50ms≈1 游戏刻）：
   *  - scanPending   一次主动扫描在途（防并发/重复扫描）
   *  - noTreeFound   已扫过一次且没扫到可砍的新树 → 耗尽，进入终端态不再扫
   *  - exhaustedNotified 耗尽通知只发一次 */
  let scanPending = false;
  let noTreeFound = false;
  let exhaustedNotified = false;

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

  /**
   * 发起砍树协程（chopOneTree：逐目标破块 + 独立拾取 flow）。
   * 砍伐前先以**树中心 7×7×7**重扫一次，用真实圆木/树叶更新树资源清单
   * （refreshTreeResource + 写回共享池），再生成计划——清单不失真。
   */
  const startChop = (ai: AiBehaviorContext, tree: PoolTree): void => {
    chopResult = undefined;
    chopRun = (async () => {
      const mode = currentMode(ai);
      const bot = resolveBotPlayer(ai.botName);
      if (!bot) return { kind: "failed", reason: "offline" } as WoodcutOutcome;
      // ① 7×7×7 重扫（树中心底部坐标）→ 更新圆木/树叶资源
      let effectiveTree: PoolTree = tree;
      try {
        const rescan = rescanTree7x7(bot.dimension, tree.base);
        const refreshed = refreshTreeResource(tree, rescan.logs, rescan.leafs);
        effectiveTree = { ...tree, ...refreshed };
        // 写回共享池（后续认领者/他人看到的是更新后的清单）
        const fresh = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
        ai.shared.set(
          TREE_POOL_KEY,
          fresh.map((t) => (t.id === effectiveTree.id ? effectiveTree : t)),
          POOL_TTL_TICKS,
          "renewing",
          ai.tick,
        );
        console.warn(`[MockPlayer] woodcut ${ai.botName} 7×7×7 重扫 ${tree.id}：圆木 ${rescan.logs.length} / 树叶 ${rescan.leafs.length}`);
      } catch (e: any) {
        // 重扫失败 → 用认领时的清单兜底（不中断砍树）
        console.warn(`[MockPlayer] woodcut ${ai.botName} 7×7×7 重扫失败，用认领清单: ${e?.message ?? e}`);
      }
      // ② 生成计划并执行砍伐
      const plan = planChop(effectiveTree, mode);
      return await chopOneTree(ai.botName, plan, mode);
    })()
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
    // ⚠️ 复位（切换 workMode/下线重连）→ 清扫描耗尽标记，重新激活允许再次扫描
    scanPending = false;
    noTreeFound = false;
    exhaustedNotified = false;
    phase = "init";
    wait = 2;
    notifyCooldown = 0;
    currentId = undefined;
    currentTree = undefined;
    chopRun = chopResult = undefined;
    lastShared = undefined;
    lastBot = undefined;
  };

  /**
   * find：取池 → 不足则**主动扫描一次**发现新树并合并共享 → 选树认领。
   *
   * ⚠️ 扫描时机/节流（用户规格 2026-08-18）：树坐标集扫描很贵（~50ms，几乎
   * 占满 1 个游戏刻）。因此**一个会话内只主动扫描一次**：
   *   - 只有当共享池里可认领树不足（< minPoolTrees）且本会话还没扫过时扫描；
   *   - 这次扫描若没带来任何**新树**（没扫到树 / 扫到的都已在池里）→ 立即
   *     标记 noTreeFound，进入 exhausted 终态：报告"任务完成"并停下，
   *     **不再原地空扫描浪费计算资源**；
   *   - 重新激活（切换 workMode / 下线重连 → reset）才允许再次扫描。
   */
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

    // ── ① 本会话已扫描耗尽：报告一次并完成（终端态，不再扫描） ──
    if (noTreeFound) {
      if (!exhaustedNotified) {
        exhaustedNotified = true;
        notify(botName, "附近 16 格内没有可砍的树，自动砍树任务完成");
        console.warn(`[MockPlayer] woodcut ${botName} 扫描耗尽：任务完成，停止扫描（树扫描 ~50ms 昂贵，避免空扫耗刻）`);
      }
      phase = "exhausted";
      return;
    }

    // ── ② 可认领树不足 + 本会话还没扫 → 主动扫描一次并合并新树共享 ──
    const claimable = countClaimable(pool, botName, pickOptions);
    if (claimable < config.minPoolTrees && !scanPending) {
      scanPending = true; // 并发/重复扫描守卫（一次会话只扫一次）
      scanTreesFromSets(botLocation, bot.dimension, config.scanRadius)
        .then((result) => {
          scanPending = false;
          const fresh = ai.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
          const before = new Set(fresh.map((t) => t.id));
          const newTrees = result.trees.filter((t) => !before.has(t.id));
          if (newTrees.length > 0) {
            // 扫到新树 → 合并进共享池，下一周期就能认领
            const merged = mergeScannedTrees(fresh, newTrees);
            ai.shared.set(TREE_POOL_KEY, merged, POOL_TTL_TICKS, "renewing", ai.tick);
            console.warn(`[MockPlayer] woodcut ${botName} 扫描发现 ${newTrees.length} 棵新树并入共享池`);
          } else {
            // 没扫到可砍的新树（无树 / 都是他人已认领且在池内）→ 耗尽 → 报告完成
            noTreeFound = true;
          }
        })
        .catch(() => {
          // 扫描异常：不立即判耗尽，下周期允许重试一次（异常 ≠ 无树）
          scanPending = false;
        });
    }

    // ── ③ 用当前池认领（扫描在途时最多等 2 周期；等结果下一周期合并再认领） ──
    const pick = pickBestTree(pool, botName, botLocation, pickOptions);
    if (!pick) {
      if (scanPending) {
        phase = "wait";
        wait = 2; // 扫描在途：短时间内不再扫，等合并结果
        return;
      }
      // 池里确实没有可认领（且本会话扫描尚未触发/已触发但要等 cooldown 之外）
      // ——不空转：短暂等待后回 find（首次仍会触发那一次扫描，扫完后自动终结）
      phase = "wait";
      wait = config.recheckCycles;
      return;
    }
    // 独占认领（共享——其他假人不再抢它）；认领成功即重置耗尽标记
    noTreeFound = false;
    exhaustedNotified = false;
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
      const fallbackNote = outcome.fellBack ? "（收集模式无合适树叶工具，已回退为圆木模式）" : "";
      notify(ai.botName, `砍伐完成（破 ${outcome.broken} 块，拾取 ${outcome.picked} 件）${fallbackNote}`);
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
        case "exhausted":
          // ⚠️ 终端态：扫描耗尽已报告"任务完成"，保持静止零扫描（省计算刻）
          return;
      }
    },
  };
}
