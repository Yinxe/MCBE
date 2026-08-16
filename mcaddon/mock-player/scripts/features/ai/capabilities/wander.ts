// ─── 随机游走能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：利用新 AI 框架实现随机游走能力——空闲时随机走走停停。
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   idle（间隔计数）→ pick（选近点 + 发起单次导航协程）→ walk（轮询完成）
//   → rest（休息计数）→ idle 循环。
// 走停节律：间隔/休息随机 [20,60] tick——偶尔走几步、停下歇会（不连续乱走）；
// 近点（半径 ≤8 格，不计算 16 格之外）；单次导航协程有界（navigateBot 自带
// 超时/停滞判定），完成标志由 step 轮询。
// 协程防残留：reset（切换/关标签/下线）→ cancelNavigation 中断导航。

import type { Behavior, BehaviorContext } from "../../../ai";
import { randomStrollOnce, NavigateResult } from "../../basic/move";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 游走间隔（tick）：空闲后随机等待再走 */
const WANDER_INTERVAL_MIN = 20;
const WANDER_INTERVAL_MAX = 60;
/** 休息（tick）：到达后停下歇一会 */
const WANDER_REST_MIN = 20;
const WANDER_REST_MAX = 60;
/** 单次游走半径（格）：近点（≤16 格直达内） */
const WANDER_RADIUS = 8;
/** 游走速度（慢速散步） */
const WANDER_SPEED = 0.6;

/** 状态机阶段 */
type Phase = "idle" | "pick" | "walk" | "rest";

/** 随机区间整数 */
function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 停止假人移动（reset/切换时中断进行中导航；导航协程有界，静止后自行收尾） */
function stopBotMoving(botName: string): void {
  const bot = resolveBotPlayer(botName);
  if (!bot) return;
  try {
    bot.stopMoving();
  } catch {
    /* 实体失效忽略 */
  }
}

/** 创建随机游走行为（aiBehavior 标签 TAG_WANDER_MODE 开启时由引擎注册） */
export function makeWanderBehavior(): Behavior {
  let phase: Phase = "idle";
  let wait = randomBetween(WANDER_INTERVAL_MIN, WANDER_INTERVAL_MAX); // 当前阶段剩余 tick
  let run: Promise<unknown> | undefined; // 单次导航协程
  let runResult: NavigateResult | undefined; // 协程完成标志

  const startRun = (botName: string): void => {
    runResult = undefined;
    run = randomStrollOnce(botName, { radius: WANDER_RADIUS, speed: WANDER_SPEED })
      .then((r) => {
        runResult = r;
      })
      .catch(() => {
        runResult = NavigateResult.Error;
      });
  };

  const reset = (): void => {
    phase = "idle";
    wait = randomBetween(WANDER_INTERVAL_MIN, WANDER_INTERVAL_MAX);
    run = undefined;
    runResult = undefined;
  };

  return {
    name: "wander",
    priority: 10,
    canActivate: (ctx) => {
      const bot = resolveBotPlayer(ctx.botName);
      return bot !== undefined;
    },
    onActivate: (ctx) => stopBotMoving(ctx.botName),
    reset: () => {
      // 中断进行中导航 + 清状态
      const botName = lastBotName;
      if (botName) stopBotMoving(botName);
      reset();
    },
    step: (ctx) => {
      lastBotName = ctx.botName;
      switch (phase) {
        case "idle":
          // 间隔等待（走停节律：不连续乱走）
          if (--wait > 0) return;
          phase = "pick";
          break;
        case "pick":
          // 选近点 + 发起单次导航协程（有界；完成由 walk 轮询）
          startRun(ctx.botName);
          phase = "walk";
          break;
        case "walk":
          if (runResult === undefined) return; // 导航中：等待
          phase = "rest";
          wait = randomBetween(WANDER_REST_MIN, WANDER_REST_MAX);
          run = undefined;
          break;
        case "rest":
          if (--wait > 0) return;
          phase = "idle";
          wait = randomBetween(WANDER_INTERVAL_MIN, WANDER_INTERVAL_MAX);
          break;
      }
    },
  };
}

/** reset 需要 botName（Behavior.reset 无参——记录最近推进的假人） */
let lastBotName = "";
