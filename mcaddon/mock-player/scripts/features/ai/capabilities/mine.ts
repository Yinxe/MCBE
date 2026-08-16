// ─── 自动挖掘能力（新框架 scripts/ai：Behavior 状态机） ──
// woodcut 成熟实现移植：持续破坏方块（看哪挖哪）。
// 状态机（step 同步短步）：
//   idle → break（视线探测 → 启动 breakBlockAt 协程持续破坏）→
//   轮询完成 → paused（块间微停，掉落物下落）→ 同一 step 立即探测下一块
//   → 循环。
// breakBlockAt 功能完备（blockBreak.ts）：每 tick 起手 breakBlock +
// 轮询检测（实体/距离/方块消失）+ 并发防护 + 成功信号 + 全退出清理。
// reset（切换/关行为）→ shouldStop 中止协程（防残留）。
// 常量统一收敛到 MineBehaviorConfig。
//
// ⚠️ 停顿语义（2026-08-16 用户反馈"挖一段时间停一段时间"根因修复）：
//   brainEngine 每 BRAIN_ENGINE_TICKS(10) tick 才 step 一次——若用"step 计数
//   递减"做块间停顿（旧实现 pauseTicks=5），真实停顿 = 5×10 = 50 tick ≈ 2.5秒，
//   每挖一块就停 2.5 秒，即用户感知的周期停顿。旧版（behavior.ts autoMineLoop）
//   是 1 tick 协程自调度 + broken 后立即下一块，零停顿。
//   修复：broken → **同一 step 内立即 viewBlock + startRun 下一块**（块间只留
//   协程交接的瞬隙，对齐旧版"无脑向前挖"）；step 间隙（≤10 tick）由引擎驱动
//   天然存在，不再人为放大。

import type { Behavior, BehaviorContext } from "../../../ai";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { AiBehaviorContext } from "../brainEngine";
import { breakBlockAt, viewBlock, type BreakResult } from "../../task/blockBreak";

/** 自动挖掘行为配置（统一管理） */
export interface MineBehaviorConfig {
  /** 挖掘距离（格）：视线探测与破坏距离上限 */
  distance: number;
  /**
   * 块间停顿（tick，真实 tick 语义）：挖掘推进 + 掉落物下落。
   * 默认 0 = 同一 step 立即挖下一块（对齐旧版无脑挖）。
   * ⚠️ 不能设太大——引擎每 10 tick 才 step 一次，停顿会被 step 周期叠加。
   */
  pauseTicks: number;
}

/** 默认配置（统一管理；makeMineBehavior 可传自定义配置覆盖） */
export const DEFAULT_MINE_CONFIG: MineBehaviorConfig = {
  distance: 6,
  pauseTicks: 0,
};

/** 创建自动挖掘行为（record.workMode === "mine" 时由引擎注册） */
export function makeMineBehavior(config: MineBehaviorConfig = DEFAULT_MINE_CONFIG): Behavior {
  let pauseUntil = 0; // 块间停顿截止“真实 tick”（ctx.tick 语义——非 step 计数）
  let run: Promise<unknown> | undefined; // 持续破坏协程
  let runResult: BreakResult | undefined; // 协程完成标志
  let aborted = false; // 中止标志（reset → shouldStop 让协程退出）
  let bot: SimulatedPlayer | undefined; // 最近实体

  const startRun = (botName: string, target: { x: number; y: number; z: number }): void => {
    aborted = false;
    runResult = undefined;
    run = breakBlockAt(botName, target, {
      maxDistance: config.distance,
      skipLook: true, // 连续同向挖掘：视线已对准，跳过扭头（每块省停顿）
      shouldStop: () => aborted,
    })
      .then((r) => {
        runResult = r;
      })
      .catch(() => {
        runResult = "aborted";
      });
  };

  const reset = (): void => {
    aborted = true; // 中止进行中协程（shouldStop 轮询感知）
    pauseUntil = 0;
    run = undefined;
    runResult = undefined;
  };

  /** 同一 step 内检查块间微停（真实 tick 语义）后启动破坏协程 */
  const startNext = (ctx: BehaviorContext, target: { x: number; y: number; z: number }): void => {
    const now = ctx.tick;
    if (config.pauseTicks > 0 && now < pauseUntil) return; // 微停中 → 本 step 不动
    startRun(ctx.botName, target);
  };

  return {
    name: "mine",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验（可用性已由引擎门卫统一处理）
      if (ctx.memory.get<string>("workMode") !== "mine") return false;
      const b = (ctx as AiBehaviorContext).bot;
      if (!b) return false;
      // 视线有可挖方块才激活（看哪挖哪）
      return viewBlock(b, config.distance) !== undefined;
    },
    reset,
    step: (ctx) => {
      bot = (ctx as AiBehaviorContext).bot;
      if (!bot) return;
      if (!run) {
        // idle → 视线探测 → 启动持续破坏协程（有界：shouldStop/完成标志轮询）
        const inSight = viewBlock(bot, config.distance);
        if (!inSight) {
          reset(); // 无目标 → 下轮重评（canActivate）
          return;
        }
        startNext(ctx, inSight.location);
        return;
      }
      if (runResult === undefined) return; // 破坏中：等待
      const result = runResult;
      run = undefined;
      runResult = undefined;
      if (result !== "broken") {
        reset(); // far/aborted/offline/busy → 下轮重试
        return;
      }
      // 目标已摧毁 → **同一 step 内立即探测下一块**（对齐旧版"无脑向前挖"；
      // 块间只留协程交接瞬隙。pauseTicks>0 时开启真实 tick 微停窗口——
      // 引擎每 10 tick 才 step，微停不会被放大成 50 tick 停顿）
      if (config.pauseTicks > 0) pauseUntil = ctx.tick + config.pauseTicks;
      const next = viewBlock(bot, config.distance);
      if (!next) {
        reset(); // 挖到边界/无目标 → 下轮重评
        return;
      }
      startNext(ctx, next.location);
    },
  };
}
