// ─── 随机游走能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：利用新 AI 框架实现随机游走能力——空闲时随机走走停停。
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   idle（间隔计数）→ pick（选近点 + 发起单次导航协程）→ walk（轮询完成）
//   → rest（休息计数）→ idle 循环。
// 近点（半径 ≤8 格，不计算 16 格之外）；单次导航协程有界（navigateBot 自带
// 超时/停滞判定），完成标志由 step 轮询。
// 协程防残留：reset（切换/关标签/下线）→ stopMoving 中断导航。
// ⚠️ 全部节奏/范围常量统一收敛到 WanderBehaviorConfig（配置接口 + 默认值），
//    不再散落裸常量——调参只改配置。

import type { Behavior, BehaviorContext } from "../../../ai";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { randomStrollOnce, NavigateResult } from "../../basic/move";
import type { AiBehaviorContext } from "../brainEngine";

// ⚠️ 等待单位 = **引擎周期**（step 每 10 tick 一次，--wait 递减的是周期数）：
//   官方 RandomStrollGoal 默认 interval=120 tick（6 秒）倒计时挑目标；
//   本实现走完停 1~2.5 秒（2~5 周期）再等 1.5~4 秒（3~8 周期）——比官方略活泼。

/** 随机游走行为配置（统一管理：节奏/范围/转头参数） */
export interface WanderBehaviorConfig {
  /** 游走间隔下限（引擎周期 = 10 tick）：走完歇一会再走 */
  intervalMin: number;
  /** 游走间隔上限（引擎周期） */
  intervalMax: number;
  /** 休息下限（引擎周期）：到达后短暂停顿 */
  restMin: number;
  /** 休息上限（引擎周期） */
  restMax: number;
  /** 导航失败后的快速重试等待（引擎周期：失败不长时间站立） */
  failRetry: number;
  /** 单次游走半径（格）：近点（≤16 格直达内） */
  radius: number;
  /** 游走速度（慢速散步） */
  speed: number;
  /** 转头节流（引擎周期）：静止时偶尔扭头 */
  lookAroundInterval: number;
  /** 转头随机朝向距离（格，看向点的距离） */
  lookAroundDistance: number;
  /** 小幅扭头概率（0~1；其余为大幅随机转头） */
  lookSmallChance: number;
  /** 小幅扭头角度（±度）：当前朝向附近微调 */
  lookSmallSpread: number;
}

/** 默认配置（统一管理；makeWanderBehavior 可传自定义配置覆盖） */
export const DEFAULT_WANDER_CONFIG: WanderBehaviorConfig = {
  intervalMin: 3,
  intervalMax: 8,
  restMin: 2,
  restMax: 5,
  failRetry: 1,
  radius: 8,
  speed: 0.6,
  lookAroundInterval: 4,
  lookAroundDistance: 5,
  lookSmallChance: 0.7,
  lookSmallSpread: 25,
};

/** 状态机阶段 */
type Phase = "idle" | "pick" | "walk" | "rest";

/** 随机区间整数 */
function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 停止假人移动（reset/切换时中断进行中导航；导航协程有界，静止后自行收尾） */
function stopBotMoving(bot: SimulatedPlayer | undefined): void {
  if (!bot) return;
  try {
    bot.stopMoving();
  } catch {
    /* 实体失效忽略 */
  }
}

/**
 * 偶尔扭头（官方随机视角转向意向，自然化）：
 * 大部分时候（70%）在当前朝向基础上**小幅扭动**（±25°——"扭一下头"），
 * 小概率（30%）才大幅随机转头（东张西望感）。
 * 转身后实体朝向变化，下次游走的朝向偏置选点自然偏向该方向。
 */
