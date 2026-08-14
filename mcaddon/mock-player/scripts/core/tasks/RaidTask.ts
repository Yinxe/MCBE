// ─── 劫掠任务（core/tasks） ──────────────────────────────
// 任务型模块：构建于 core/ai 行为树框架之上（零 @minecraft，可单测）。
// **事件驱动黑板 + 树决策**：效果事件（effectAdd）在 mc 层更新状态，
//   树每 10 tick 经 sense() 读取——分钟级袭击等待零轮询负担。
//
// 决策语义（根 Selector 每 tick 重评，无记忆）：
//   优先级：
//     1. 胜利处理：假人带村庄英雄效果 → 计胜 + 叠加给主人 + 移除英雄（清周期标记）
//     2. 喝瓶：**只在启动时与胜利后**——无兆头 + 无英雄 + 有药水 + 黑板无
//        raidWaiting 标记（本周期已喝过 → 等袭击/胜利，兆头消失也不重复喝）
//     3. 等待：袭击中/周期等待静默；无药水通知（diagnoseRaidIdle）
//   黑板键：raidWaiting（本周期已喝过，胜利处理时清除 → 允许下一瓶）。
//   ⚠️ 语义约束（用户拍板 713e8da + 1.1.60 补充）：**纯事件驱动 + 一次性卡死
//     提醒**——袭击等待靠事件唤醒（效果实时查询，树条件全 false 时等待分支
//     无副作用），卡死提醒由 mc 事件层一次性 schedule（只发消息），
//     **不引入任何巡检/恢复机制**。
//   ⚠️ 无药水自动关模式（原 raidMode 语义）：drinkBottle 返回 "no-bottle" 时
//     端口内移除劫掠标签（自动停用），树随后被引擎对账清理。

import { Action, BehaviorTree, Condition, Selector, Sequence, Status, type AiContext } from "../ai";
import { EventSignal } from "../events/EventSignal";
import { RAID_WAVE_COOLDOWN_TICKS } from "./RaidRules";

// ─── 劫掠领域事件（内聚在劫掠任务，用户规格） ────────────
// 事件负载只用可序列化 string/number，保持 core 纯净。

/** 劫掠开始事件：假人获得袭击之兆（不祥之兆在村庄/试炼之地内转化）——劫掠即将开始。
 *  ⚠️ 不祥之兆本身不算劫掠开始（可能 100 分钟挂着或转化为试炼之兆），以转化为准 */
export interface RaidStartedEvent {
  /** 假人名 */
  botName: string;
  /** 袭击之兆等级 */
  amplifier: number;
}

/** 劫掠胜利事件：假人获得村庄英雄（袭击结束） */
export interface RaidVictoryEvent {
  /** 假人名 */
  botName: string;
  /** 村庄英雄等级 */
  amplifier: number;
}

/** 袭击阶段（估算日志用；核心流程以事件为准，阶段仅供参考） */
export type RaidPhase =
  | "idle" // 未开始
  | "pre-trigger" // 预触发：获得袭击之兆，30 秒后袭击完全开始
  | "started" // 开始：袭击之兆结束，袭击完全开始（瞬时，随后进入第一波冷却）
  | "wave" // 波次中：检测到袭击者
  | "cooling" // 读条冷却：本波清完 15 秒后下一波；**第一波前也有冷却**（用户实测）
  | "victory" // 胜利：获得村庄英雄
  | "truce"; // 停战：40 分钟未结束，平局

/** 袭击阶段变化事件（估算日志/外部联动用；不参与核心流程决策） */
export interface RaidPhaseEvent {
  botName: string;
  phase: RaidPhase;
  /** 阶段变化描述（中文，日志/通知用） */
  detail: string;
}

/** 劫掠开始信号 */
export const raidStarted = new EventSignal<RaidStartedEvent>();

/** 劫掠胜利信号 */
export const raidVictory = new EventSignal<RaidVictoryEvent>();

/** 袭击阶段变化信号（估算，仅供日志/联动，不影响核心流程） */
export const raidPhase = new EventSignal<RaidPhaseEvent>();

// ─── 袭击阶段估算（纯函数，可单测） ──────────────────────
// ⚠️ 估算机制（基于 wiki 波次规则）只能判断劫掠生物是否存在/增减，
//    实际劫掠进度以实际流程（预触发/开始/胜利事件）为准；
//    估算不准确也**不干预主事件流程**——仅日志/事件输出。

/** 阶段估算状态（每假人一份） */
export interface RaidPhaseState {
  phase: RaidPhase;
  /** 当前波次（估算，从 1 递增） */
  wave: number;
  /** 上次扫描到的袭击者数量 */
  lastRaiderCount: number;
  /** 本波清完的 tick（冷却开始时刻；击杀时间不定，冷却判定以生物为准） */
  lastClearedTick: number;
  /** 冷却超时提示已发（防重复打印） */
  coolingHinted: boolean;
}

