// ─── 生物 AI 大脑引擎（新框架 scripts/ai 驱动） ────────
// 生物 AI 大脑引擎：每假人一个 AIBrain =
// 私有记忆（AiMemory）+ 行为运行器（BehaviorRunner 单主目标优先级抢占），
// 10 tick 驱动；能力 = Behavior 状态机（感知-决策-执行，step 同步短步）。
// **跨假人共享记忆**：引擎另持全局 SharedMemory 单例（sharedMemory），
// 每个假人的 ctx.shared 都指向同一实例——一个假人写入，所有假人都能读取
// （群组级感知/协作数据）。
//
// 行为选择（用户拍板：工作模式单选——统一走 record.workMode 字段）：
//   "none"  不启用
//   "wander" 闲逛模式（空闲走走停停，近点散步）
//   "mine"   定点挖掘模式（视线方向 breakBlock）
//   "place"  定点放置模式（面前放置主手方块）
//   "attack" 定点攻击模式（攻击面前目标）
//   "fishing" 自动钓鱼模式（共享钓鱼点池 + 占用/失败标记，见 capabilities/fishing）
//   // "woodcut" 自动砍树模式已在代码层禁用（见 capabilities/woodcut）
// 引擎每 10 tick 对账：record.workMode → 注册/卸载对应行为（切换 → 旧行为
// reset 清状态 + 中断协程）。raid 由各自模块认领（互斥单字段；fishing 已入单选）。
// 与旧引擎（legacy/ai/BotBrain 宝库 + features/state/behavior.ts 标签行为）
// 并存——旧标签机制保留 legacy 内部使用。

