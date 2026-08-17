// ─── 随机游走能力（新框架 scripts/ai：Behavior 状态机） ──
// 用户拍板：利用新 AI 框架实现随机游走能力——空闲时随机走走停停。
// 状态机（step 同步短步，无循环无 await——woodcut 纪律）：
//   idle（间隔计数）→ pick（选路线 + 发起单次导航协程）→ walk（轮询完成）
//   → rest（休息计数）→ idle 循环。
// **路线模式**（用户拍板 2026-08-17）：每次游走生成 1~3 个路径点
// （routePointsMin/Max），全部落在以起点为圆心、总范围 radius=16 格圆内
// （方向顺延不折返——像真实生物的散步路线），依次走完算一次游走；
// 单次路线导航协程有界（longNavigateBot 段切 + 超时/停滞判定），完成标志
// 由 step 轮询。协程防残留：reset（切换/关标签/下线）→ stopMoving 中断导航。
// ⚠️ 全部节奏/范围常量统一收敛到 WanderBehaviorConfig（配置接口 + 默认值），
//    不再散落裸常量——调参只改配置。
//
// 自然化（用户反馈 2026-08-17）：
//   - 转身**分步平滑**：瞬移式 lookAtLocation 拆成"每 lookTurnStepTicks tick
//     转 ≤ lookTurnStepDeg°"的有界排程链——像真实生物缓缓转头（GameTest 无
//     旋转速度 API，分步逼近；转不完整不影响下次转身）
//   - 转头频率减半（lookAroundInterval 8 周期 = 4 秒一次，原 2 秒）
//   - 选点最小距离 minDist=3 格：剔除"走一两步就到"的过近点（原地踱步感）

import type { Behavior, BehaviorContext } from "../../../ai";
import type { SimulatedPlayer } from "@minecraft/server-gametest";
import { system } from "@minecraft/server";
import { randomStrollRouteOnce, NavigateResult } from "../../basic/move";
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
  /** 单次游走总范围（格）：路线模式所有路径点在此半径圆内（16 = 直达上限） */
  radius: number;
  /** 单次游走最小选点距离（格）：剔除过近点（原地踱步不自然） */
  minDist: number;
  /** 路线路径点数下限（每次游走随机 1~max 个路径点，依次走完算一次散步） */
  routePointsMin: number;
  /** 路线路径点数上限 */
  routePointsMax: number;
  /** 游走速度（慢速散步） */
  speed: number;
  /** 转头节流（引擎周期 = 10 tick）：静止时偶尔扭头 */
  lookAroundInterval: number;
  /** 转头随机朝向距离（格，看向点的距离） */
  lookAroundDistance: number;
  /** 小幅扭头概率（0~1；其余为大幅随机转头） */
  lookSmallChance: number;
  /** 小幅扭头角度（±度）：当前朝向附近微调 */
  lookSmallSpread: number;
  /** 分步转身每步最大转角（度）：平滑转头——把瞬移式 lookAtLocation
   *  拆成多步小角度（每步 lookTurnStepTicks tick），像真实生物缓缓转头 */
  lookTurnStepDeg: number;
  /** 分步转身步间间隔（tick） */
  lookTurnStepTicks: number;
}