/** 创建初始阶段状态 */
export function initialRaidPhaseState(): RaidPhaseState {
  return { phase: "idle", wave: 0, lastRaiderCount: 0, lastClearedTick: -Infinity, coolingHinted: false };
}

/**
 * 阶段估算（纯函数）：输入扫描到的袭击者数量与当前状态，输出新状态与阶段变化描述。
 * ⚠️ 每波击杀时间完全不确定——阶段判定**以生物增减为主**，不依赖时间推断波次：
 *   - 0→N（无→有）：新一波生成（wave 递增，phase=wave）——含第一波（开始后
 *     进入冷却，随后 0→N 触发"波次 1 生成"）
 *   - N→0（有→无）：本波清完（phase=cooling，记录清完时刻）
 *   - 0→0 冷却中：等待下一波/胜利判定；冷却超时（45 秒）仍无新波次与胜利 →
 *     提示"可能袭击失败（村民死光/床毁）或已停战"（一次性，防刷屏）
 *   - N→N（数量不变/波内变化）：保持 wave 阶段，无阶段变化
 * @returns change = 阶段变化描述（无变化返回 undefined）
 */
export function estimateRaidPhase(
  prev: RaidPhaseState,
  raiderCount: number,
  tick: number,
): { state: RaidPhaseState; change: string | undefined } {
  const state: RaidPhaseState = { ...prev, lastRaiderCount: raiderCount };

  if (prev.phase !== "started" && prev.phase !== "wave" && prev.phase !== "cooling") {
    return { state, change: undefined }; // 事件驱动阶段（idle/pre-trigger/victory/truce）不扫描估算
  }

  if (raiderCount > 0 && prev.lastRaiderCount === 0) {
    // 无→有：新一波生成（冷却期后出现新生物且未胜利 = 下一波已刷出）
    state.wave = prev.wave + 1;
    state.phase = "wave";
    state.coolingHinted = false;
    return { state, change: `波次 ${state.wave} 生成（检测到 ${raiderCount} 名袭击者）` };
  }
  if (raiderCount === 0 && prev.lastRaiderCount > 0) {
    // 有→无：本波清完，进入冷却（下一波 15 秒后；最后一波则等胜利判定）
    state.phase = "cooling";
    state.lastClearedTick = tick;
    state.coolingHinted = false;
    return { state, change: `波次 ${prev.wave} 清完，波间冷却 15 秒` };
  }
  if (raiderCount === 0 && !state.coolingHinted && tick - state.lastClearedTick > RAID_WAVE_COOLDOWN_TICKS * 3) {
    // 冷却超时（45 秒）仍无新波次与胜利 → 可能失败（村民死光/床毁）或停战（一次性提示）
    state.coolingHinted = true;
    return { state, change: "冷却超时：无新波次与胜利判定——可能袭击失败（村民死光/床毁）或已停战" };
  }
  if (raiderCount > 0) {
    state.phase = "wave"; // 波内数量变化，保持 wave
  }
  return { state, change: undefined };
}

// ─── 感知快照 ────────────────────────────────────────────

/** 劫掠感知快照（事件驱动 + 实时查询，编排层唯一决策输入） */
export interface RaidKnowledge {
  effects: {
    /** 不祥之兆（喝瓶后获得；进入村庄后转为袭击之兆）——袭击酝酿中 */
    badOmen: boolean;
    /** 袭击之兆（村庄转化，30 秒后触发袭击）——袭击进行中 */
    raidOmen: boolean;
    /** 村庄英雄（袭击胜利获得）——胜利待处理 */
    villageHero: boolean;
  };
  /** 背包不祥之瓶数量 */
  bottles: number;
  /** 最近村庄英雄事件 tick（effectAdd 时刻；"胜利已处理"幂等判定用） */
  lastHeroEventTick: number;
}

/** 等待原因（idle 通知用；"waiting"= 袭击中/周期等待，静默等待） */
export type RaidIdleReason = "no-bottle" | "waiting";

/** 喝瓶结果 */
export type RaidDrinkResult = "drunk" | "no-bottle" | "error";

/** 劫掠任务动作端口：core 层只声明决策契约，mc 层注入世界副作用 */
export interface RaidPorts {
  /** 假人可用（在线/非死亡）——引擎据此决定是否推进树 */
  isBotAvailable(botName: string): boolean;
  /** 一次感知：效果状态（实时查询实体）+ 药水数 + 最近英雄事件时刻 */
  sense(botName: string): RaidKnowledge;
  /** 喝瓶协程链（互斥 + 换瓶 + 按住饮用）；无瓶 → "no-bottle"（端口内自动关模式） */
  drinkBottle(botName: string): Promise<RaidDrinkResult>;
  /** 胜利处理：计胜 + 村庄英雄叠加给主人 + 移除英雄（幂等：事件时刻防重） */
  handleVictory(botName: string): void;
  /** 等待：no-bottle → 通知（节流）；waiting → 静默 */
  idle(botName: string, reason: RaidIdleReason): void;
}

