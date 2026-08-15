// ─── 宝库任务（core/tasks） ──────────────────────────────
// 任务型模块：构建于 core/ai 行为树框架之上的具体任务（感知/决策/端口，
// 零 @minecraft，可单测）。分层约定：
//   core/ai     生物 AI 编排框架（行为树节点，不含任何具体任务）
//   core/tasks  任务型模块（本文件：宝库任务；后续砍树/钓鱼同此目录）
//
// 感知驱动决策（用户规格 1.1.57/1.1.59）：不再是布尔 hasKey，而是完整感知快照
//   VaultKnowledge（背包有哪种钥匙 + 周围有哪种宝库）——编排层据此精确决策：
//   - 目标选择 selectVaultTarget：**优先不详宝库**（有不详钥匙时）；
//     其次普通宝库（⚠️ **普通宝库只能用普通钥匙**，不详钥匙不可替代）
//   - 缺因诊断 diagnoseVaultIdle：开不了宝库时通知精确原因
//     （缺钥匙 / 缺宝库 / 缺不详钥匙 / 缺普通钥匙）
//
// 决策语义（根 Selector 每 tick 重评，无记忆）：
//   优先级：
//     1. 开箱：有目标 + 距离近 + 交互冷却过 → 交互开箱（总量基准回读）
//     2. 寻路：有目标 + 距离远 → 导航到宝库旁站立点（协程式，自检查）
//     3. 感知：无目标 → 感知刷新（背包+宝库分类）→ 选目标（失败冷却 40 tick）
//     4. 兜底 idle：开不了 → 按诊断原因节流通知
//   黑板键：vaultTarget（目标坐标）/ vaultTargetKind（normal|ominous）/
//     vaultTargetKey（选定钥匙 typeId）/ vaultKnowledge（感知缓存）/
//     vaultLastInteractTick（交互节流）。
//   "一直开同一个宝库"：交互消耗钥匙成功后发起重连，黑板目标**保留**，
//     重连完成（新实体上线）后树从黑板取同一目标继续寻路/开箱。
//   ⚠️ 持续点击语义（用户规格 1.3.19）：宝库冷却/出掉落动画中点击返回 true
//     但钥匙不消耗（假成功）——每次点击后回读总量，真消耗才判定成功；
//     未消耗 → 冷却后继续点击，**不放弃目标、不判断宝库已开过**。
//   ⚠️ 目标失效防卡死：宝库被拆/被替换成其他方块 → interactVault 返回
//     "target-gone" → 清目标重扫（绝不重复对空气/错误方块交互）。

import { Action, BehaviorTree, Cooldown, Condition, Selector, Sequence, Status, type AiContext } from "../ai";
import type { Vec3 } from "../model/Types";

// ─── 感知快照（编排层唯一决策输入） ─────────────────────

/** 背包钥匙库存（分类统计） */
export interface KeyInventory {
  /** 普通钥匙（trial_key）数量 */
  trial: number;
  /** 不详钥匙（ominous_trial_key）数量 */
  ominous: number;
}

/** 附近宝库（按距离近 → 远排序；同类型才有可比性） */
export interface NearbyVaults {
  /** 普通宝库列表 */
  normal: Vec3[];
  /** 不详宝库列表 */
  ominous: Vec3[];
}

/** 感知快照：一次 sense() 返回的完整世界状态，编排层据此决策 */
export interface VaultKnowledge {
  keys: KeyInventory;
  vaults: NearbyVaults;
  /** 假人当前坐标（感知时刻；目标选择排序用） */
  position: Vec3;
}

/** 开不了宝库的原因（idle 通知用，core 判定、mc 翻译文案） */
export type VaultIdleReason = "no-key" | "no-vault" | "no-ominous-key" | "no-trial-key";

/** 目标选择结果 */
export interface VaultTargetSelection {
  target: Vec3;
  kind: "normal" | "ominous";
  /** 选定钥匙 typeId（交互时换主手） */
  key: string;
}

/**
 * 开箱交互结果：
 *   consumed      钥匙消耗（真开箱）
 *   not-consumed  点击了但未消耗（宝库冷却/动画中，继续点）
 *   error         交互未执行（方块在，可重试）
 *   target-gone   目标失效（宝库被拆/读取失败，清目标重扫）
 */
export type VaultInteractResult = "consumed" | "not-consumed" | "error" | "target-gone";

