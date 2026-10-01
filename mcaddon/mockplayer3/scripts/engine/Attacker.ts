// ─── 攻击原子（单次近战挥击的发起与结果回报） ────────────────────────
// bot.attack() 为引擎 melee 挥击，命中归属（准星/扫击范围/敌我）全在引擎侧。
// attack() 同步瞬时：返回 false=引擎冷却未起挥（无伤害语义），抛穿=实体瞬态。

import { botOf, botValid } from "./Atomic";

/** 挥击结果（offline=实体不可用/抛穿，调用方低频重试） */
export type SwingResult = "fired" | "idle" | "offline";

export class Attacker {
  /** 发起一次近战挥击（不选目标、不回读确认——定点机械语义） */
  swing(botId: number): SwingResult {
    const bot = botOf(botId);
    if (!bot || !botValid(bot)) return "offline";
    try {
      return bot.attack() ? "fired" : "idle";
    } catch {
      return "offline"; // 抛穿按实体瞬态处理
    }
  }
}

/** 进程级单例 */
export const attacker = new Attacker();