/** 胜利处理判定窗口（tick）：英雄事件后多久内必须处理（引擎周期 10 tick 的余量） */
export const VICTORY_WINDOW_TICKS = 20;

// ─── 黑板键 ──────────────────────────────────────────────

/** 本周期已喝过不祥之瓶（等待袭击/胜利；胜利处理时清除 → 允许下一瓶） */
const BB_WAITING_RAID = "raidWaiting";

/**
 * 等待原因诊断（core 纯函数，可单测）：开不了瓶时区分
 * "背包没有不祥之瓶"（通知）与"袭击进行中/胜利待处理"（静默等待）。
 * ⚠️ 周期等待（已喝过）由 idle 动作结合黑板 raidWaiting 判定为 waiting，
 *    本函数只负责无标记时的诊断。
 */
export function diagnoseRaidIdle(knowledge: RaidKnowledge): RaidIdleReason {
  const { badOmen, raidOmen, villageHero } = knowledge.effects;
  if (!badOmen && !raidOmen && !villageHero && knowledge.bottles === 0) return "no-bottle";
  return "waiting";
}

/**
 * 创建劫掠任务行为树。
 *
 * @param ports - 动作端口（mc 层实现）
 * @returns 行为树实例（每假人一棵，黑板独立）
 */
export function createRaidTaskTree(ports: RaidPorts): BehaviorTree {
  // ── 条件节点 ─────────────────────────────────────────

  /** 胜利待处理：假人带村庄英雄效果且事件尚未处理（幂等由端口 handleVictory 保证） */
  const victoryPending = new Condition((ctx) => {
    const k = ports.sense(ctx.botName);
    return k.effects.villageHero && ctx.tick - k.lastHeroEventTick <= VICTORY_WINDOW_TICKS;
  });

  /**
   * 可喝瓶（用户规格 1.1.60：**只在启动时与胜利后喝**）：
   *   无坏兆/袭击兆（一场袭击已在酝酿/进行则不重复喝）
   *   + 背包有药水
   *   + 黑板无 raidWaiting（本周期已喝过 → 等袭击/胜利，兆头消失也不重复喝）
   * ⚠️ 不拦村庄英雄：正常流程胜利处理分支（更高优先级）窗口内先处理并移除英雄；
   *    事件丢失（窗口过期）时残留英雄由喝瓶前的端口防御清理兜底（原 raidMode
   *    语义，防 effectAdd 检测链断裂卡死）。
   */
  const canDrink = new Condition((ctx) => {
    const k = ports.sense(ctx.botName);
    return (
      !k.effects.badOmen &&
      !k.effects.raidOmen &&
      k.bottles > 0 &&
      !ctx.blackboard.has(BB_WAITING_RAID)
    );
  });

  // ── 动作节点 ─────────────────────────────────────────

  /** 胜利处理：计胜 + 叠加英雄给主人 + 移除英雄 + **清周期标记（允许下一瓶）** */
  const handleVictory = new Action((ctx) => {
    ports.handleVictory(ctx.botName);
    ctx.blackboard.delete(BB_WAITING_RAID);
    return Status.Success;
  });

  /** 喝瓶：协程链（互斥/换瓶/按住饮用）；成功 → 记周期标记（进入等待）；
   *  无瓶 → 端口自动关模式，树降级 */
  const drink = new Action(async (ctx) => {
    const result = await ports.drinkBottle(ctx.botName);
    if (result !== "drunk") return Status.Failure;
    ctx.blackboard.set(BB_WAITING_RAID, true); // 本周期已喝 → 等袭击/胜利
    return Status.Success;
  });

  /** 等待：周期等待/袭击中静默；无药水通知（诊断在 core，翻译在端口） */
  const idle = new Action((ctx: AiContext) => {
    const waiting = ctx.blackboard.has(BB_WAITING_RAID);
    const reason = waiting ? "waiting" : diagnoseRaidIdle(ports.sense(ctx.botName));
    ports.idle(ctx.botName, reason);
    return Status.Success;
  });

  // ── 树装配（优先级从高到低） ─────────────────────────

  const root = new Selector([
    // 1. 胜利处理（村庄英雄效果 → 叠加给主人 + 移除 + 清周期标记 → 下 tick 自然喝下一瓶）
    new Sequence([victoryPending, handleVictory]),
    // 2. 喝瓶（启动/胜利后：无兆头 + 无英雄 + 有药水 + 未在周期等待）
    new Sequence([canDrink, drink]),
    // 3. 等待（袭击中/周期等待静默 / 无药水通知）
    idle,
  ]);

  return new BehaviorTree(root);
}