/** 宝库任务动作端口：core 层只声明决策契约，mc 层注入世界副作用 */
export interface VaultPorts {
  /** 假人可用（在线/非死亡）——引擎据此决定是否推进树 */
  isBotAvailable(botName: string): boolean;
  /** 一次感知：背包钥匙分类 + 附近宝库分类（mc 层副作用，不抛错） */
  sense(botName: string): VaultKnowledge;
  /** 假人到目标的水平距离（实时查询；感知间隔内目标选择用缓存排序） */
  distanceToTarget(botName: string, target: Vec3): number;
  /** 寻路到宝库旁站立点（协程式，内部自检查取消条件）；到达 true / 失败 false */
  navigateToVault(botName: string, target: Vec3): Promise<boolean>;
  /** 开箱交互：换主手选定钥匙 + 右键使用 + 总量基准回读验证 */
  interactVault(botName: string, target: Vec3, keyType: string): VaultInteractResult;
  /** 开箱成功后的安全重连（safeReconnect，黑板目标保留） */
  tryReconnect(botName: string): void;
  /** 兜底：开不了宝库 → 按诊断原因通知（mc 只翻译文案，原因判定在 core） */
  idle(botName: string, reason: VaultIdleReason): void;
}

export interface VaultTaskOptions {
  /** 感知失败/无目标冷却（tick），默认 40 */
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

// ─── 钥匙 ID 常量 ────────────────────────────────────────

export const TRIAL_KEY = "minecraft:trial_key";
export const OMINOUS_TRIAL_KEY = "minecraft:ominous_trial_key";

// ─── 目标选择与缺因诊断（core 纯函数，可单测） ──────────

/**
 * 目标选择：**优先不详宝库**（有不详钥匙时）；其次普通宝库
 * （⚠️ 普通宝库**只能使用普通钥匙**——用户规格 1.1.59，不详钥匙不能开普通宝库）。
 *
 * @param knowledge - 感知快照
 * @returns 目标选择；无满足条件的目标返回 undefined
 */
export function selectVaultTarget(knowledge: VaultKnowledge): VaultTargetSelection | undefined {
  // ① 不详宝库 + 不详钥匙 → 最近不详宝库（最高优先）
  const ominousVault = knowledge.vaults.ominous[0];
  if (ominousVault && knowledge.keys.ominous > 0) {
    return { target: ominousVault, kind: "ominous", key: OMINOUS_TRIAL_KEY };
  }
  // ② 普通宝库 + 普通钥匙 → 最近普通宝库（普通钥匙专用，不详钥匙不可替代）
  const normalVault = knowledge.vaults.normal[0];
  if (normalVault && knowledge.keys.trial > 0) {
    return { target: normalVault, kind: "normal", key: TRIAL_KEY };
  }
  return undefined;
}

/**
 * 开不了宝库的原因诊断（idle 通知用）：按感知快照精确区分——
 * 缺钥匙 / 缺宝库 / 缺不详钥匙（只有不详宝库）/ 缺普通钥匙（有普通宝库但不祥
 * 钥匙开不了）。注意：两种宝库都有且有不详钥匙时 select ① 成功，不会走到 idle。
 *
 * @param knowledge - 感知快照
 * @returns 原因；选得出目标（理论上不会 idle）返回 undefined
 */
export function diagnoseVaultIdle(knowledge: VaultKnowledge): VaultIdleReason | undefined {
  // ① 背包无任何钥匙
  if (knowledge.keys.trial === 0 && knowledge.keys.ominous === 0) return "no-key";
  // ② 有钥匙但附近无任何宝库
  if (knowledge.vaults.normal.length === 0 && knowledge.vaults.ominous.length === 0) return "no-vault";
  // ③ 只有不详宝库且背包无不详钥匙（普通钥匙开不了不详宝库）
  if (knowledge.vaults.normal.length === 0 && knowledge.vaults.ominous.length > 0 && knowledge.keys.ominous === 0) {
    return "no-ominous-key";
  }
  // ④ 有普通宝库但背包无普通钥匙（仅有不详钥匙；无钥匙已归 ①）
  if (knowledge.vaults.normal.length > 0 && knowledge.keys.trial === 0) {
    return "no-trial-key";
  }
  return undefined;
}

// ─── 黑板键 ──────────────────────────────────────────────

const BB_TARGET = "vaultTarget";
const BB_TARGET_KIND = "vaultTargetKind";
const BB_TARGET_KEY = "vaultTargetKey";
const BB_KNOWLEDGE = "vaultKnowledge";
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

  const hasTarget = new Condition((ctx) => ctx.blackboard.has(BB_TARGET));

  const noTarget = hasTarget.not();

