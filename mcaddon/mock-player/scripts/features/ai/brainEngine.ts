// ─── 生物 AI 大脑引擎（新框架 scripts/ai 驱动） ────────
// 对齐 woodcut 的 brainEngine 模式（用户拍板）：每假人一个 AIBrain =
// 共享记忆（AiMemory）+ 行为运行器（BehaviorRunner 单主目标优先级抢占），
// 10 tick 驱动；能力 = Behavior 状态机（感知-决策-执行，step 同步短步）。
//
// 标签对账（按功能启停）：假人开启某生物 AI 能力标签（如 TAG_WANDER_MODE）
// → 注册对应行为；移除标签 → 卸载行为（reset 清状态 + 中断协程）。
// 与旧引擎（legacy/ai/BotBrain）并存：旧引擎管旧行为标签（宝库/劫掠/钓鱼），
// 本引擎管新框架生物 AI 能力标签。

import { system } from "@minecraft/server";

import { AiMemory, BehaviorRunner, type Behavior, type BehaviorContext } from "../../ai";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry } from "../../bootstrap/context";
import { TAG_WANDER_MODE } from "../../rules/tags/BotTags";
import { makeWanderBehavior } from "./capabilities/wander";
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

/** 行为构造器（标签 → 能力；能力随标签开关注册/卸载） */
const BEHAVIOR_BY_TAG: Record<string, () => Behavior> = {
  [TAG_WANDER_MODE.value]: makeWanderBehavior,
};

/** 假人已开启的生物 AI 能力标签（互斥组保证至多一个） */
function enabledBehaviorTag(record: BotRecord): string | undefined {
  for (const tag of record.tags) {
    if (BEHAVIOR_BY_TAG[tag]) return tag;
  }
  return undefined;
}

/**
 * 生物 AI 引擎：10 tick 对账（标签 → 行为挂载/卸载）+ 推进全部在线假人大脑
 * （幂等启动）。未开启任何生物 AI 能力标签 → 不创建大脑（零开销）。
 */
export function startAiEngine(): void {
  if (engineStarted) return;
  engineStarted = true;

  BotEvents.botOffline.subscribe((e) => disposeBotBrain(e.botName));

  system.runInterval(() => {
    for (const record of botRegistry.all()) {
      if (!record.online) continue;
      try {
        const tag = enabledBehaviorTag(record);
        if (!tag) continue; // 未开启生物 AI 能力 → 不创建大脑
        let brain = brains.get(record.name);
        if (!brain) {
          brain = { memory: new AiMemory(), runner: new BehaviorRunner() };
          brains.set(record.name, brain);
        }
        // 对账：注册当前标签对应行为；卸载其它能力行为（同名注册幂等）
        for (const [t, make] of Object.entries(BEHAVIOR_BY_TAG)) {
          const name = make().name;
          if (t === tag) {
            brain.runner.register(make());
          } else {
            brain.runner.unregister(name);
          }
        }
        const ctx: BehaviorContext = { botName: record.name, tick: system.currentTick, memory: brain.memory };
        brain.runner.step(ctx);
      } catch (e: any) {
        console.warn(`[MockPlayer] 生物 AI 引擎异常 ${record.name}: ${e?.message ?? e}`);
      }
    }
  }, BRAIN_ENGINE_TICKS);

  console.info(`[MockPlayer] 生物 AI 引擎启动（${BRAIN_ENGINE_TICKS} tick；能力: ${Object.keys(BEHAVIOR_BY_TAG).join("/")}）`);
}

/** 假人下线 → 卸载大脑（行为 reset 清状态 + 中断协程） */
export function disposeBotBrain(botName: string): void {
  const brain = brains.get(botName);
  if (!brain) return;
  brain.runner.unregisterAll();
  brains.delete(botName);
}
