// ─── 自动攻击能力（新框架 scripts/ai：Behavior + 常驻攻击协程） ──
// 用户反馈（2026-08-17）：定点攻击也慢——旧实现每引擎周期（10 tick）才
// attack 一次（≈0.5s/击），顿挫感明显。改对齐 mine 的常驻协程模式：
// 能力激活期间一条协程按自身节奏（intervalTicks）连续攻击，**不受引擎
// 10 tick 节拍限制**；reset（卸载/切换）→ token.cancel() 立即中止。
//
// 节奏对齐玩家连点：基岩版近战攻击 swing ≈4 tick（0.2s）一次。

import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { system } from "@minecraft/server";
import { createCancelToken, type CancelToken } from "../../../rules/utils/CancelToken";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 自动攻击行为配置（统一管理） */
export interface AttackBehaviorConfig {
  /** 攻击间隔（tick）：连续攻击节奏（玩家连点 ≈4 tick/击；原 10 tick/击） */
  intervalTicks: number;
}

/** 默认配置（统一管理；makeAttackBehavior 可传自定义配置覆盖） */
export const DEFAULT_ATTACK_CONFIG: AttackBehaviorConfig = {
  intervalTicks: 4,
};

/** 延迟等待（tick），可被 token 取消立即唤醒 */
function waitTicks(ticks: number, token: CancelToken): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => system.runTimeout(resolve, ticks)),
    token.signal,
  ]);
}

/**
 * 常驻攻击循环：持续攻击（attack 最近目标），直到 token 取消。
 * attack() 为同步瞬时调用（内部 try-catch 隔离，不影响循环）；
 * 实体不可用时低息等待后重试（协程保持存活，符合"一直持续"语义）。
 */
async function runAttackLoop(
  botName: string,
  sharedBot: { current: ReturnType<typeof resolveBotPlayer> },
  token: CancelToken,
  config: AttackBehaviorConfig,
): Promise<void> {
  while (!token.cancelled) {
    // 优先用 step 最近注入的 ctx.bot（权威）；缺失或失效 → resolve 兜底
    const bot = sharedBot.current?.isValid ? sharedBot.current : resolveBotPlayer(botName);
    if (!bot) {
      // 实体暂不可用（离线/死亡/重连中）→ 低息重试（协程保持存活）
      await waitTicks(config.intervalTicks, token);
      continue;
    }
    try {
      bot.attack();
    } catch (e: any) {
      console.warn(`[MockPlayer] 自动攻击异常 ${botName}: ${e?.message ?? e}`);
    }
    await waitTicks(config.intervalTicks, token);
  }
}

/** 创建自动攻击行为（record.workMode === "attack" 时由引擎注册） */
export function makeAttackBehavior(config: AttackBehaviorConfig = DEFAULT_ATTACK_CONFIG): Behavior {
  let token: CancelToken | undefined; // 当前协程取消令牌（reset → cancel）
  let runLoop: Promise<void> | undefined; // 常驻攻击协程（未完成协程句柄）
  // 实体双通道：sharedBot 保存 step 最近注入的 ctx.bot（brainEngine 每周期刷新人）
  const sharedBot: { current: ReturnType<typeof resolveBotPlayer> } = { current: undefined };

  const startLoop = (botName: string): void => {
    if (runLoop) return; // 幂等：已有运行中协程则复用
    const t = createCancelToken();
    token = t;
    runLoop = runAttackLoop(botName, sharedBot, t, config)
      .catch((e) => console.warn(`[MockPlayer] 定点攻击协程异常 ${botName}: ${e}`))
      .finally(() => {
        if (token === t) token = undefined;
        runLoop = undefined;
      });
  };

  return {
    name: "attack",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验；**不依赖视线目标**（常用者应一直持续到卸载）
      return ctx.memory.get<string>("workMode") === "attack";
    },
    step: (ctx) => {
      // ① 接收引擎注入的 ctx.bot（每周期最新实体）→ 协程双通道的权威源
      sharedBot.current = (ctx as AiBehaviorContext).bot;
      // ② 确保常驻攻击协程已启动（幂等）
      startLoop(ctx.botName);
    },
    reset: () => {
      // 能力卸载/切换 → 取消令牌（signal 唤醒 + 每 tick 检测）→ 协程立即终止
      token?.cancel();
    },
  };
}