import { system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { AiMemory, BehaviorRunner, SharedMemory, type Behavior, type BehaviorContext } from "../../ai";
import { resolveBotPlayer } from "../../bot/PlayerGateway";
import { BotEvents } from "../../events/DomainEvents";
import { botRegistry, configStore } from "../../bootstrap/context";
import { makeWanderBehavior } from "./capabilities/wander";
import { makeMineBehavior } from "./capabilities/mine";
import { makePlaceBehavior } from "./capabilities/place";
import { makeAttackBehavior } from "./capabilities/attack";
import { makeFishingBehavior } from "./capabilities/fishing";
// import { makeWoodcutBehavior } from "./capabilities/woodcut"; // 已禁用
import type { BotRecord } from "../../rules/Types";

/** 引擎驱动周期（tick） */
const BRAIN_ENGINE_TICKS = 10;

/**
 * 全局共享记忆（跨假人单例）：所有假人的生物大脑共用实例——
 * 一个假人写入，其他假人均可读取（用户需求：所有假人能读取的数据）。
 * 支持过期机制（默认延长过期 renewing：更新重置到期；fixed=定时）；独立
 * 计时器每秒扫描删除过期键（startSharedMemorySweeper）。
 * 引擎每周期注入 ctx.shared；运行时内存不持久化；键用命名空间前缀防碰撞。
 */
export const sharedMemory = new SharedMemory();

/** 共享记忆过期扫描间隔（tick）：每秒一次（用户规格——20 tick = 1 秒） */
const SHARED_MEMORY_SWEEP_TICKS = 20;
/** 幂等守卫 */
let sharedMemorySweeperStarted = false;

/**
 * 启动共享记忆过期扫描（**独立计时器**，每秒一次，幂等；main.ts worldLoad 调用）——
 * 过期的键直接删除（sweepExpired 推进内部时钟 + 物理清理）。
 */
export function startSharedMemorySweeper(): void {
  if (sharedMemorySweeperStarted) return;
  sharedMemorySweeperStarted = true;
  system.runInterval(() => {
    const removed = sharedMemory.sweepExpired(system.currentTick);
    if (removed > 0) {
      console.warn(`[MockPlayer] 共享记忆过期清理 ${removed} 键（tick ${system.currentTick}）`);
    }
  }, SHARED_MEMORY_SWEEP_TICKS);
}

/** 每假人大脑（记忆 + 行为运行器） */
interface AiBrain {
  memory: AiMemory;
  runner: BehaviorRunner;
  /** 当前对账的行为名（变化才重新挂载——避免每周期重建行为实例） */
  behaviorName?: string;
}

/** botName → 假人大脑 */
const brains = new Map<string, AiBrain>();
let engineStarted = false;

/**
 * 引擎注入上下文（mc 层扩展 BehaviorContext）：
 * bot = 引擎每周期解析一次的假人实体（resolveBotPlayer 唯一入口，含缓存）——
 * 行为从 ctx.bot 直接取用，**无需再 resolve**（数据单源不变：解析仍在
 * resolveBotPlayer 一处，ctx 只是传递通道）；
 * shared = 跨假人全局共享记忆（engine 单例，所有假人都能读写）。
 */
export interface AiBehaviorContext extends BehaviorContext {
  bot: SimulatedPlayer | undefined;
  shared: SharedMemory;
}

/** 行为构造器（workMode 值 → 能力） */
const BEHAVIOR_BY_NAME: Record<string, () => Behavior> = {
  wander: makeWanderBehavior,
  mine: makeMineBehavior,
  place: makePlaceBehavior,
  attack: makeAttackBehavior,
  fishing: makeFishingBehavior,
  // woodcut: makeWoodcutBehavior, // 已在代码层禁用
};

/** 假人当前生物 AI 行为（record.workMode；未启用 → undefined） */
function enabledBehaviorName(record: BotRecord): string | undefined {
  const name = record.workMode;
  if (!name || !BEHAVIOR_BY_NAME[name]) return undefined;
  // 已被管理员禁用的工作模式视为未启用
  if (name !== "none" && !configStore.isWorkModeEnabled(name)) return undefined;
  return name;
}

/**
 * 生物 AI 引擎：10 tick 对账（workMode → 行为挂载/卸载）+ 推进全部在线
 * 假人大脑（幂等启动）。未启用生物 AI 行为 → 不创建大脑（零开销）。
 */
export function startAiEngine(): void {
  if (engineStarted) return;
  engineStarted = true;

  // 实体缓存失效由 PlayerGateway（resolveBotPlayer 唯一入口）内部订阅
  // 生命周期事件处理——引擎只管大脑清理
  BotEvents.botOffline.subscribe((e) => disposeBotBrain(e.botName));

  system.runInterval(() => {
    // 注册表直接筛出"在线且未死亡"记录——免遍历全部再逐条过滤
    for (const record of botRegistry.onlineAlive()) {
      try {
        const behaviorName = enabledBehaviorName(record);
        if (!behaviorName) {
          // 未启用/切到 none：卸载大脑（行为 reset → 中止进行中协程）。
          // ⚠️ 不能直接 continue——后台 breakBlockAt/导航协程会继续跑，
          // 直到目标挖掉/超时才停（审核 S1：关停必须中断）。
          disposeBotBrain(record.name);
          continue;
        }
        let brain = brains.get(record.name);
        if (!brain) {
          brain = { memory: new AiMemory(), runner: new BehaviorRunner() };
          brains.set(record.name, brain);
        }
        // 记忆注入（用户拍板：主动 AI 行为直接注入记忆表达——行为从记忆
        // 读取当前 workMode，实体 TAG 不再参与行为表达）
        brain.memory.set("workMode", behaviorName);
        // 砍树子模式注入已随 woodcut 一起禁用
        // if (behaviorName === "woodcut") {
        //   brain.memory.set("woodcutMode", record.woodcutMode ?? "logs");
        // }
        // 对账（仅行为变化时执行）：注册新行为 + 卸载旧行为（旧行为 reset 清状态）
        if (brain.behaviorName !== behaviorName) {
          for (const [name, make] of Object.entries(BEHAVIOR_BY_NAME)) {
            if (name === behaviorName) {
              brain.runner.register(make());
            } else {
              brain.runner.unregister(name);
            }
          }
          brain.behaviorName = behaviorName;
        }
        const bot = resolveBotPlayer(record.name); // 每假人每周期一次（缓存 TTL 内零查询）
        if (!bot) continue; // 实体不可用（失效/瞬态）→ 本周期不推进（事件负责清理）
        const ctx: AiBehaviorContext = {
          botName: record.name,
          tick: system.currentTick,
          memory: brain.memory,
          bot,
          shared: sharedMemory,
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
