// ─── 钓鱼任务（core/tasks） ─────────────────────────────
// 任务型模块：构建于 core/ai 行为树框架之上（零 @minecraft，可单测）。
// AI 层只管：感知选点（占用过滤）→ 寻路就位 → 三检查 → 循环 fishOnce →
// 结果处理（换点/继续/缺因）。抛竿/稳定/监听/收竿/异常判定由 fishOnce 闭包
// 封装（mc/features/fishingFlow），本树不重复实现。
//
// 决策语义（根 Selector 每 tick 重评，无记忆，优先级从高到低）：
//   1. 钓鱼中（鱼钩在）→ skip 直接跳过本次（**不重复触发钓鱼能力/不堆积**）
//   2. 当前位置就是钓鱼点 → useHere 直接用（**零扫描**，不重新选点）
//   3. canFish 组合状态检查（可用+不在钓+有目标+就位）→ validateSpot 实时
//      占用验证（**任何实体**占用半径 1 → 清点换候选）→ ensureReady 三检查
//      （坐标中心/身体朝向/视线）→ doFishing（fishOnce 阻塞协程）
//   4. 有目标未就位 → navigate 寻路（宝库模式；失败清点换候选）
//   5. 无点 → ensureSpots（**候选未耗尽不重扫**）+ pickSpot（逐个实时
//      isSpotUsable 跳过被占/失效点）——Cooldown 40 tick 防抖（高精度扫描
//      能避免就避免）
//   6. 兜底 idle（缺因诊断：no-rod > no-water > no-spot > waiting；mc 层
//      200 tick 节流通知）
//
// 关键节点全日志（[MockPlayer] 前缀英文调试日志，游戏内排障报告用）。

import { Action, BehaviorTree, Cooldown, Condition, Selector, Sequence, Status, type AiContext } from "../ai";
import type { FindSpotsFailure, FishingOutcome, FishingSpot } from "./FishingRules";
import type { Vec3 } from "../model/Types";

// ─── 感知快照 ────────────────────────────────────────────

/** 钓鱼感知快照（编排层唯一决策输入） */
export interface FishingKnowledge {
  /** 背包/热键栏有鱼竿 */
  hasRod: boolean;
  /** 候选钓鱼点（星级+距离排序；感知时未做占用过滤——选点时实时判定更准） */
  spots: FishingSpot[];
  /** 扫描失败原因（no-water=没水面 / no-spot=有水面无候选 / error=扫描异常） */
  reason?: FindSpotsFailure;
  /** 假人当前位置 */
  position: Vec3;
}

// ─── 缺因诊断（core 纯函数，可单测） ────────────────────

/** 等待原因（idle 通知用） */
export type FishingIdleReason = "no-rod" | "no-water" | "no-spot" | "waiting";

/**
 * 等待原因诊断：无鱼竿 → no-rod；扫描无水面 → no-water；有水面无候选 →
 * no-spot；其余（候选全失败/冷却中）→ waiting 静默。
 */
export function diagnoseFishingIdle(knowledge: FishingKnowledge): FishingIdleReason {
  if (!knowledge.hasRod) return "no-rod";
  if (knowledge.reason === "no-water") return "no-water";
  if (knowledge.reason === "no-spot") return "no-spot";
  return "waiting";
}

// ─── 动作端口（core 只声明契约，mc 层注入副作用） ────────

export interface FishingPorts {
  /** 假人可用（在线/非死亡）——引擎据此决定是否推进树 */
  isBotAvailable(botName: string): boolean;
  /** 背包/热键栏是否有鱼竿（实时；无鱼竿 → 不寻路不扫描，直接 idle no-rod） */
  hasRod(botName: string): boolean;
  /** 当前位置是否构成钓鱼点（轻量局部判定，零全量扫描） */
  isOnFishingSpot(botName: string): boolean;
  /** 当前位置构造的钓鱼点（含 aim 瞄准点）；非钓鱼点返回 undefined */
  currentSpot(botName: string): FishingSpot | undefined;
  /** 一次感知：扫描钓鱼点（getBlocks 高精度——仅在候选耗尽时调用） */
  sense(botName: string): FishingKnowledge;
  /** 到目标站立格的水平距离 */
  distanceToSpot(botName: string, stand: Vec3): number;
  /** 协程式寻路到站立格中心（宝库同款：isFullPath/停滞/超时/自检）；到达 true / 失败 false */
  navigateToSpot(botName: string, stand: Vec3): Promise<boolean>;
  /** 是否已对齐站立格中心（水平距离 ≤ 0.8） */
  isAligned(botName: string, stand: Vec3): boolean;
  /** 就位三检查（协程）：① 坐标中心微调导航 ② 身体朝向 setBodyRotation ③ 视线 lookAt 瞄准点 */
  ensureAimed(botName: string, spot: FishingSpot): Promise<boolean>;
  /** 钓鱼点当前可被假人使用（点位有效 + 未被任何实体占用，实时） */
  isSpotUsable(botName: string, stand: Vec3): boolean;
  /** 是否正在钓鱼（鱼钩实体存在性——最准，防重复触发） */
  isFishing(botName: string): boolean;
  /** 收掉残留鱼钩（自愈：树 tick 时 fishOnce 未在跑，钩在 = 异常残留；
   *  收掉后下 tick 恢复正常流程；无钩时 no-op） */
  retractHook(botName: string): Promise<void>;
  /** 完成一次钓鱼（闭包协程：抛竿→稳定→监听→收竿→战利品） */
  fishOnce(botName: string): Promise<FishingOutcome>;
  /** 等待通知（缺因中文翻译在 mc 层） */
  idle(botName: string, reason: FishingIdleReason): void;
}

