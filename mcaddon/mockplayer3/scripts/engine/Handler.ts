// ─── 交互原子（interact 发起 + 容器分流） ────────────────────────────
// F-12：interact() 重复调用间隔 <4t 直接 busy（开箱动画被打断、按键丢失都由过密的
// 重复触发引起），本层强制节流。
// 容器目标（带 minecraft:inventory 组件的方块）一律不发右键——分流返回 container，
// 能力层转 ContainerOps 组件直读写（F-12/F-13：右键开箱 lid 动画 IsOpened 不复位）。
// 瞄准失败不拦截，由 interact 自身判定结果。

import type { Vec3 } from "../domain/Coords";
import { blockFloor } from "./Atomic";
import { botOf, botValid, dimensionOf } from "./Atomic";
import { botClickGuard } from "./ClickGuard";
import { clock } from "./Clock";

export type HandleResult = "interacted" | "busy" | "container" | "offline" | "no-target" | "failed";

/** interact 最小间隔（tick，F-12） */
const INTERACT_MIN_INTERVAL_TICKS = 4;

export class Handler {
  private readonly lastInteract = new Map<number, number>();

  /**
   * 对目标格发起一次交互（先判容器分流）。
   * @param loc - 方块整数格坐标（内部 floor 兜底）
   */
  interactAt(botId: number, dimId: string, loc: Vec3): HandleResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const dim = dimensionOf(dimId);
    if (!dim) return "no-target";
    const cell = blockFloor(loc);
    let block;
    try {
      block = dim.getBlock({ x: cell.x, y: cell.y, z: cell.z });
    } catch {
      return "no-target"; // 区块未加载等瞬态
    }
    if (!block) return "no-target";
    try {
      if (block.getComponent("minecraft:inventory")) return "container"; // 分流：右键永不发
    } catch {
      /* 组件探测失败按非容器继续（门/按钮本就无该组件） */
    }
    const now = clock.now();
    const last = this.lastInteract.get(botId);
    if (last !== undefined && now - last < INTERACT_MIN_INTERVAL_TICKS) return "busy";
    try {
      bot.lookAtBlock(block); // 失败/不可瞄不拦截（interact 自身判定结果）
    } catch {
      /* 瞄准失败静默，不拦截 */
    }
    this.lastInteract.set(botId, now);
    try {
      botClickGuard.grant(botId); // 有意交互，许可期内不误拦
      return bot.interact() ? "interacted" : "failed";
    } catch {
      return "failed";
    }
  }

  /**
   * 当前头部射线一次交互：不读目标、不缓存，由引擎判定射线上第一个方块/实体。
   * @param botId 假人句柄
   * @returns 交互结果；同样受 ≥4t 节流（F-12）
   */
  interactSight(botId: number): HandleResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    const now = clock.now();
    const last = this.lastInteract.get(botId);
    if (last !== undefined && now - last < INTERACT_MIN_INTERVAL_TICKS) return "busy";
    this.lastInteract.set(botId, now);
    try {
      botClickGuard.grant(botId); // 面板"前方交互"是玩家手动发起，视为有意
      return bot.interact() ? "interacted" : "failed";
    } catch {
      return "failed";
    }
  }

  /** 会话销毁时清除该 botId 的节流记录，避免 id 复用串到新会话 */
  forget(botId: number): void {
    this.lastInteract.delete(botId);
  }
}

/** 进程级单例 */
export const handler = new Handler();
