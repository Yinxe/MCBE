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

// ⚠️ 等待单位 = **引擎周期**（step 每 10 tick 一次，--wait 递减的是周期数）：
//   官方 RandomStrollGoal 默认 interval=120 tick（6 秒）倒计时挑目标；
//   本实现走完停 1~2 秒（2~4 周期）再等 1~3 秒（2~6 周期）——比官方略活泼。

/** 游走间隔（引擎周期 = 10 tick）：走完歇一会再走（1~3 秒 → 2~6 周期） */
const WANDER_INTERVAL_MIN = 2;
const WANDER_INTERVAL_MAX = 6;
/** 休息（引擎周期）：到达后短暂停顿（1~2 秒 → 2~4 周期） */
const WANDER_REST_MIN = 2;
const WANDER_REST_MAX = 4;
/** 导航失败后的快速重试等待（引擎周期：0.5 秒 → 1 周期——失败不长时间站立） */
const WANDER_FAIL_RETRY = 1;
/** 单次游走半径（格）：近点（≤16 格直达内） */
const WANDER_RADIUS = 8;
/** 游走速度（慢速散步） */
const WANDER_SPEED = 0.6;
/** 转头随机朝向距离（格，看向点的距离） */
const LOOK_AROUND_DISTANCE = 5;

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

/**
 * 随机转身/扭头（官方随机视角转向意向）：
 * 静止时随机看向一个方向（随机偏航 → 看向该方向 5 格处）——
 * 转身后实体朝向变化，下次游走的朝向偏置选点自然偏向该方向。
 */
function lookAround(botName: string): void {
  const bot = resolveBotPlayer(botName);
  if (!bot) return;
  const yaw = Math.random() * 360;
  const rad = (yaw * Math.PI) / 180;
  try {
    // MCBE 朝向向量 (-sin(yaw), 0, cos(yaw))——看向随机方向点
    bot.lookAtLocation({
      x: bot.location.x + -Math.sin(rad) * LOOK_AROUND_DISTANCE,
      y: bot.location.y,
      z: bot.location.z + Math.cos(rad) * LOOK_AROUND_DISTANCE,
    });
  } catch {
    /* 看向失败（chunkload 受限等）不影响 */
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
          // 间隔等待（走停节律：不连续乱走）；静止时经常性转身/扭头
          lookAround(ctx.botName);
          if (--wait > 0) return;
          phase = "pick";
          break;
        case "pick":
          // 选近点（朝向偏置——大概率朝转身方向）+ 发起单次导航协程
          logStroll(ctx.botName, "出发（选点+移动）");
          startRun(ctx.botName);
          phase = "walk";
          break;
        case "walk":
          if (runResult === undefined) return; // 导航中：等待
          run = undefined;
          if (runResult === NavigateResult.Arrived) {
            // 到达：短暂休息（走停节律）
            logStroll(ctx.botName, "到达，休息片刻");
            phase = "rest";
            wait = randomBetween(WANDER_REST_MIN, WANDER_REST_MAX);
          } else {
            // 导航失败（无路径/卡住/超时）：快速重试——短等待后重新选点，
            // 不进入长休息（避免"站半天"）
            logStroll(ctx.botName, `导航失败(${runResult})，快速重试`);
            phase = "idle";
            wait = WANDER_FAIL_RETRY;
          }
          break;
        case "rest":
          // 休息时经常性转身/扭头（官方随机视角意向：静止时频繁转头）
          lookAround(ctx.botName);
          if (--wait > 0) return;
          phase = "idle";
          wait = randomBetween(WANDER_INTERVAL_MIN, WANDER_INTERVAL_MAX);
          break;
      }
    },
  };
}

/** 游走状态日志（状态切换时打印——节流不刷屏；观察调度是否在跑） */
function logStroll(botName: string, msg: string): void {
  console.info(`[MockPlayer] 生物AI ${botName} 随机游走: ${msg}`);
}

/** reset 需要 botName（Behavior.reset 无参——记录最近推进的假人） */
let lastBotName = "";
