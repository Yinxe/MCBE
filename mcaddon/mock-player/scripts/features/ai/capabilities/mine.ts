// ─── 自动挖掘能力（新框架 scripts/ai：Behavior 状态机） ──
// woodcut 成熟实现移植：持续破坏方块（看哪挖哪）。
// 状态机（step 同步短步）：
//   idle → break（视线探测 → 启动 breakBlockAt 协程持续破坏）→
//   轮询完成 → pause（块间停顿，掉落物下落）→ 循环。
// breakBlockAt 功能完备（blockBreak.ts）：每 tick 起手 breakBlock +
// 轮询检测（实体/距离/方块消失）+ 并发防护 + 成功信号 + 全退出清理。
// reset（切换/关行为）→ shouldStop 中止协程（防残留）。
// 常量统一收敛到 MineBehaviorConfig。

import type { Behavior, BehaviorContext } from "../../../ai";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { AiBehaviorContext } from "../brainEngine";
import { breakBlockAt, viewBlock, type BreakResult } from "../../task/blockBreak";

/** 自动挖掘行为配置（统一管理） */
export interface MineBehaviorConfig {
  /** 挖掘距离（格）：视线探测与破坏距离上限 */
  distance: number;
  /** 块间停顿（tick）：挖掘推进 + 掉落物下落 */
  pauseTicks: number;
}

/** 默认配置（统一管理；makeMineBehavior 可传自定义配置覆盖） */
export const DEFAULT_MINE_CONFIG: MineBehaviorConfig = {
  distance: 6,
  pauseTicks: 5,
};

/** 创建自动挖掘行为（record.workMode === "mine" 时由引擎注册） */
export function makeMineBehavior(config: MineBehaviorConfig = DEFAULT_MINE_CONFIG): Behavior {
  let waiting = 0; // 块间停顿计数
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
    waiting = 0;
    run = undefined;
    runResult = undefined;
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
      // 块间停顿（挖掘推进 + 掉落物下落）
      if (waiting > 0) {
        waiting--;
        return;
      }
      if (!run) {
        // idle → 视线探测 → 启动持续破坏协程（有界：shouldStop/完成标志轮询）
        const inSight = viewBlock(bot, config.distance);
        if (!inSight) {
          reset(); // 无目标 → 下轮重评（canActivate）
          return;
        }
        startRun(ctx.botName, inSight.location);
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
      // 目标已摧毁 → 块间停顿后继续下一块
      waiting = config.pauseTicks;
    },
  };
}
