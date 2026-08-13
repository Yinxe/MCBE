// ─── 宝库任务（core/tasks） ──────────────────────────────
// 任务型模块：构建于 core/ai 行为树框架之上的具体任务（端口接口 + 树装配，
// 零 @minecraft，可单测）。分层约定：
//   core/ai     生物 AI 框架（行为树节点，不含任何具体任务）
//   core/tasks  任务型模块（本文件：宝库任务；后续砍树/钓鱼同此目录）
// 决策语义（自动寻路开宝库，对齐 1.3.20 宝库规格）：
//   优先级（根 Selector 每 tick 重评，无记忆）：
//     1. 开箱：有钥匙 + 有目标 + 距离近 + 交互冷却过 → 交互开箱（总量基准回读）
//     2. 寻路：有钥匙 + 有目标 + 距离远 → 导航到宝库旁站立点（协程式，自检查）
//     3. 扫描：有钥匙 + 无目标 → 扫描附近宝库（失败冷却 40 tick）
//     4. 兜底 idle：无钥匙/冷却中 → 等待 + 节流通知
//   黑板键：vaultTarget（目标宝库坐标）/ vaultLastInteractTick（交互节流）。
//   "一直开同一个宝库"：交互消耗钥匙成功后发起重连，黑板目标**保留**，
//     重连完成（新实体上线）后树从黑板取同一目标继续寻路/开箱。
//   ⚠️ 持续点击语义（用户规格 1.3.19）：宝库冷却/出掉落动画中点击返回 true
//     但钥匙不消耗（假成功）——每次点击后回读总量，真消耗才判定成功；
//     未消耗 → 冷却后继续点击，**不放弃目标、不判断宝库已开过**
//     （重连后是新实体，同一宝库可重复开直到钥匙用完）。

import { Action, BehaviorTree, Cooldown, Condition, Selector, Sequence, type AiContext } from "../ai";
import type { Vec3 } from "../model/Types";

/**
 * 开箱交互结果：
 *   consumed      钥匙消耗（真开箱）
 *   not-consumed  点击了但未消耗（宝库冷却/动画中，继续点）
 *   error         交互未执行（方块在，可重试）
 *   target-gone   目标失效（宝库被拆/读取失败，清目标重扫）
 */
export type VaultInteractResult = "consumed" | "not-consumed" | "error" | "target-gone";

/** 宝库任务动作端口：core 层只声明，mc 层注入实现 */
export interface VaultPorts {
  /** 假人可用（在线/非死亡）——引擎据此决定是否推进树 */
  isBotAvailable(botName: string): boolean;
  /** 背包有任一宝库钥匙（普通/不详均可，类型匹配在交互时处理） */
  hasKey(botName: string): boolean;
  /** 扫描附近宝库方块，返回最近候选（未找到 undefined） */
  scanVault(botName: string): Vec3 | undefined;
  /** 假人到目标的水平距离 */
  distanceToTarget(botName: string, target: Vec3): number;
  /** 寻路到宝库旁站立点（协程式，内部自检查取消条件）；到达 true / 失败 false */
  navigateToVault(botName: string, target: Vec3): Promise<boolean>;
  /** 开箱交互（识别类型换钥匙 + 右键使用 + 总量基准回读验证） */
  interactVault(botName: string, target: Vec3): VaultInteractResult;
  /** 开箱成功后的安全重连（safeReconnect，黑板目标保留） */
  tryReconnect(botName: string): void;
  /** 兜底：无钥匙/无宝库时的等待 + 节流通知 */
  idle(botName: string): void;
}

export interface VaultTaskOptions {
  /** 扫描失败冷却（tick），默认 40 */
  scanCooldownTicks?: number;
  /** 交互尝试冷却（tick），默认 20 */
  interactCooldownTicks?: number;
  /** 到达判定距离（格），默认 2 */
  arriveDistance?: number;
}

export const DEFAULT_VAULT_OPTIONS: Required<VaultTaskOptions> = {
  scanCooldownTicks: 40,
  interactCooldownTicks: 20,
  arriveDistance: 2,
};