  const isClose = new Condition((ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    return !!target && ports.distanceToTarget(ctx.botName, target) <= opt.arriveDistance;
  });

  const interactCooldownPassed = new Condition((ctx) => {
    const last = ctx.blackboard.get<number>(BB_LAST_INTERACT) ?? Number.NEGATIVE_INFINITY;
    return ctx.tick - last >= opt.interactCooldownTicks;
  });

  // ── 动作节点 ─────────────────────────────────────────

  /** 感知：刷新黑板知识（背包钥匙 + 附近宝库分类；mc 层不抛错） */
  const sense = new Action((ctx) => {
    const knowledge = ports.sense(ctx.botName);
    ctx.blackboard.set(BB_KNOWLEDGE, knowledge);
    return Status.Success;
  });

  /** 选目标：按感知快照决策（优先不详宝库）；无满足目标 → Failure（触发冷却） */
  const selectTarget = new Action((ctx) => {
    const knowledge = ctx.blackboard.get<VaultKnowledge>(BB_KNOWLEDGE);
    if (!knowledge) return Status.Failure;
    const selection = selectVaultTarget(knowledge);
    if (!selection) return Status.Failure;
    ctx.blackboard.set(BB_TARGET, selection.target);
    ctx.blackboard.set(BB_TARGET_KIND, selection.kind);
    ctx.blackboard.set(BB_TARGET_KEY, selection.key);
    return Status.Success;
  });

  /** 寻路到宝库旁：成功 → Success；失败（无路径/停滞/目标消失/取消）→ 清目标重扫 */
  const navigate = new Action(async (ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    if (!target) return Status.Failure;
    const ok = await ports.navigateToVault(ctx.botName, target);
    if (ok) return Status.Success;
    ctx.blackboard.delete(BB_TARGET);
    ctx.blackboard.delete(BB_TARGET_KIND);
    ctx.blackboard.delete(BB_TARGET_KEY);
    return Status.Failure;
  });

  /** 开箱：消耗 → 重连（黑板保留）；未消耗/异常 → 冷却后继续点击（不放弃目标）；
   *  目标失效（宝库被拆）→ 清目标重扫 */
  const interact = new Action((ctx) => {
    const target = ctx.blackboard.get<Vec3>(BB_TARGET);
    const keyType = ctx.blackboard.get<string>(BB_TARGET_KEY);
    if (!target || !keyType) return Status.Failure;
    ctx.blackboard.set(BB_LAST_INTERACT, ctx.tick);
    const result = ports.interactVault(ctx.botName, target, keyType);
    if (result === "consumed") {
      ports.tryReconnect(ctx.botName);
      return Status.Success;
    }
    if (result === "target-gone") {
      ctx.blackboard.delete(BB_TARGET);
      ctx.blackboard.delete(BB_TARGET_KIND);
      ctx.blackboard.delete(BB_TARGET_KEY);
      return Status.Failure;
    }
    return Status.Failure;
  });

  /** 兜底：开不了宝库 → 按诊断原因通知（缺钥匙/缺宝库/缺不详钥匙） */
  const idle = new Action((ctx) => {
    const knowledge = ctx.blackboard.get<VaultKnowledge>(BB_KNOWLEDGE);
    const reason = (knowledge && diagnoseVaultIdle(knowledge)) ?? "no-key";
    ports.idle(ctx.botName, reason);
    return Status.Success;
  });

  // ── 树装配（优先级从高到低） ─────────────────────────

  const root = new Selector([
    // 1. 开箱（近 + 有目标 + 交互冷却过）
    new Sequence([hasTarget, isClose, interactCooldownPassed, interact]),
    // 2. 寻路（有目标但远）
    new Sequence([hasTarget, navigate]),
    // 3. 感知 + 选目标（无目标；失败冷却 scanCooldownTicks）
    new Cooldown(new Sequence([noTarget, sense, selectTarget]), opt.scanCooldownTicks),
    // 4. 兜底（按诊断原因通知）
    idle,
  ]);

  return new BehaviorTree(root);
}

/** 黑板快捷读：当前任务状态摘要（日志/调试用） */
export function getVaultTaskState(ctx: AiContext): { target: Vec3 | undefined; kind: "normal" | "ominous" | undefined; key: string | undefined } {
  return {
    target: ctx.blackboard.get<Vec3>(BB_TARGET),
    kind: ctx.blackboard.get<"normal" | "ominous">(BB_TARGET_KIND),
    key: ctx.blackboard.get<string>(BB_TARGET_KEY),
  };
}
