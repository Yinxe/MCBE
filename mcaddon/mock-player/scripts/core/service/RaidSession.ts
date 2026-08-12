// ─── 劫掠会话状态机（core 层纯逻辑） ────────────────
// 每个启用劫掠的在线假人持有一个 RaidSession，工作流显式状态流转：
//
//   drinking ──bad-omen──▶ bad-omen ──raid-omen──▶ raiding ──hero──▶ (胜利处理) ──▶ drinking
//      ▲                     │                        │
//      │──超时无效果重喝──────┤                        │──窗口过期+无袭击者（胜利丢失）──▶ 重喝
//      │                     │──效果自然过期──────────┤
//      └──无瓶→stop──────────┴────────────────────────┘
//
// 双驱动：
//   - 事件驱动（effectAdd）立即推进阶段（bad-omen/raid-omen/village-hero）
//   - 巡检驱动（advanceRaidSession）定期兜底：任何事件链断裂都由状态机判定
//     并产出动作（重喝/补记胜利/卡死提醒/停模式）——**不再依赖"有袭击者就不动"的
//     死锁判定**：窗口过期且无袭击者 = 袭击已结束（无论英雄是否到手）→ 恢复工作流。
// 零 @minecraft 依赖，可 node 单测。

import { RAID_EXPECT_TICKS, RAID_FORCE_COOLDOWN, RAID_STUCK_TICKS } from "./RaidRules";

/** 工作流阶段 */
export type RaidPhase = "drinking" | "bad-omen" | "raiding";

/** 劫掠会话（每假人一个，内存态） */
export interface RaidSession {
  botName: string;
  phase: RaidPhase;
  /** 进入当前阶段的 tick（阶段超时判定用） */
  phaseSince: number;
  /** 袭击预期结束 tick（raiding 阶段；bad-omen 出现时设定） */
  windowUntil: number;
  /** 上次喝瓶 tick（重喝冷却） */
  lastDrink: number;
  /** 累计胜利次数 */
  wins: number;
}

/** 巡检输入的世界状态（mc 层采集，全部 boolean/数字，可序列化） */
export interface RaidWorldState {
  now: number;
  /** 不祥之兆（喝瓶成功、袭击排队） */
  hasBadOmen: boolean;
  /** 袭击之兆（袭击即将开始） */
  hasRaidOmen: boolean;
  /** 村庄英雄（袭击胜利） */
  hasVillageHero: boolean;
  /** 附近 128 格有袭击参与生物（袭击进行中） */
  hasRaiderNearby: boolean;
  /** 背包有不祥之瓶（无瓶 → stop 模式） */
  hasBottle: boolean;
}

/** 巡检产出动作（mc 层执行副作用） */
export type RaidAction =
  | { type: "none" }
  | { type: "drink" } // 喝下一瓶/重喝
  | { type: "claim-victory" } // 补记胜利（挂着英雄但事件丢失）
  | { type: "warn-stuck" } // 卡死提醒（带不祥之兆久未触发袭击）
  | { type: "stop" }; // 无瓶 → 停模式

/** 新建会话（开模式时；idle 阶段由调用方立即喝第一瓶） */
export function createRaidSession(botName: string, now: number): RaidSession {
  return { botName, phase: "drinking", phaseSince: now, windowUntil: 0, lastDrink: now, wins: 0 };
}

/** 喝瓶等待效果的超时（tick）：喝瓶 2 秒 + 效果出现延迟，30 秒内未出现 → 判定喝瓶失败重喝 */
export const DRINK_WAIT_TICKS = 600;

/**
 * 推进状态机（纯逻辑）：输入会话 + 世界状态 → 新会话 + 动作。
 * 规则：
 *   drinking：出现 bad-omen → bad-omen；超时无效果（且冷却过）→ 重喝；无瓶 → stop
 *   bad-omen：出现 raid-omen → raiding（设定袭击窗口）；效果自然过期（袭击未触发）→ 重喝；
 *             持续超时 → warn-stuck 提醒（保持等待效果过期）
 *   raiding ：出现 village-hero → claim-victory（事件丢失兜底；事件正常时已处理）
 *             窗口过期 且 无袭击者 → 袭击已结束（无论英雄到手与否）→ 重喝（修复工作流死锁）
 */
export function advanceRaidSession(s: RaidSession, w: RaidWorldState): { session: RaidSession; action: RaidAction } {
  const session: RaidSession = { ...s };

  switch (session.phase) {
    case "drinking": {
      if (!w.hasBottle) return { session, action: { type: "stop" } };
      if (w.hasBadOmen) {
        session.phase = "bad-omen";
        session.phaseSince = w.now;
        return { session, action: { type: "none" } };
      }
      // 喝瓶后超时仍无效果 → 喝瓶静默失败/事件丢失 → 重喝（冷却抑制刷屏）
      if (w.now - session.phaseSince > DRINK_WAIT_TICKS && w.now - session.lastDrink >= RAID_FORCE_COOLDOWN) {
        session.lastDrink = w.now;
        return { session, action: { type: "drink" } };
      }
      return { session, action: { type: "none" } };
    }

    case "bad-omen": {
      if (w.hasRaidOmen) {
        session.phase = "raiding";
        session.phaseSince = w.now;
        session.windowUntil = w.now + RAID_EXPECT_TICKS;
        return { session, action: { type: "none" } };
      }
      // 不祥之兆自然过期（袭击未触发，如不在村庄/和平）→ 重喝
      if (!w.hasBadOmen) {
        if (w.now - session.lastDrink >= RAID_FORCE_COOLDOWN) {
          session.lastDrink = w.now;
        }
        session.phase = "drinking";
        session.phaseSince = w.now;
        return { session, action: { type: "none" } };
      }
      // 带不祥之兆久未触发 → 提醒玩家（一次性提示，保持等待）
      if (w.now - session.phaseSince > RAID_STUCK_TICKS) {
        return { session, action: { type: "warn-stuck" } };
      }
      return { session, action: { type: "none" } };
    }

    case "raiding": {
      // 挂着村庄英雄但胜利事件丢失 → 补记胜利（随后进入下一瓶由调用方处理）
      if (w.hasVillageHero) {
        session.phase = "drinking";
        session.phaseSince = w.now;
        return { session, action: { type: "claim-victory" } };
      }
      // 袭击预期窗口过期 且 附近无袭击者 → 袭击已结束（胜利丢失/未参与击杀）→ 重喝
      // ⚠️ 修复核心死锁：旧巡检在"窗口过期"后仍因袭击者残留而永不续瓶
      if (w.now > session.windowUntil && !w.hasRaiderNearby) {
        if (w.now - session.lastDrink >= RAID_FORCE_COOLDOWN) {
          session.lastDrink = w.now;
          session.phase = "drinking";
          session.phaseSince = w.now;
          return { session, action: { type: "drink" } };
        }
        session.phase = "drinking";
        session.phaseSince = w.now;
        return { session, action: { type: "none" } };
      }
      return { session, action: { type: "none" } };
    }
  }
}