// ─── 黑板键 ──────────────────────────────────────────────

const BB_TARGET = "vaultTarget";
const BB_LAST_INTERACT = "vaultLastInteractTick";

/**
 * 创建宝库任务行为树。
 *
 * @param ports   - 动作端口（mc 层实现）
 * @param options - 任务参数（可选，默认见 DEFAULT_VAULT_OPTIONS）
 * @returns 行为树实例（每假人一棵，黑板独立）
 */
export function createVaultTaskTree(ports: VaultPorts, options: VaultTaskOptions = {}): BehaviorTree {
  const opt: Required<VaultTaskOptions> = { ...DEFAULT_VAULT_OPTIONS, ...options };

  // ── 条件节点 ─────────────────────────────────────────

  const hasKey = new Condition((ctx) => ports.hasKey(ctx.botName));

  const hasTarget = new Condition((ctx) => ctx.blackboard.has(BB_TARGET));

  const noTarget = new Condition((ctx) => !ctx.blackboard.has(BB_TARGET));

  const isClose = new Condition((ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    return !!target && ports.distanceToTarget(ctx.botName, target) <= opt.arriveDistance;
  });

  const interactCooldownPassed = new Condition((ctx) => {
    const last = ctx.blackboard.get<number>(BB_LAST_INTERACT) ?? Number.NEGATIVE_INFINITY;
    return ctx.tick - last >= opt.interactCooldownTicks;
  });

  // ── 动作节点 ─────────────────────────────────────────

  /** 扫描附近宝库：找到 → 写黑板目标；未找到 → failure（触发冷却） */
  const scan = new Action((ctx) => {
    const found = ports.scanVault(ctx.botName);
    if (!found) return "failure";
    ctx.blackboard.set(BB_TARGET, found);
    return "success";
  });

  /** 寻路到宝库旁：成功 → success；失败（无路径/停滞/取消）→ 清目标换下一个 */
  const navigate = new Action(async (ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    if (!target) return "failure";
    const ok = await ports.navigateToVault(ctx.botName, target);
    if (ok) return "success";
    ctx.blackboard.delete(BB_TARGET);
    return "failure";
  });

  /** 开箱：消耗 → 重连（黑板保留）；未消耗/异常 → 冷却后继续点击（不放弃目标）；
   *  目标失效（宝库被拆）→ 清目标重扫 */
  const interact = new Action((ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    if (!target) return "failure";
    ctx.blackboard.set(BB_LAST_INTERACT, ctx.tick);
    const result = ports.interactVault(ctx.botName, target);
    if (result === "consumed") {
      ports.tryReconnect(ctx.botName);
      return "success";
    }
    if (result === "target-gone") {
      ctx.blackboard.delete(BB_TARGET);
      return "failure";
    }
    return "failure";
  });

  /** 兜底：无钥匙/无宝库 → 等待（通知节流在端口内做） */
  const idle = new Action((ctx) => {
    ports.idle(ctx.botName);
    return "success";
  });

  // ── 树装配（优先级从高到低） ─────────────────────────

  const root = new Selector([
    // 1. 开箱（近 + 有目标 + 有钥匙 + 交互冷却过）
    new Sequence([hasKey, hasTarget, isClose, interactCooldownPassed, interact]),
    // 2. 寻路（有目标但远）
    new Sequence([hasKey, hasTarget, navigate]),
    // 3. 扫描（无目标；失败冷却 scanCooldownTicks）
    new Cooldown(new Sequence([hasKey, noTarget, scan]), opt.scanCooldownTicks),
    // 4. 兜底
    idle,
  ]);

  return new BehaviorTree(root);
}

/** 黑板快捷读：当前任务状态摘要（日志/调试用） */
export function getVaultTaskState(ctx: AiContext): { target: Vec3 | undefined } {
  return {
    target: ctx.blackboard.get<Vec3>(BB_TARGET),
  };
}
