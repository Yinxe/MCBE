// ─── 随机游走任务（natural：走停节律的阶段机） ──────────
// workMode="wander"。两阶段循环：idle（待机等待，偶尔扭头）→ stroll（随机
// 路线游走；到达 → 休息回 idle；失败 → 快速重试不进长休息）。
// 自然化规格保留：分步平滑转身（不瞬移猛扭）、0~3 路径点（0=不动）、
// 朝向偏置选点。转身链状态经 ctx.data 传递（不藏闭包）。

import { system } from "@minecraft/server";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

import { resolveBotPlayer } from "../../../bot/PlayerGateway";
import { NavigateResult, randomStrollRouteOnce } from "../../basic/move";
import { defineLoopTask } from "./spec";

// ─── 节律配置（tick；原引擎周期 × 10） ─────────────────

/** 待机间隔（tick，走停节律） */
const INTERVAL_MIN_TICKS = 30;
const INTERVAL_MAX_TICKS = 80;
/** 到达后休息时长（tick） */
const REST_MIN_TICKS = 20;
const REST_MAX_TICKS = 50;
/** 失败快速重试等待（tick，不进入长休息） */
const FAIL_RETRY_TICKS = 10;
/** 游走总范围（格圆）与最近距离 */
const RADIUS = 16;
const MIN_DIST = 3;
/** 路线点数范围（0 = 本次保持不动） */
const ROUTE_POINTS_MIN = 0;
const ROUTE_POINTS_MAX = 3;
/** 游走速度 */
const SPEED = 0.6;
/** 扭头节流：每 LOOK_EVERY_CHUNKS 个 LOOK_CHUNK_TICKS 片段扭一次 */
const LOOK_CHUNK_TICKS = 10;
const LOOK_EVERY_CHUNKS = 8;
/** 扭头看向距离（分步转身用） */
const LOOK_DISTANCE = 5;
/** 小幅扭动概率 / 幅度；大幅转头为剩余概率 */
const LOOK_SMALL_CHANCE = 0.7;
const LOOK_SMALL_SPREAD = 25;
/** 分步转身：每步最大角度 / 步间隔（tick） */
const LOOK_TURN_STEP_DEG = 20;
const LOOK_TURN_STEP_TICKS = 3;

// ─── 转身/扭头（自然化） ───────────────────────────────

/** 区间随机整数（含端点） */
function randomBetween(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 角度规范化到 (-180, 180]（转身走最短弧） */
function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * 分步平滑转身：把瞬移式 lookAtLocation 拆成"每 LOOK_TURN_STEP_TICKS tick 转
 * ≤ LOOK_TURN_STEP_DEG°"的**有界排程链**——分步逼近真实生物的缓缓转头。
 * 同一时期只转一次（turning 标志防重叠）；实体失效/转向失败 → 链中止。
 */
function startTurnSmoothly(bot: SimulatedPlayer, targetYawDeg: number, turning: { active: boolean }): void {
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
    const d = Math.sign(remaining) * Math.min(Math.abs(remaining), LOOK_TURN_STEP_DEG);
    if (Math.abs(d) < 1) return;
    const rad = ((current + d) * Math.PI) / 180;
    try {
      bot.lookAtLocation({
        x: bot.location.x + -Math.sin(rad) * LOOK_DISTANCE,
        y: bot.location.y,
        z: bot.location.z + Math.cos(rad) * LOOK_DISTANCE,
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
    }, LOOK_TURN_STEP_TICKS);
  };

  applyStep();
  if (Math.abs(remaining) < 1) turning.active = false;
}

/**
 * 偶尔扭头（官方随机视角转向意向，自然化）：大部分时候小幅扭动
 * （±LOOK_SMALL_SPREAD°），小概率大幅随机转头（东张西望感）；
 * 转头经 startTurnSmoothly 分步平滑。
 */
function lookAround(bot: SimulatedPlayer | undefined, turning: { active: boolean }): void {
  if (!bot) return;
  let targetYaw: number;
  if (Math.random() < LOOK_SMALL_CHANCE) {
    let base = 0;
    try {
      base = bot.getRotation().y;
    } catch {
      /* 读取失败按 0 */
    }
    targetYaw = base + (Math.random() * 2 - 1) * LOOK_SMALL_SPREAD;
  } else {
    targetYaw = Math.random() * 360;
  }
  startTurnSmoothly(bot, targetYaw, turning);
}

// ─── 任务定义 ──────────────────────────────────────────

/** 游走任务共享状态（转身链防重叠标志 + 扭头节流计数跨阶段保持） */
interface WanderData {
  /** 分步转身进行中标志（防重叠） */
  turning: { active: boolean };
  /** 扭头节流计数 */
  lookCounter: { n: number };
}

/**
 * 可打断待机：分片段等待，片段间做扭头节流（静止时的自然感）。
 * @param ticks 总等待时长（tick）
 */
async function idleWait(ctx: { botName: string; wait(ticks: number): Promise<void> }, ticks: number, data: WanderData): Promise<void> {
  let remaining = ticks;
  while (remaining > 0) {
    if (++data.lookCounter.n % LOOK_EVERY_CHUNKS === 0) {
      lookAround(resolveBotPlayer(ctx.botName), data.turning);
    }
    const chunk = Math.min(LOOK_CHUNK_TICKS, remaining);
    await ctx.wait(chunk);
    remaining -= chunk;
  }
}

/** 随机游走（自然流程循环）任务 */
export const wanderTask = defineLoopTask<WanderData>({
  workMode: "wander",
  kind: "natural",
  label: "随机游走",
  createData: () => ({ turning: { active: false }, lookCounter: { n: 0 } }),
  initial: "idle",
  phases: {
    idle: {
      label: "待机",
      run: async (ctx) => {
        // 待机间隔（走停节律：不连续乱走），待机时偶尔扭头
        await idleWait(ctx, randomBetween(INTERVAL_MIN_TICKS, INTERVAL_MAX_TICKS), ctx.data);
        return "stroll";
      },
    },
    stroll: {
      label: "游走",
      run: async (ctx) => {
        // 随机路线游走（0~3 路径点，总范围 16 格圆内；0 个点 = 保持不动）
        const result = await randomStrollRouteOnce(ctx.botName, {
          radius: RADIUS,
          minDist: MIN_DIST,
          pointMin: ROUTE_POINTS_MIN,
          pointMax: ROUTE_POINTS_MAX,
          speed: SPEED,
        });
        if (result === NavigateResult.Arrived) {
          // 到达（含 0 点保持不动）：休息（走停节律，休息时偶尔扭头）
          await idleWait(ctx, randomBetween(REST_MIN_TICKS, REST_MAX_TICKS), ctx.data);
          return "idle";
        }
        // 导航失败（无路径/卡住/超时）：快速重试，不进入长休息
        await idleWait(ctx, FAIL_RETRY_TICKS, ctx.data);
        return "stroll";
      },
    },
  },
});
