// ─── 随机游走能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：利用新 AI 框架实现随机游走能力——空闲时随机走走停停。
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   idle（间隔计数）→ pick（选近点 + 发起单次导航协程）→ walk（轮询完成）
//   → rest（休息计数）→ idle 循环。
// 走停节律（实测调优：避免"一愣一愣站半天"）：间隔/休息缩短到
//   [8,20]/[8,16] tick——走完歇 0.4-0.8 秒再走，不长时间站立；
//   导航失败（无路径/卡住）→ 快速重试（5-10 tick 后重新选点），
//   不进入长休息。
// 近点（半径 ≤8 格，不计算 16 格之外）；单次导航协程有界（navigateBot 自带
// 超时/停滞判定），完成标志由 step 轮询。
// 协程防残留：reset（切换/关标签/下线）→ stopMoving 中断导航。

import type { Behavior, BehaviorContext } from "../../../ai";
import { randomStrollOnce, NavigateResult } from "../../basic/move";
import { resolveBotPlayer } from "../../../bot/PlayerGateway";

/** 游走间隔（tick）：走完歇一会再走（短——0.4~1 秒，不站半天） */
const WANDER_INTERVAL_MIN = 8;
const WANDER_INTERVAL_MAX = 20;
/** 休息（tick）：到达后短暂停顿（0.4~0.8 秒） */
const WANDER_REST_MIN = 8;
const WANDER_REST_MAX = 16;
/** 导航失败后的快速重试等待（tick：0.25~0.5 秒——失败不长时间站立） */
const WANDER_FAIL_RETRY_MIN = 5;
const WANDER_FAIL_RETRY_MAX = 10;
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
          run = undefined;
          if (runResult === NavigateResult.Arrived) {
            // 到达：短暂休息（走停节律）
            phase = "rest";
            wait = randomBetween(WANDER_REST_MIN, WANDER_REST_MAX);
          } else {
            // 导航失败（无路径/卡住/超时）：快速重试——短等待后重新选点，
            // 不进入长休息（避免"站半天"）
            phase = "idle";
            wait = randomBetween(WANDER_FAIL_RETRY_MIN, WANDER_FAIL_RETRY_MAX);
          }
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
