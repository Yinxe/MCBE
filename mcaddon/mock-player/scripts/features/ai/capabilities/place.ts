// ─── 自动放置能力（新框架 scripts/ai：Behavior + 常驻放置协程） ──
// 用户反馈（2026-08-17）：定点放置太慢——旧实现每 interval=3 个引擎周期
// （10 tick）才放一个方块（≈1.5s/块），远慢于定点挖掘。改对齐 mine 的
// 常驻协程模式：能力激活期间一条协程按自身节奏（intervalTicks）连续放置，
// **不受引擎 10 tick 节拍限制**；reset（卸载/切换）→ token.cancel() 立即中止。
//
// 设计（对齐 runMineLoop）：
//   - canActivate 只认 workMode === "place"（不依赖视线有可放位置——协程
//     内部持续尝试，不因断流 reset 中断）
//   - step → 幂等启动常驻放置协程；reset → token.cancel()（silent abort）
//   - 实体双通道：step 注入的 ctx.bot 优先（尊重引擎注入），失效/缺失再
//     resolveBotPlayer 兜底——对齐定点挖掘 b28023a 的通道修复
//   - 协程内 await placeBlockOnce（等入队动作落地，防 startBuild/stopBuild
//     重叠），再等待 intervalTicks 进入下一块——节奏 ≈ 玩家连放

import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { system } from "@minecraft/server";
import { placeBlockOnce } from "../../basic/blocks";
import { createCancelToken, type CancelToken } from "../../../rules/utils/CancelToken";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 自动放置行为配置（统一管理） */
export interface PlaceBehaviorConfig {
  /** 放置间隔（tick）：连续放置节奏（玩家连放 ≈4 tick 一块；原 30 tick/块） */
  intervalTicks: number;
}

/** 默认配置（统一管理；makePlaceBehavior 可传自定义配置覆盖） */
export const DEFAULT_PLACE_CONFIG: PlaceBehaviorConfig = {
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
 * 常驻放置循环：持续"放置主手方块到面前"，直到 token 取消。
 * 每一块用独立 placeBlockOnce（原子：system.run 内 startBuild→stopBuild）；
 * 实体不可用时低息等待后重试（协程保持存活，符合"一直持续"语义）。
 */
async function runPlaceLoop(
  botName: string,
  sharedBot: { current: ReturnType<typeof resolveBotPlayer> },
  token: CancelToken,
  config: PlaceBehaviorConfig,
): Promise<void> {
  while (!token.cancelled) {
    // 优先用 step 最近注入的 ctx.bot（权威）；缺失或失效 → resolve 兜底
    const bot = sharedBot.current?.isValid ? sharedBot.current : resolveBotPlayer(botName);
    if (!bot) {
      // 实体暂不可用（离线/死亡/重连中）→ 低息重试（协程保持存活）
      await waitTicks(config.intervalTicks, token);
      continue;
    }
    // 原子放置一次（await 等入队动作落地；内部容错 resolve(false)，不 reject）
    await placeBlockOnce(bot);
    // 下一块：等待放置间隔（token 取消时立即唤醒退出）
    await waitTicks(config.intervalTicks, token);
  }
}

/** 创建自动放置行为（record.workMode === "place" 时由引擎注册） */
export function makePlaceBehavior(config: PlaceBehaviorConfig = DEFAULT_PLACE_CONFIG): Behavior {
  let token: CancelToken | undefined; // 当前协程取消令牌（reset → cancel）
  let runLoop: Promise<void> | undefined; // 常驻放置协程（未完成协程句柄）
  // 实体双通道：sharedBot 保存 step 最近注入的 ctx.bot（brainEngine 每周期刷新人）
  const sharedBot: { current: ReturnType<typeof resolveBotPlayer> } = { current: undefined };

  const startLoop = (botName: string): void => {
    if (runLoop) return; // 幂等：已有运行中协程则复用
    const t = createCancelToken();
    token = t;
    runLoop = runPlaceLoop(botName, sharedBot, t, config)
      .catch((e) => console.warn(`[MockPlayer] 定点放置协程异常 ${botName}: ${e}`))
      .finally(() => {
        if (token === t) token = undefined;
        runLoop = undefined;
      });
  };

  return {
    name: "place",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验；**不依赖视线目标**（常用者应一直持续到卸载）
      return ctx.memory.get<string>("workMode") === "place";
    },
    step: (ctx) => {
      // ① 接收引擎注入的 ctx.bot（每周期最新实体）→ 协程双通道的权威源
      sharedBot.current = (ctx as AiBehaviorContext).bot;
      // ② 确保常驻放置协程已启动（幂等）
      startLoop(ctx.botName);
    },
    reset: () => {
      // 能力卸载/切换 → 取消令牌（signal 唤醒 + 每 tick 检测）→ 协程立即终止
      token?.cancel();
    },
  };
}