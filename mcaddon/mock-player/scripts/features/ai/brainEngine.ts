// ─── 生物 AI 大脑引擎（新框架 scripts/ai 驱动） ────────
// 对齐 woodcut 的 brainEngine 模式（用户拍板）：每假人一个 AIBrain =
// 共享记忆（AiMemory）+ 行为运行器（BehaviorRunner 单主目标优先级抢占），
// 10 tick 驱动；能力 = Behavior 状态机（感知-决策-执行，step 同步短步）。
//
// 行为选择（用户拍板：行为标签机制已删除——统一走 record.aiBehavior 字段）：
//   "none"  不启用
//   "wander" 随机游走（空闲走走停停，近点散步）
//   "mine"   自动挖掘（视线方向 breakBlock）
//   "place"  自动放置（面前放置主手方块）
// 引擎每 10 tick 对账：record.aiBehavior → 注册/卸载对应行为（切换 → 旧行为
// reset 清状态 + 中断协程）。与旧引擎（legacy/ai/BotBrain 宝库/劫掠/钓鱼 +
// features/state/behavior.ts 标签行为）并存——旧标签机制保留 legacy 内部使用。

import { system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { AiMemory, BehaviorRunner, type Behavior, type BehaviorContext } from "../../ai";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry } from "../../bootstrap/context";
import { makeWanderBehavior } from "./capabilities/wander";
import { makeMineBehavior } from "./capabilities/mine";
import { makePlaceBehavior } from "./capabilities/place";
import { makeAttackBehavior } from "./capabilities/attack";
import type { BotRecord } from "../../rules/Types";

/** 引擎驱动周期（tick） */
const BRAIN_ENGINE_TICKS = 10;

/** 每假人大脑（记忆 + 行为运行器） */
interface AiBrain {
  memory: AiMemory;
  runner: BehaviorRunner;
}

/** botName → 假人大脑 */
const brains = new Map<string, AiBrain>();
let engineStarted = false;

/**
 * 引擎注入上下文（mc 层扩展 BehaviorContext）：
 * bot = 引擎每周期解析一次的假人实体（resolveBotPlayer 唯一入口，含缓存）——
 * 行为从 ctx.bot 直接取用，**无需再 resolve**（数据单源不变：解析仍在
 * resolveBotPlayer 一处，ctx 只是传递通道）。
 */
export interface AiBehaviorContext extends BehaviorContext {
  bot: SimulatedPlayer | undefined;
}

/** 行为构造器（aiBehavior 值 → 能力） */
const BEHAVIOR_BY_NAME: Record<string, () => Behavior> = {
  wander: makeWanderBehavior,
  mine: makeMineBehavior,
  place: makePlaceBehavior,
  attack: makeAttackBehavior,
};

/** 假人当前生物 AI 行为（record.aiBehavior；未启用 → undefined） */
function enabledBehaviorName(record: BotRecord): string | undefined {
  const name = record.aiBehavior;
  return name && BEHAVIOR_BY_NAME[name] ? name : undefined;
}

/**
 * 生物 AI 引擎：10 tick 对账（aiBehavior → 行为挂载/卸载）+ 推进全部在线
 * 假人大脑（幂等启动）。未启用生物 AI 行为 → 不创建大脑（零开销）。
 */
export function startAiEngine(): void {
  if (engineStarted) return;
  engineStarted = true;

  // 实体缓存失效由 PlayerGateway（resolveBotPlayer 唯一入口）内部订阅
  // 生命周期事件处理——引擎只管大脑清理
  BotEvents.botOffline.subscribe((e) => disposeBotBrain(e.botName));

  system.runInterval(() => {
    for (const record of botRegistry.all()) {
      // ── 引擎级可用性门卫（统一处理，行为不再各自判断） ──
      if (!record.online || record.death) continue; // 不在线/死亡 → 跳过
      try {
        const behaviorName = enabledBehaviorName(record);
        if (!behaviorName) continue; // 未启用 → 不创建大脑
        let brain = brains.get(record.name);
        if (!brain) {
          brain = { memory: new AiMemory(), runner: new BehaviorRunner() };
          brains.set(record.name, brain);
        }
        // 记忆注入（用户拍板：主动 AI 行为直接注入记忆表达——行为从记忆
        // 读取当前 aiBehavior，实体 TAG 不再参与行为表达）
        brain.memory.set("aiBehavior", behaviorName);
        // 对账：注册当前行为；卸载其它行为（切换 → 旧行为 reset 清状态）
        for (const [name, make] of Object.entries(BEHAVIOR_BY_NAME)) {
          if (name === behaviorName) {
            brain.runner.register(make());
          } else {
            brain.runner.unregister(name);
          }
        }
        const bot = resolveBotPlayer(record.name); // 每假人每周期一次（缓存 TTL 内零查询）
        if (!bot) continue; // 实体不可用（失效/瞬态）→ 本周期不推进（事件负责清理）
        const ctx: AiBehaviorContext = {
          botName: record.name,
          tick: system.currentTick,
          memory: brain.memory,
          bot,
        };
        brain.runner.step(ctx);
      } catch (e: any) {
        console.warn(`[MockPlayer] 生物 AI 引擎异常 ${record.name}: ${e?.message ?? e}`);
      }
    }
  }, BRAIN_ENGINE_TICKS);

  console.info(`[MockPlayer] 生物 AI 引擎启动（${BRAIN_ENGINE_TICKS} tick；行为: ${Object.keys(BEHAVIOR_BY_NAME).join("/")}）`);
}

/** 假人下线 → 卸载大脑（行为 reset 清状态 + 中断协程） */
export function disposeBotBrain(botName: string): void {
  const brain = brains.get(botName);
  if (!brain) return;
  brain.runner.unregisterAll();
  brains.delete(botName);
}
