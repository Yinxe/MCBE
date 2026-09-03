// ─── 自动砍树任务（natural：共享树池 + chopOneTree 阶段机） ──
// workMode="woodcut"。两阶段循环：find（共享池选树/不足则扫描合并/
// 扫描无新树 = 自然完成 TASK_DONE）→ chop（7×7 预重扫修树顶截断 →
// 生成砍伐计划 → chopOneTree 单树砍伐 → 完成后从池移除）。
// 子模式取 record.woodcutMode（logs/collect）；认领树经 ctx.data 传递；
// cleanup 兜底释放认领。跨假人共享池存 runtime/SharedMemory
// "woodcut:pool"（renewing TTL）。

import { system } from "@minecraft/server";

import { botRegistry } from "../../../bootstrap/context";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { scanTreesFromSets, rescanTree7x7 } from "../treeScan";
import { chopOneTree, type WoodcutOutcome } from "../woodcutFlow";
import { planChop, refreshTreeResource } from "../../../rules/woodcut/ChopPlan";
import { normalizeChopMode, type ChopMode } from "../../../rules/woodcut/WoodcutRules";
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
import { defineLoopTask, TASK_DONE, type PhaseContext } from "./spec";

// ─── 配置（tick / 格） ─────────────────────────────────

/** 扫描半径（格） */
const SCAN_RADIUS = 16;
/** 只认领附近 16 格内的树（用户规格） */
const MAX_DISTANCE = TREE_POOL_MAX_DISTANCE;
/** 池内可认领树下限：不足则主动扫描发现新树并共享 */
const MIN_POOL_TREES = POOL_MIN_TREES;
/** 无树重查间隔（tick = 2.5 秒） */
const RECHECK_TICKS = 50;

/** 回写共享池（renewing TTL：活跃即延长） */
function writePool(shared: PhaseContext<WoodcutData>["shared"], pool: PoolTree[]): void {
  shared.set(TREE_POOL_KEY, pool, POOL_TTL_TICKS, "renewing", system.currentTick);
}

/** 砍树任务共享状态 */
interface WoodcutData {
  /** 当前认领的树 id（undefined = 未认领） */
  treeId?: string;
  /** 当前认领的树资源 */
  tree?: PoolTree;
  /** 扫描会话终态：扫过且无新树 → 附近已无树（任务自然完成） */
  noTreeFound: boolean;
}

/** 释放当前认领（树还在，回池供他人认领；幂等） */
function releaseClaim(ctx: PhaseContext<WoodcutData>): void {
  if (!ctx.data.treeId) return;
  writePool(ctx.shared, releaseTree(ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [], ctx.data.treeId));
  ctx.data.treeId = undefined;
  ctx.data.tree = undefined;
}

// ─── 任务定义 ──────────────────────────────────────────

