// ─── 导航原子（原生 navigateToLocation 的可控封装） ──
// 发起只负责发起，成败一律交给逐拍位置事实裁决：navigateToLocation 的 isFullPath=false 只是
// "没有直达终点的完整路径"，可移动距离内假人仍会沿残径靠近，超出可移动距离才真不动——
// 因此既不拿它判失败，也不因它 stopMoving（那会把已经在走的靠近掐断）。
// 全库统一 ≤16 格普通导航：选点侧先算水平距离，够不着的目标直接拒绝、不发起导航（too_far）。
// API 选型纪律：移动只用 navigateToLocation/stopMoving/lookAtLocation，
// 不用 tryMoveToXYZ/simulateMovement/pathToBlock。
// 位置"未变"判定用三轴 !== 精确比较、绝不加容差——静止判定依赖引擎逐 tick 位置完全一致。
// 永不 reject：一切异常归 error 枚举（异步环境抛穿可能致游戏崩溃）。

import type { Vec3 } from "../domain/Coords";
import { horizontalDistance } from "../domain/Coords";
import { CancelToken } from "../domain/Cancellation";
import {
  canNavigate,
  isArrived,
  isArrivedNearby,
  isNearTrigger,
  isStuck,
  NAV_ARRIVE_XZ,
  NAV_CHECK_INTERVAL,
  NAV_MAX_DISTANCE,
  NAV_STILL_LIMIT,
  NAV_TOTAL_TIMEOUT_TICKS,
} from "../domain/NavRules";
import type { NavOutcome, WalkOutcome } from "../domain/NavRules";
import { WATER_BLOCK_IDS } from "../domain/FishingSpot";
import { clock } from "./Clock";
import { botOf, botValid, readBlockIn, sleepTicks } from "./Atomic";
import type { SimulatedPlayer } from "@minecraft/server-gametest";

/** 远距离走位的单段长度（格）：留出 16 格上限的余量 */
const FAR_LEG_DISTANCE = 12;
/** 远距离走位段数上限（约 768 格；再多按够不着收场，避免脚本把假人拖去跑长途） */
const FAR_LEG_LIMIT = 64;

/** 导航选项（回调只传纯数据——可上达 application） */
export interface NavigateOptions {
  nearby?: boolean;
  speed?: number;
  token?: CancelToken;
  /** 本段超时预算（tick，缺省 NAV_TOTAL_TIMEOUT_TICKS=600）——靠近/重试类
   *  短途导航传小值，防"仍在挪但到不了"的病态路径把整条流程拖住 */
  timeoutTicks?: number;
  /** 进入触发圈（一次） */
  onNear?: (botId: number, position: Vec3) => void;
  /** 每次位置变化（落库/事件由订阅方负责——导航绝不写记录） */
  onMoving?: (botId: number, position: Vec3, dimensionId: string) => void;
  /** 停滞发生（能力侧决策换路/求助） */
  onStuck?: (botId: number, position: Vec3, stillCount: number) => void;
}

/** 单段发起结果：实际瞄准点（判定用）或失败 */
type IssueResult = { target: Vec3 } | { failed: true };

/** 走位选项（采集贴靠类单候选走位） */
export interface WalkOptions {
  /** navigateToLocation 净速倍率（缺省 1） */
  speed?: number;
  /** 本条走位预算（tick，缺省 NAV_TOTAL_TIMEOUT_TICKS）：预算内没停下判定就按 timeout 出结论 */
  timeoutTicks?: number;
}

export class Mover {
  /** 同 bot 在途走位令牌（单飞：新发起取消旧的那条，两条导航不互相覆盖） */
  private readonly walkTokens = new Map<number, CancelToken>();

  /** 导航（≤16 格）：发起前 stopMoving 清残留 → lookAt → navigateToLocation；
   *  目标水平距离超限直接返回 too_far、不发起（选点侧应先算距离，不留够不着的目标） */
  async navigate(botId: number, target: Vec3, opts: NavigateOptions = {}): Promise<NavOutcome> {
    try {
      const start = botOf(botId);
      if (!start || !botValid(start)) return "unavailable";
      if (!canNavigate(start.location, target)) return "too_far";
      const issued = this.issue(start, { ...target }, opts.speed ?? 1, true);
      if ("failed" in issued) return "error";
      return await this.watch(botId, issued.target, opts.timeoutTicks ?? NAV_TOTAL_TIMEOUT_TICKS, opts);
    } catch {
      return "error";
    }
  }