/** 默认配置（统一管理；makeWanderBehavior 可传自定义配置覆盖） */
export const DEFAULT_WANDER_CONFIG: WanderBehaviorConfig = {
  intervalMin: 3,
  intervalMax: 8,
  restMin: 2,
  restMax: 5,
  failRetry: 1,
  radius: 16,
  minDist: 3,
  routePointsMin: 1,
  routePointsMax: 3,
  speed: 0.6,
  lookAroundInterval: 8,
  lookAroundDistance: 5,
  lookSmallChance: 0.7,
  lookSmallSpread: 25,
  lookTurnStepDeg: 20,
  lookTurnStepTicks: 3,
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

/** 角度规范化到 (-180, 180]（转身走最短弧） */
function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * 分步平滑转身：把瞬移式 lookAtLocation 拆成"每 stepTicks tick 转 ≤ stepDeg°"
 * 的**有界排程链**——GameTest 无旋转速度 API，分步逼近真实生物的缓缓转头。
 * 首步立即执行（转身启动即时响应），步间间隔由排程链自驱动（不走主循环）；
 * 实体失效/转身失败 → 链中止（剩余角度放弃，下次转头重新分步）。
 * ⚠️ 同一时期只转一次（turning 标志防重叠——连续触发跳过）。
 */
function startTurnSmoothly(
  bot: SimulatedPlayer,
  targetYawDeg: number,
  cfg: WanderBehaviorConfig,
  turning: { active: boolean },
): void {
  if (turning.active) return;
  turning.active = true;

  let current = targetYawDeg; // 读不到当前朝向时的兜底（直接到位）
  try {
    current = bot.getRotation().y;
  } catch {
    /* 读取失败：按兜底——单步转完 */
  }
  let remaining = normalizeDeg(targetYawDeg - current);

  const applyStep = (): void => {
    if (!bot.isValid) return;
    // 每步转角：剩余角度的符号 × min(剩余, 每步上限)（走最短弧）
    const d = Math.sign(remaining) * Math.min(Math.abs(remaining), cfg.lookTurnStepDeg);
    if (Math.abs(d) < 1) return;
    const rad = ((current + d) * Math.PI) / 180;
    try {
      bot.lookAtLocation({
        x: bot.location.x + -Math.sin(rad) * cfg.lookAroundDistance,
        y: bot.location.y,
        z: bot.location.z + Math.cos(rad) * cfg.lookAroundDistance,
      });
    } catch {
      return; /* 看向失败（chunkload 受限等）→ 链中止 */
    }
    current += d;
    remaining -= d;
    // 余角仍有 → 排程下一步（有界：总步数 ≤ 360/stepDeg）
    system.runTimeout(() => {
      if (!bot.isValid) return;
      if (Math.abs(remaining) < 1) {
        turning.active = false;
        return;
      }
      applyStep();
      if (Math.abs(remaining) < 1) turning.active = false;
    }, cfg.lookTurnStepTicks);
  };

  applyStep();
  if (Math.abs(remaining) < 1) turning.active = false;
}

/**
 * 偶尔扭头（官方随机视角转向意向，自然化）：
 * 大部分时候（70%）在当前朝向基础上**小幅扭动**（±25°——"扭一下头"），
 * 小概率（30%）才大幅随机转头（东张西望感）；转头经 startTurnSmoothly
 * **分步平滑**（不再瞬移猛扭）。转身后实体朝向变化，下次游走的朝向偏置
 * 选点自然偏向该方向。
 */
function lookAround(bot: SimulatedPlayer | undefined, cfg: WanderBehaviorConfig, turning: { active: boolean }): void {
  if (!bot) return;
  let targetYaw: number;
  if (Math.random() < cfg.lookSmallChance) {
    // 小幅扭动：当前朝向 ±spread（"扭一下头"）
    let base = 0;
    try {
      base = bot.getRotation().y;
    } catch {
      /* 读取失败按 0 */
    }
    targetYaw = base + (Math.random() * 2 - 1) * cfg.lookSmallSpread;
  } else {
    // 小概率大幅转头（自然东张西望）
    targetYaw = Math.random() * 360;
  }
  startTurnSmoothly(bot, targetYaw, cfg, turning);
}

/** 创建随机游走行为（默认配置见 DEFAULT_WANDER_CONFIG；可传自定义配置覆盖） */
export function makeWanderBehavior(config: WanderBehaviorConfig = DEFAULT_WANDER_CONFIG): Behavior {
  let phase: Phase = "idle";
  let wait = randomBetween(config.intervalMin, config.intervalMax); // 当前阶段剩余周期
  let run: Promise<unknown> | undefined; // 单次导航协程
  let runResult: NavigateResult | undefined; // 协程完成标志
  let lookTick = 0; // 转头节流计数
  let failStreak = 0; // 连续失败计数（日志降频）
  const turning = { active: false }; // 分步转身进行中标志（防重叠）
  // ⚠️ reset 无参（Behavior.reset 签名）——用最近 step 的实体引用中断移动；
  // 必须放闭包内（每假人一实例），放模块级会跨假人共享误停他 bot（审核 M1）
  let lastBot: SimulatedPlayer | undefined;

  const startRun = (botName: string): void => {
    runResult = undefined;
    run = randomStrollRouteOnce(botName, {
      radius: config.radius,
      minDist: config.minDist,
      pointMin: config.routePointsMin,
      pointMax: config.routePointsMax,
      speed: config.speed,
    })
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
      return ctx.memory.get<string>("workMode") === "wander";
    },
    onActivate: (ctx) => stopBotMoving((ctx as AiBehaviorContext).bot),
    reset: () => {
      // 中断进行中导航 + 清状态（reset 无 ctx——用最近推进的实体引用）
      if (lastBot) stopBotMoving(lastBot);
      lastBot = undefined;
      turning.active = false; // 中止分步转身链（剩余步由实体有效性判定自然终止）
      reset();
    },
    step: (ctx) => {
      lastBot = (ctx as AiBehaviorContext).bot;
      switch (phase) {
        case "idle":
          // 间隔等待（走停节律：不连续乱走）；静止时偶尔转身/扭头（节流）
          if (++lookTick % config.lookAroundInterval === 0) lookAround(lastBot, config, turning);
          if (--wait > 0) return;
          phase = "pick";
          break;
        case "pick":
          // 生成路线（1~3 路径点，总范围 16 格圆内；朝向偏置/顺延不折返）+
          // 发起单次路线导航协程
          logStroll(ctx.botName, "出发（生成路线+移动）");
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
          if (++lookTick % config.lookAroundInterval === 0) lookAround(lastBot, config, turning);
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