function lookAround(bot: SimulatedPlayer | undefined, cfg: WanderBehaviorConfig): void {
  if (!bot) return;
  let yaw: number;
  if (Math.random() < cfg.lookSmallChance) {
    // 小幅扭动：当前朝向 ±spread（"扭一下头"）
    let base = 0;
    try {
      base = bot.getRotation().y;
    } catch {
      /* 读取失败按 0 */
    }
    yaw = base + (Math.random() * 2 - 1) * cfg.lookSmallSpread;
  } else {
    // 小概率大幅转头（自然东张西望）
    yaw = Math.random() * 360;
  }
  const rad = (yaw * Math.PI) / 180;
  try {
    // MCBE 朝向向量 (-sin(yaw), 0, cos(yaw))——看向该方向点
    bot.lookAtLocation({
      x: bot.location.x + -Math.sin(rad) * cfg.lookAroundDistance,
      y: bot.location.y,
      z: bot.location.z + Math.cos(rad) * cfg.lookAroundDistance,
    });
  } catch {
    /* 看向失败（chunkload 受限等）不影响 */
  }
}

/** 创建随机游走行为（默认配置见 DEFAULT_WANDER_CONFIG；可传自定义配置覆盖） */
export function makeWanderBehavior(config: WanderBehaviorConfig = DEFAULT_WANDER_CONFIG): Behavior {
  let phase: Phase = "idle";
  let wait = randomBetween(config.intervalMin, config.intervalMax); // 当前阶段剩余周期
  let run: Promise<unknown> | undefined; // 单次导航协程
  let runResult: NavigateResult | undefined; // 协程完成标志
  let lookTick = 0; // 转头节流计数
  let failStreak = 0; // 连续失败计数（日志降频）
  // ⚠️ reset 无参（Behavior.reset 签名）——用最近 step 的实体引用中断移动；
  // 必须放闭包内（每假人一实例），放模块级会跨假人共享误停他 bot（审核 M1）
  let lastBot: SimulatedPlayer | undefined;

  const startRun = (botName: string): void => {
    runResult = undefined;
    run = randomStrollOnce(botName, { radius: config.radius, speed: config.speed })
      .then((r) => {
        runResult = r;
      })
      .catch(() => {
        runResult = NavigateResult.Error;
      });
  };

  const reset = (): void => {
    phase = "idle";
    wait = randomBetween(config.intervalMin, config.intervalMax);
    run = undefined;
    runResult = undefined;
  };

  return {
    name: "wander",
    priority: 10,
    canActivate: (ctx) => {
      // 记忆注入自校验（可用性已由引擎门卫统一处理——在线/未死亡/实体有效）
      return ctx.memory.get<string>("aiBehavior") === "wander";
    },
    onActivate: (ctx) => stopBotMoving((ctx as AiBehaviorContext).bot),
    reset: () => {
      // 中断进行中导航 + 清状态（reset 无 ctx——用最近推进的实体引用）
      if (lastBot) stopBotMoving(lastBot);
      lastBot = undefined;
      reset();
    },
    step: (ctx) => {
      lastBot = (ctx as AiBehaviorContext).bot;
      switch (phase) {
        case "idle":
          // 间隔等待（走停节律：不连续乱走）；静止时偶尔转身/扭头（节流）
          if (++lookTick % config.lookAroundInterval === 0) lookAround(lastBot, config);
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
            failStreak = 0;
            logStroll(ctx.botName, "到达，休息片刻");
            phase = "rest";
            wait = randomBetween(config.restMin, config.restMax);
          } else {
            // 导航失败（无路径/卡住/超时）：快速重试——短等待后重新选点，
            // 不进入长休息（避免"站半天"）；日志降频（连续失败只打首条）
            failStreak++;
            if (failStreak === 1) logStroll(ctx.botName, `导航失败(${runResult})，快速重试`);
            phase = "idle";
            wait = config.failRetry;
          }
          break;
        case "rest":
          // 休息时偶尔转身/扭头（官方随机视角意向；节流不频繁）
          if (++lookTick % config.lookAroundInterval === 0) lookAround(lastBot, config);
          if (--wait > 0) return;
          phase = "idle";
          wait = randomBetween(config.intervalMin, config.intervalMax);
          break;
      }
    },
  };
}

/** 游走状态日志（状态切换时打印——节流不刷屏；仓库约定统一 console.warn） */
function logStroll(botName: string, msg: string): void {
  console.warn(`[MockPlayer] 生物AI ${botName} 随机游走: ${msg}`);
}