// ─── 任务选项 ────────────────────────────────────────────

export interface FishingTaskOptions {
  /** 感知/选点失败冷却（tick，防高精度扫描抖动） */
  scanCooldownTicks?: number;
  /** 就位判定距离（格，距站立格中心） */
  arriveDistance?: number;
}

export const DEFAULT_FISHING_OPTIONS: Required<FishingTaskOptions> = {
  scanCooldownTicks: 40,
  arriveDistance: 2,
};

// ─── 黑板键 ──────────────────────────────────────────────

/** 当前目标钓鱼点（useHere/pickSpot 写入；失败换点时删除） */
const BB_SPOT = "fishingSpot";
/** 候选钓鱼点列表（sense 写入；pickSpot 逐个取出——候选未耗尽不重扫） */
const BB_SPOTS = "fishingSpots";
/** 最近一次感知快照（idle 缺因诊断用） */
const BB_KNOWLEDGE = "fishingKnowledge";

// ─── 树装配 ──────────────────────────────────────────────

/**
 * 创建钓鱼任务行为树。
 *
 * @param ports - 动作端口（mc 层实现）
 * @param options - 任务选项（冷却/就位距离）
 * @returns 行为树实例（每假人一棵，黑板独立）
 */
export function createFishingTaskTree(ports: FishingPorts, options: FishingTaskOptions = {}): BehaviorTree {
  const opt: Required<FishingTaskOptions> = { ...DEFAULT_FISHING_OPTIONS, ...options };

  // ── 条件节点 ─────────────────────────────────────────

  /** 无鱼竿（实时查询）——跳过寻路/扫描，直接 idle no-rod */
  const noRod = new Condition((ctx) => !ports.hasRod(ctx.botName));

  /** 钓鱼中（鱼钩存在）——优先跳过本次，不重复触发钓鱼能力 */
  const isFishing = new Condition((ctx) => ports.isFishing(ctx.botName));

  /** 当前位置就是钓鱼点（轻量局部判定，零全量扫描） */
  const onFishingHere = new Condition((ctx) => ports.isOnFishingSpot(ctx.botName));

  /** 有目标钓鱼点（黑板） */
  const hasSpot = new Condition((ctx) => ctx.blackboard.has(BB_SPOT));

  /** 已就位（距目标站立格中心 ≤ arriveDistance） */
  const onSpot = new Condition((ctx) => {
    const spot = ctx.blackboard.get<FishingSpot>(BB_SPOT);
    return spot !== undefined && ports.distanceToSpot(ctx.botName, spot.stand) <= opt.arriveDistance;
  });

  /** 无目标钓鱼点（走感知/选点分支） */
  const noSpot = new Condition((ctx) => !ctx.blackboard.has(BB_SPOT));

  // ── 动作节点 ─────────────────────────────────────────

  /** 无鱼竿：不寻路不扫描，直接 idle no-rod（用户规格——缺鱼竿时跳过一切动作） */
  const idleNoRod = new Action((ctx) => {
    console.warn(`[MockPlayer] fishing ${ctx.botName} idle: no-rod`);
    ports.idle(ctx.botName, "no-rod");
    return Status.Success;
  });

  /**
   * 钓鱼中跳过 + **残留自愈**：树 tick 时 fishOnce 协程未在跑（引擎防重入），
   * 此时钩在 = 异常残留（fishOnce 中断/标签重开）——收掉残留钩，下 tick
   * 恢复正常流程（防永久 skip 卡死）。
   */
  const skip = new Action(async (ctx) => {
    console.warn(`[MockPlayer] fishing ${ctx.botName} already fishing, retract residual hook`);
    await ports.retractHook(ctx.botName);
    return Status.Success;
  });

  /** 当前位置作为目标点（零扫描：不感知不选点） */
  const useHere = new Action((ctx) => {
    const spot = ports.currentSpot(ctx.botName);
    if (!spot) return Status.Failure;
    console.warn(`[MockPlayer] fishing ${ctx.botName} use current stand (${spot.stand.x}, ${spot.stand.y}, ${spot.stand.z}) as spot`);
    ctx.blackboard.set(BB_SPOT, spot);
    return Status.Success;
  });

  /**
   * 实时占用/有效性验证：目标点已被**任何实体**占用（半径 1）或已失效
   * （地形变化）→ 清点换候选（Failure → 下 tick 走选点分支）。
   */
  const validateSpot = new Action((ctx) => {
    const spot = ctx.blackboard.get<FishingSpot>(BB_SPOT);
    if (!spot) return Status.Failure;
    if (ports.isSpotUsable(ctx.botName, spot.stand)) return Status.Success;
    console.warn(`[MockPlayer] fishing ${ctx.botName} spot (${spot.stand.x}, ${spot.stand.y}, ${spot.stand.z}) unusable: occupied/invalid → switch`);
    ctx.blackboard.delete(BB_SPOT);
    return Status.Failure;
  });

  /**
   * 就位三检查（用户规格：坐标正中心 / 身体朝向 / 视线，提前判断做出反应）：
   * ① 未对齐站立格中心（>0.8 格）→ 微调导航 ② 身体朝向未对瞄准点（>15°）
   * → setBodyRotation ③ 视线 lookAt 瞄准点（持续注视）。任一失败 → 清点换点。
   */
  const ensureReady = new Action(async (ctx) => {
    const spot = ctx.blackboard.get<FishingSpot>(BB_SPOT);
    if (!spot) return Status.Failure;
    const ok = await ports.ensureAimed(ctx.botName, spot);
    if (ok) return Status.Success;
    console.warn(`[MockPlayer] fishing ${ctx.botName} ensureReady failed → switch spot`);
    ctx.blackboard.delete(BB_SPOT);
    return Status.Failure;
  });

  /**
   * 执行一次钓鱼（fishOnce 阻塞协程，最长 45 秒，期间整树挂起——引擎防重入
   * 保证不重复触发；isFishing 由分支 1 优先拦截，本动作防御性再查）。
   * 结果处理：
   *   caught（含战利品/背包报告）→ Success 原地继续钓
   *   timeout → Success 原地重抛
   *   failed(landed/snagged) → 清点换候选（候选黑板缓存，不重扫）
   *   failed(no-rod/offline) → 清点清候选 → idle 报缺因
   *   failed(hook-lost/error/busy) → Success 重抛（可重试）
   */
  const doFishing = new Action(async (ctx) => {
    if (ports.isFishing(ctx.botName)) {
      console.warn(`[MockPlayer] fishing ${ctx.botName} already fishing, skip`);
      return Status.Running; // 防御：钓鱼中挂起（分支 1 已优先处理）
    }
    const outcome = await ports.fishOnce(ctx.botName);
    if (outcome.kind === "caught") {
      const loot = outcome.loot.map((l) => `${l.typeId}x${l.count}`).join(",") || "none";
      console.warn(`[MockPlayer] fishing ${ctx.botName} fishOnce result: caught (loot=${loot}, backpack=${outcome.backpack.usedSlots}/${outcome.backpack.totalSlots})`);
      return Status.Success; // 原地继续钓
    }
    if (outcome.kind === "timeout") {
      console.warn(`[MockPlayer] fishing ${ctx.botName} fishOnce result: timeout → recast`);
      return Status.Success;
    }
    const reason = outcome.reason;
    console.warn(`[MockPlayer] fishing ${ctx.botName} fishOnce result: failed(${reason})`);
    if (reason === "landed" || reason === "snagged") {
      ctx.blackboard.delete(BB_SPOT); // 换候选（候选列表在黑板，不重扫）
      return Status.Failure;
    }
    if (reason === "no-rod" || reason === "offline") {
      ctx.blackboard.delete(BB_SPOT);
      ctx.blackboard.delete(BB_SPOTS); // 清候选 → 走 sense/idle 报缺因
      return Status.Failure;
    }
    return Status.Success; // hook-lost / error / busy：可重试，原地重抛
  });

  /** 感知（仅候选耗尽时）：扫描钓鱼点 + 缺因记录 */
  const sense = new Action((ctx) => {
    const knowledge = ports.sense(ctx.botName);
    ctx.blackboard.set(BB_KNOWLEDGE, knowledge);
    ctx.blackboard.set(BB_SPOTS, knowledge.spots);
    console.warn(
      `[MockPlayer] fishing ${ctx.botName} sense: hasRod=${knowledge.hasRod} spots=${knowledge.spots.length} reason=${knowledge.reason ?? "ok"}`
    );
    return Status.Success;
  });

  /** 选点：逐个候选实时 isSpotUsable（跳过被占/失效），取第一个可用写黑板 */
  const pickSpot = new Action((ctx) => {
    const spots = ctx.blackboard.get<FishingSpot[]>(BB_SPOTS);
    if (!spots || spots.length === 0) {
      console.warn(`[MockPlayer] fishing ${ctx.botName} pickSpot: no usable spots → rescan`);
      return Status.Failure;
    }
    while (spots.length > 0) {
      const candidate = spots.shift()!;
      if (ports.isSpotUsable(ctx.botName, candidate.stand)) {
        ctx.blackboard.set(BB_SPOT, candidate);
        console.warn(`[MockPlayer] fishing ${ctx.botName} pick spot (${candidate.stand.x}, ${candidate.stand.y}, ${candidate.stand.z}) star=${candidate.aim.level}`);
        return Status.Success;
      }
      console.warn(`[MockPlayer] fishing ${ctx.botName} skip occupied spot (${candidate.stand.x}, ${candidate.stand.y}, ${candidate.stand.z})`);
    }
    console.warn(`[MockPlayer] fishing ${ctx.botName} pickSpot: no usable spots → rescan`);
    return Status.Failure;
  });

  /** 候选列表有剩余可用候选才不重扫（空列表 = 已耗尽，触发重扫） */
  const ensureSpots = new Action((ctx) => {
    const spots = ctx.blackboard.get<FishingSpot[]>(BB_SPOTS);
    if (spots && spots.length > 0) return Status.Success; // 候选未耗尽，不重扫
    return sense.tick(ctx);
  });

  /** 寻路到目标站立格中心；失败（无路径/停滞/超时）→ 清点换候选 */
  const navigate = new Action(async (ctx) => {
    const spot = ctx.blackboard.get<FishingSpot>(BB_SPOT);
    if (!spot) return Status.Failure;
    const ok = await ports.navigateToSpot(ctx.botName, spot.stand);
    if (ok) {
      console.warn(`[MockPlayer] fishing ${ctx.botName} navigate (${spot.stand.x}, ${spot.stand.y}, ${spot.stand.z}): ok`);
      return Status.Success;
    }
    console.warn(`[MockPlayer] fishing ${ctx.botName} navigate (${spot.stand.x}, ${spot.stand.y}, ${spot.stand.z}): fail → switch spot`);
    ctx.blackboard.delete(BB_SPOT);
    return Status.Failure;
  });

  /** 兜底缺因通知（诊断在 core，翻译在端口） */
  const idle = new Action((ctx: AiContext) => {
    const knowledge = ctx.blackboard.get<FishingKnowledge>(BB_KNOWLEDGE);
    const reason = diagnoseFishingIdle(knowledge ?? { hasRod: false, spots: [], position: { x: 0, y: 0, z: 0 } });
    console.warn(`[MockPlayer] fishing ${ctx.botName} idle: ${reason}`);
    ports.idle(ctx.botName, reason);
    return Status.Success;
  });

  // ── 树装配（优先级从高到低） ─────────────────────────

  const root = new Selector([
    // 0. 无鱼竿 → 不寻路不扫描，直接 idle no-rod（用户规格）
    new Sequence([noRod, idleNoRod]),
    // 1. 钓鱼中 → 跳过（不重复触发/不堆积）
    new Sequence([isFishing, skip]),
    // 2. 无目标 + 当前位置就是钓鱼点 → 直接用（零扫描；有目标后走分支 3 钓鱼）
    new Sequence([noSpot, onFishingHere, useHere]),
    // 3. 组合状态检查 → 实时占用验证 → 三检查 → 钓鱼
    new Sequence([hasSpot, onSpot, validateSpot, ensureReady, doFishing]),
    // 4. 有目标未就位 → 寻路
    new Sequence([hasSpot, navigate]),
    // 5. 无点 → 候选空才重扫 + 实时选可用点（失败冷却防抖）
    new Cooldown(new Sequence([noSpot, ensureSpots, pickSpot]), opt.scanCooldownTicks),
    // 6. 兜底缺因
    idle,
  ]);

  return new BehaviorTree(root);
}