  /**
   * 单条走位（采集贴靠类）：原生 navigateToLocation 的可控 Promise 封装。
   * 发起即认——不看 isFullPath、不 stopMoving；结论一律由 NAV_CHECK_INTERVAL 节拍的位置观测得出：
   * 停下且水平距目标 ≤ NAV_ARRIVE_XZ=arrived，停下但没到位=stuck，预算耗尽仍在挪=timeout。
   * 同一 bot 单飞：本条发起即取消在途那条（被取消者 resolve 为 cancelled，调用侧不回灌决策）。
   * @param botId - 假人句柄
   * @param target - 走位目标（贴靠类传列中心，y 由调用侧给高位常量）
   * @param opts - 净速与预算
   * @returns 走位结论（永不 reject）
   */
  async walkTo(botId: number, target: Vec3, opts: WalkOptions = {}): Promise<WalkOutcome> {
    const mine = new CancelToken();
    const prev = this.walkTokens.get(botId);
    if (prev) prev.cancel();
    this.walkTokens.set(botId, mine);
    const begin = clock.now();
    try {
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) return "entity_invalid";
      try {
        bot.navigateToLocation(target, opts.speed ?? 1);
      } catch {
        return "error";
      }
      let last: Vec3 | null = null;
      for (;;) {
        await sleepTicks(NAV_CHECK_INTERVAL, mine);
        if (mine.cancelled) return "cancelled";
        const now = this.locationOf(botId);
        if (!now) return "entity_invalid";
        const moved = last === null || now.x !== last.x || now.y !== last.y || now.z !== last.z;
        last = now;
        if (!moved) return horizontalDistance(now, target) <= NAV_ARRIVE_XZ ? "arrived" : "stuck";
        if (clock.now() - begin >= (opts.timeoutTicks ?? NAV_TOTAL_TIMEOUT_TICKS)) return "timeout";
      }
    } catch {
      return "error";
    } finally {
      if (this.walkTokens.get(botId) === mine) this.walkTokens.delete(botId);
    }
  }

  /**
   * 远距离走位：把长距离拆成若干段，逐段沿用 navigate 的位置观测结论。
   * 中间点取当下层（脚位层交引擎按列投影），终段才用目标 y；任一段未到达即原样返回。
   * @param botId - 假人句柄
   * @param target - 最终目标（脚本给定坐标）
   * @param opts - 同 navigate
   * @returns 走位结论（永不 reject）；段数用尽仍未到按 too_far 收场
   */
  async navigateFar(botId: number, target: Vec3, opts: NavigateOptions = {}): Promise<NavOutcome> {
    try {
      for (let leg = 0; leg < FAR_LEG_LIMIT; leg++) {
        const at = this.locationOf(botId);
        if (!at) return "unavailable";
        const remain = horizontalDistance(at, target);
        if (remain <= FAR_LEG_DISTANCE) return await this.navigate(botId, target, opts);
        const k = FAR_LEG_DISTANCE / remain;
        const mid = { x: at.x + (target.x - at.x) * k, y: at.y, z: at.z + (target.z - at.z) * k };
        const leg1 = await this.navigate(botId, mid, opts);
        if (leg1 !== "arrived") return leg1;
      }
      return "too_far";
    } catch {
      return "error";
    }
  }

  /**
   * 取消该 bot 在途走位（急停/换模式/接管路径用；幂等，无在途即空操作）。
   * @param botId - 假人句柄
   * @returns 无
   */
  cancelWalk(botId: number): void {
    const cur = this.walkTokens.get(botId);
    if (!cur) return;
    cur.cancel();
    this.walkTokens.delete(botId);
  }

  /** 急停（能力 stop/玩家接管路径用）：在途走位一并作废，防迟到的结论回灌决策 */
  stop(botId: number): void {
    this.cancelWalk(botId);
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    try {
      bot.stopMoving();
    } catch {
      /* 瞬态失效 */
    }
  }

  /**
   * 一次性寻路发起（跟随类每拍重发：不发 Promise、不监测，下拍以当下位置复评）。
   * 不看 isFullPath、不清残留——残径靠近是引擎正常行为，静止与否由调用侧的位置观测裁决。
   * @param botId - 假人句柄
   * @param target - 目标位置
   * @param speed - navigateToLocation 净速倍率（缺省 1）
   * @returns 无
   */
  repath(botId: number, target: Vec3, speed = 1): void {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return;
    try {
      bot.navigateToLocation(target, speed);
    } catch {
      /* 瞬态失效：下拍按当下位置重决策 */
    }
  }

  /** 当下位置（能力前提校验用；离线 null） */
  locationOf(botId: number): Vec3 | null {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return null;
    try {
      const l = bot.location;
      return { x: l.x, y: l.y, z: l.z };
    } catch {
      return null;
    }
  }

  /**
   * 当下位置 + 维度（跟随类跨维判据要即时真值——record.dimensionId
   * 是事件写穿镜像，可能滞后一拍；离线/瞬态失效 null）。
   */
  snapshotOf(botId: number): { location: Vec3; dimensionId: string } | null {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return null;
    try {
      const l = bot.location;
      return { location: { x: l.x, y: l.y, z: l.z }, dimensionId: bot.dimension.id };
    } catch {
      return null;
    }
  }

  /**
   * 脚下格是否液体（钓鱼侧"不在水中抛竿"守卫）：脚位=location（站实时恰在站位格面）；
   * 读不到/离线按 false——只是抛竿前的一次抽查校验，保守放行由点位判据兜底。
   */
  inWater(botId: number): boolean {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return false;
    try {
      const l = bot.location;
      const info = readBlockIn(bot.dimension, { x: Math.floor(l.x), y: Math.floor(l.y), z: Math.floor(l.z) });
      return info !== undefined && WATER_BLOCK_IDS.includes(info.id);
    } catch {
      return false;
    }
  }

  // ─── 私有 ──

  /** 导航发起（first=true 清上一条导航残留）：只有抛穿才算没发起，isFullPath 不参与裁决 */
  private issue(bot: SimulatedPlayer, target: Vec3, speed: number, first: boolean): IssueResult {
    if (first) {
      try {
        bot.stopMoving();
      } catch {
        /* 吞 */
      }
    }
    try {
      bot.lookAtLocation(target); // 一次性注视失败不影响移动（独立 try-catch）
    } catch {
      /* 吞 */
    }
    try {
      bot.navigateToLocation(target, speed);
      return { target };
    } catch {
      return { failed: true };
    }
  }

  /**
   * 段监测循环：10t 节拍。到达=静止 + 水平达标 + |dy|≤4
   * （nearby 走放宽半径）；停滞未达标即卡死上报。
   */
  private async watch(botId: number, target: Vec3, timeoutTicks: number, opts: NavigateOptions): Promise<NavOutcome> {
    const begin = clock.now();
    let last: Vec3 | null = null;
    let stillCount = 0;
    let nearFired = false;
    for (;;) {
      await sleepTicks(NAV_CHECK_INTERVAL, opts.token);
      if (opts.token?.cancelled) return "error";
      const bot = botOf(botId);
      if (!bot || !botValid(bot)) return "entity_invalid";
      let now: Vec3;
      try {
        const l = bot.location;
        now = { x: l.x, y: l.y, z: l.z };
      } catch {
        return "entity_invalid";
      }
      const moved = last === null || now.x !== last.x || now.y !== last.y || now.z !== last.z;
      if (moved) {
        stillCount = 0;
        try {
          opts.onMoving?.(botId, now, bot.dimension.id);
        } catch {
          /* 回调异常隔离，不影响移动主流程 */
        }
      } else {
        stillCount++;
      }
      last = now;
      const xz = horizontalDistance(now, target);
      if (!nearFired && isNearTrigger(xz)) {
        nearFired = true;
        try {
          opts.onNear?.(botId, now);
        } catch {
          /* 隔离 */
        }
      }
      const dy = Math.abs(now.y - target.y);
      if (
        opts.nearby
          ? isArrivedNearby(xz, stillCount >= NAV_STILL_LIMIT)
          : isArrived(xz, dy, stillCount >= NAV_STILL_LIMIT)
      )
        return "arrived";
      if (isStuck(xz, dy, stillCount, opts.nearby ?? false)) {
        this.reportStuck(botId, now, stillCount, opts);
        return "still_timeout";
      }
      if (clock.now() - begin >= timeoutTicks) return "timeout";
    }
  }

  private reportStuck(botId: number, now: Vec3, stillCount: number, opts: NavigateOptions): void {
    try {
      opts.onStuck?.(botId, now, stillCount);
    } catch {
      /* 隔离 */
    }
  }
}

/** 进程级单例 */
export const mover = new Mover();
