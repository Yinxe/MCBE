// ─── 游走原子（随机路线 + 平滑转身） ────────────────────────────────
// 路线生成后逐点做可站立地面修正（getBlock 世界查询）→ 依次 navigate
// （够不着 too_far 直接拒绝并中止本次路线）。选点只用稳定方块筛选，行走目标值不参与。
// 分步平滑转身（F-18：GameTest 无转速 API）：瞬移转头拆成每 stepTicks tick
// 转 ≤stepDeg° 的有界排程链，clock.after 自驱动、不走能力主循环；
// 静止时偶尔扭头共用同一段实现。永不 reject：一切异常归 NavOutcome。
// 选点/路线纯逻辑在 domain/Stroll，本层只补世界观测与执行。

import type { SimulatedPlayer } from "@minecraft/server-gametest";
import type { Vec3 } from "../domain/Coords";
import type { CancelToken } from "../domain/Cancellation";
import type { NavOutcome } from "../domain/NavRules";
import { STROLL_MAX_RAISE, generateStrollRoute, isStableBlockType, normalizeDeg } from "../domain/Stroll";
import { clock } from "./Clock";
import { botOf, botValid } from "./Atomic";
import { mover } from "./Mover";

/** 进行中的分步转身链（botId → 当前/剩余角；防重叠 + stop 中止） */
interface TurnState {
  current: number;
  remaining: number;
}

/** 路线地面修正入参（透传 domain 路线生成） */
export interface RouteRequest {
  radius: number;
  minDist: number;
  pointMin: number;
  pointMax: number;
  speed: number;
}

export class StrollOps {
  private readonly turns = new Map<number, TurnState>();

  /**
   * 一次随机游走路线（PICK 相位发起的单协程）：生成路线 → 逐点地面修正
   * （丢弃修正失败的点，保证终点真实可站立）→ 依次 navigate。
   * 生成 0 点 = 保持不动（直接 arrived）；有生成但全修正失败 = no_path。
   * 永不 reject（异常归 error）。
   */
  async runRoute(botId: number, req: RouteRequest, token?: CancelToken): Promise<NavOutcome> {
    try {
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) return "unavailable";
      let yaw = 0;
      try {
        yaw = bot.getRotation().y;
      } catch {
        /* 读不到朝向：按 0 生成（路线仍能走，只是不带朝向偏置） */
      }
      const route = generateStrollRoute({ x: bot.location.x, y: bot.location.y, z: bot.location.z }, yaw, {
        radius: req.radius,
        minDist: req.minDist,
        pointMin: req.pointMin,
        pointMax: req.pointMax,
      });
      if (route.length === 0) return "arrived"; // 本次保持不动 → 走休息
      const standable: Vec3[] = [];
      for (const p of route) {
        const fixed = this.resolveStandable(bot, p);
        if (fixed) standable.push(fixed);
      }
      if (standable.length === 0) return "no_path"; // 有生成但全修正失败 → 快速重试
      for (const point of standable) {
        const r = await mover.navigate(botId, point, { speed: req.speed, token });
        if (r !== "arrived") return r; // 任一点失败（含 >16 格 too_far 直接拒绝）→ 本次路线中止
      }
      return "arrived";
    } catch {
      return "error";
    }
  }

  /**
   * 分步平滑转身（首步立即执行，步间 clock.after 自驱动，总步数≤360/stepDeg）。
   * 同一时刻只转一次（turns 存在即跳过）；实体失效/转向抛穿 → 链自然中止
   * （剩余角放弃，下次重新分步）。仅静止时调用（能力保证）。
   */
  turnSmoothly(botId: number, targetYawDeg: number, stepDeg: number, stepTicks: number): void {
    if (this.turns.has(botId)) return;
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    let current = targetYawDeg; // 读不到当前朝向的兜底：直接到位
    try {
      current = bot.getRotation().y;
    } catch {
      /* 兜底单步转完 */
    }
    const remaining = normalizeDeg(targetYawDeg - current);
    if (Math.abs(remaining) < 1) return;
    this.turns.set(botId, { current, remaining });
    this.applyTurnStep(botId, stepDeg, stepTicks);
  }

  /** 中止转身链（能力 stop/切换；剩余步由链首 turns 缺失自然终止） */
  cancelTurn(botId: number): void {
    this.turns.delete(botId);
  }

  // ─── 私有 ──

  private applyTurnStep(botId: number, stepDeg: number, stepTicks: number): void {
    const st = this.turns.get(botId);
    if (!st) return;
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) {
      this.turns.delete(botId);
      return;
    }
    const d = Math.sign(st.remaining) * Math.min(Math.abs(st.remaining), stepDeg);
    if (Math.abs(d) >= 1) {
      let pitch = 0;
      try {
        pitch = bot.getRotation().x;
      } catch {
        /* 俯仰读不到按 0 */
      }
      st.current += d;
      st.remaining -= d;
      try {
        bot.teleport(bot.location, { rotation: { x: pitch, y: st.current } });
      } catch {
        this.turns.delete(botId); // 转向瞬态失效 → 链中止
        return;
      }
    }
    if (Math.abs(st.remaining) < 1) {
      this.turns.delete(botId);
      return;
    }
    clock.after(stepTicks, () => this.applyTurnStep(botId, stepDeg, stepTicks));
  }

  /**
   * 可站立地面修正：从当前地面层起向上找"非固体+下方稳定方块+非水"——
   * 终点保证站在真实地面（消除随机高度偏移产生的悬空 no-path）。
   * 修正后为水/超修正上限/区块越界 → undefined。
   */
  private resolveStandable(bot: SimulatedPlayer, candidate: Vec3): Vec3 | undefined {
    const x = Math.floor(candidate.x);
    const z = Math.floor(candidate.z);
    const baseY = Math.floor(bot.location.y);
    let y = baseY;
    try {
      const dim = bot.dimension;
      while (y - baseY <= STROLL_MAX_RAISE) {
        const head = dim.getBlock({ x, y, z });
        if (!head) return undefined;
        if (!head.isAir && head.typeId !== "minecraft:cave_air") {
          if (head.isLiquid) return undefined; // 液体目标无效
          y++;
          continue; // 固体：向上修正
        }
        // 非固体：确认下方稳定方块（可站立），否则继续向上（悬空）
        const below = dim.getBlock({ x, y: y - 1, z });
        if (below && !below.isAir && !below.isLiquid && isStableBlockType(below.typeId)) {
          return { x: x + 0.5, y, z: z + 0.5 };
        }
        y++;
      }
      return undefined; // 超修正上限
    } catch {
      return undefined; // 区块未加载/越界
    }
  }
}

/** 进程级单例 */
export const strollOps = new StrollOps();
