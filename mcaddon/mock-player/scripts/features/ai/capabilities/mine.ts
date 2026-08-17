// ─── 自动挖掘能力（新框架 scripts/ai：Behavior + 常驻破块协程） ──
// 用户规格（2026-08-16）：自动挖掘应**一直持续摧毁破坏，直到能力被卸载
// 才停**——不是"step 轮询每块"的断续模式，而是一条常驻破块协程连续工作。
//
// 设计（对齐"异步函数主动取消"改造）：
//   - canActivate 只认 workMode === "mine"（**不依赖视线有目标**——暂时无
//     方块时协程内部自等，不因断流 reset 中断）
//   - onActivate → 启动一条常驻协程：viewBlock 探测 → breakBlockOnce 原子
//     破坏 → 目标消失立即探测下一块 → 直到 token.cancel()（能力卸载）
//   - reset（卸载/切换）→ **token.cancel()**（silent abort 核心）：每 tick
//     即时检测 + signal Promise.race 立即唤醒等待，无需等 pollTicks/定时器
//   - 无目标（挖空/挖到不可破方块）→ 协程低息等待固定间隔后重探，协程
//     不退出（保持"一直持续"语义）

import type { Behavior } from "../../../ai";
import type { AiBehaviorContext } from "../brainEngine";
import { system } from "@minecraft/server";
import { breakBlockOnce, viewBlock, type BreakResultValue } from "../../basic/blocks";
import { createCancelToken, type CancelToken } from "../../../rules/utils/CancelToken";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 自动挖掘行为配置（统一管理） */
export interface MineBehaviorConfig {
  /** 挖掘距离（格）：视线探测与破坏距离上限 */
  distance: number;
  /** 无线索重探间隔（tick）：视线无目标（挖空/障碍后）时协程低息等待后重探 */
  idleRecheckTicks: number;
  /** 单块破坏状态检测间隔（tick；透传 breakBlockOnce） */
  pollTicks: number;
}

/** 默认配置（统一管理；makeMineBehavior 可传自定义配置覆盖） */
export const DEFAULT_MINE_CONFIG: MineBehaviorConfig = {
  distance: 6,
  idleRecheckTicks: 10,
  pollTicks: 5,
};

/** 延迟等待（tick），可被 token 取消立即唤醒 */
function waitTicks(ticks: number, token: CancelToken): Promise<void> {
  return Promise.race([
    new Promise<void>((resolve) => system.runTimeout(resolve, ticks)),
    token.signal,
  ]);
}

/**
 * 常驻破块循环：持续"探测 → 破坏 → 下一块"，直到 token 取消。
 * 每一块用独立 breakBlockOnce（原子：内部每 tick 起手 + 轮询消失）；
 * 无目标时低息等待 idleRecheckTicks 后重探（协程不退出）。
 *
 * ⚠️ 实体获取（ctx.bot 注入 + resolve 兜底，双通道）：
 *   brainEngine 每周期（10 tick）注入最新 ctx.bot —— step 持续写入 sharedBot，
 *   协程每轮优先取用它（本周期注入的活跃实体，尊重注入通道）；若缺失或
 *   step 注入已失效（跨 await 边界，或 10 tick 间隔内实体变化未被覆盖），
 *   再用 resolveBotPlayer(botName) 立即兜底取最新——双保险。
 */
async function runMineLoop(
  botName: string,
  sharedBot: { current: ReturnType<typeof resolveBotPlayer> },
  token: CancelToken,
  config: MineBehaviorConfig,
): Promise<void> {
  while (!token.cancelled) {
    // 优先用 step 最近注入的 ctx.bot（权威）；缺失或失效 → resolve 兜底
    const bot = sharedBot.current?.isValid ? sharedBot.current : resolveBotPlayer(botName);
    if (!bot) {
      // 实体暂不可用（离线/死亡/重连中）→ 低息重试（协程保持存活）
      await waitTicks(config.idleRecheckTicks, token);
      continue;
    }
    // 探测视线方块
    const target = viewBlock(bot, config.distance);
    if (!target) {
      // 无目标：低息等待后重探（协程保持存活，符合"一直持续"语义）
      await waitTicks(config.idleRecheckTicks, token);
      continue;
    }
    // 原子破坏该块（token 透传：卸载时立即中止；内部每 tick 检测 + 起手）
    const result: BreakResultValue = await breakBlockOnce(bot, target.location, {
      maxDistance: config.distance,
      pollTicks: config.pollTicks,
      token,
    });
    if (result === "aborted") return; // 被取消（能力卸载/实体失效）→ 协程退出
    if (result !== "broken") {
      // far/offline/busy → 低息重试（不退出协程）
      await waitTicks(1, token);
    }
  }
}

/** 创建自动挖掘行为（record.workMode === "mine" 时由引擎注册） */
export function makeMineBehavior(config: MineBehaviorConfig = DEFAULT_MINE_CONFIG): Behavior {
  let token: CancelToken | undefined; // 当前协程取消令牌（reset → cancel）
  let runLoop: Promise<void> | undefined; // 常驻破块协程（未完成协程句柄）
  // 实体双通道：sharedBot 保存 step 最近注入的 ctx.bot（brainEngine 每周期刷新人）
  const sharedBot: { current: ReturnType<typeof resolveBotPlayer> } = { current: undefined };

  const startLoop = (botName: string): void => {
    if (runLoop) return; // 幂等：已有运行中协程则复用
    const t = createCancelToken();
    token = t;
    runLoop = runMineLoop(botName, sharedBot, t, config)
      .catch((e) => console.warn(`[MockPlayer] 定点挖掘协程异常 ${botName}: ${e}`))
      .finally(() => {
        if (token === t) token = undefined;
        runLoop = undefined;
      });
  };

  return {
    name: "mine",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验；**不依赖视线目标**（常用者应一直持续到卸载）
      return ctx.memory.get<string>("workMode") === "mine";
    },
    step: (ctx) => {
      // ① 接收引擎注入的 ctx.bot（每周期最新实体）→ 协程双通道的权威源
      sharedBot.current = (ctx as AiBehaviorContext).bot;
      // ② 确保常驻破块协程已启动（幂等）
      startLoop(ctx.botName);
    },
    reset: () => {
      // 能力卸载/切换 → 取消令牌（signal 唤醒 + 每 tick 检测）→ 协程立即终止
      token?.cancel();
    },
  };
}