/** 自动砍树（自然流程循环）任务 */
export const woodcutTask = defineLoopTask<WoodcutData>({
  workMode: "woodcut",
  kind: "natural",
  label: "自动砍树",
  createData: () => ({ noTreeFound: false }),
  initial: "find",
  cleanup: (ctx) => {
    // 兜底：任务结束（取消/完成/失败）释放认领（chop 完成已移除则空操作）
    if (ctx.data.treeId) {
      ctx.shared.set(
        TREE_POOL_KEY,
        releaseTree(ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [], ctx.data.treeId),
        POOL_TTL_TICKS,
        "renewing",
        system.currentTick,
      );
    }
  },
  phases: {
    find: {
      label: "找树",
      run: async (ctx) => {
        const bot = resolveBotPlayer(ctx.botName);
        if (!bot) {
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        // ── 自然完成：上次扫描已确认附近无新树（扫描有开销，每会话只扫一次） ──
        if (ctx.data.noTreeFound) {
          ctx.notify("任务完成：附近已无树可砍");
          return TASK_DONE;
        }
        // ── 选树 ──
        const record = botRegistry.get(ctx.botName);
        const mode: ChopMode = normalizeChopMode(record?.woodcutMode, "logs");
        const pickOptions: TreePickOptions = { center: bot.location, maxDistance: MAX_DISTANCE };
        const pool = ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
        // 池内可认领不足 → 主动扫描（await；扫描有开销 ~50ms，结果合并共享）
        if (countClaimable(pool, ctx.botName, pickOptions) < MIN_POOL_TREES) {
          try {
            const scan = await scanTreesFromSets(bot.location, bot.dimension, SCAN_RADIUS);
            const fresh = ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
            const known = new Set(fresh.map((t) => t.id));
            const newTrees = scan.trees.filter((t) => !known.has(t.id));
            if (newTrees.length > 0) {
              writePool(ctx.shared, mergeScannedTrees(fresh, newTrees));
            } else {
              ctx.data.noTreeFound = true; // 扫描成功但无新树 → 终态
            }
          } catch {
            /* 扫描异常不计终态（下轮重试；骨架退避兜底意外异常） */
          }
        }
        const pick = pickBestTree(ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [], ctx.botName, bot.location, pickOptions);
        if (!pick) {
          await ctx.wait(RECHECK_TICKS);
          return "find";
        }
        ctx.data.treeId = pick.id;
        ctx.data.tree = pick;
        writePool(ctx.shared, claimTree(ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [], pick.id, ctx.botName));
        ctx.notify(`认领大树（${mode === "logs" ? "原木" : "收集"}模式）`);
        return "chop";
      },
    },
    chop: {
      label: "砍伐",
      run: async (ctx) => {
        const tree = ctx.data.tree;
        if (!tree) return "find";
        const record = botRegistry.get(ctx.botName);
        const mode: ChopMode = normalizeChopMode(record?.woodcutMode, "logs");
        const outcome = await chopClaimedTree(ctx, tree, mode);
        ctx.notify(
          outcome.kind === "done"
            ? `砍伐完成（破 ${outcome.broken} 块，拾取 ${outcome.picked} 件${outcome.fellBack ? "，收集模式缺工具已回退原木" : ""}）`
            : "本次砍树中断（可重试）",
        );
        // 完成/放弃都从池移除（树资源不再复用；取消场景由 cleanup 释放）
        if (ctx.data.treeId) {
          writePool(ctx.shared, removeTree(ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [], ctx.data.treeId));
          ctx.data.treeId = undefined;
          ctx.data.tree = undefined;
        }
        return "find";
      },
    },
  },
});

/**
 * 砍伐已认领的树：7×7 预重扫（修树顶截断）→ 生成砍伐计划 → chopOneTree。
 * 重扫失败回退认领时的清单。
 */
async function chopClaimedTree(ctx: PhaseContext<WoodcutData>, tree: PoolTree, mode: ChopMode): Promise<WoodcutOutcome> {
  const bot = resolveBotPlayer(ctx.botName);
  if (!bot) return { kind: "failed", reason: "offline" };

  // ① 预重扫 7×7×7（修复认领清单树顶截断）+ 回写共享池
  let effectiveTree = tree;
  try {
    const rescan = rescanTree7x7(bot.dimension, tree.base, tree.top.y);
    effectiveTree = { ...tree, ...refreshTreeResource(tree, rescan.logs, rescan.leafs) };
    const fresh = ctx.shared.get<PoolTree[]>(TREE_POOL_KEY) ?? [];
    writePool(
      ctx.shared,
      fresh.map((t) => (t.id === effectiveTree.id ? effectiveTree : t)),
    );
  } catch {
    /* 重扫失败 → 回退认领清单 */
  }

  // ② 计划 + 单树砍伐（flow 层：导航靠近 → 分层破坏 → 拾取）
  const plan = planChop(effectiveTree, mode);
  return await chopOneTree(ctx.botName, plan, mode);
}
