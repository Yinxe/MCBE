// ─── 劫掠会话状态机测试（core/service/RaidSession） ───
// 工作流状态流转 + 兜底判定（含核心死锁回归）。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  advanceRaidSession,
  createRaidSession,
  DRINK_WAIT_TICKS,
  type RaidSession,
  type RaidWorldState,
} from "../scripts/core/service/RaidSession";
import { RAID_EXPECT_TICKS, RAID_FORCE_COOLDOWN, RAID_STUCK_TICKS } from "../scripts/core/service/RaidRules";

function state(overrides: Partial<RaidWorldState> & { now: number }): RaidWorldState {
  return {
    hasBadOmen: false,
    hasRaidOmen: false,
    hasVillageHero: false,
    hasRaiderNearby: false,
    hasBottle: true,
    ...overrides,
  };
}

test("新建会话：drinking 阶段", () => {
  const s = createRaidSession("bot1", 100);
  assert.equal(s.phase, "drinking");
  assert.equal(s.wins, 0);
});

test("drinking：出现不祥之兆 → bad-omen 阶段", () => {
  const s = createRaidSession("bot1", 100);
  const { session, action } = advanceRaidSession(s, state({ now: 110, hasBadOmen: true }));
  assert.equal(session.phase, "bad-omen");
  assert.equal(action.type, "none");
});

test("drinking：喝瓶超时无效果（事件丢失/静默失败）→ 重喝（冷却后）", () => {
  const s = createRaidSession("bot1", 100);
  // 超时但未到冷却 → none
  const early = advanceRaidSession(s, state({ now: 100 + DRINK_WAIT_TICKS + 1 }));
  assert.equal(early.action.type, "none");
  // 超时 + 冷却过 → drink
  const late = advanceRaidSession(
    { ...s, lastDrink: 100 },
    state({ now: 100 + DRINK_WAIT_TICKS + RAID_FORCE_COOLDOWN + 1 })
  );
  assert.equal(late.action.type, "drink");
  assert.equal(late.session.lastDrink, 100 + DRINK_WAIT_TICKS + RAID_FORCE_COOLDOWN + 1);
});

test("drinking：无瓶 → stop 模式", () => {
  const s = createRaidSession("bot1", 100);
  const { action } = advanceRaidSession(s, state({ now: 110, hasBottle: false }));
  assert.equal(action.type, "stop");
});

test("bad-omen：出现袭击之兆 → raiding 阶段并设定窗口", () => {
  const s: RaidSession = { ...createRaidSession("bot1", 100), phase: "bad-omen", phaseSince: 100 };
  const { session, action } = advanceRaidSession(s, state({ now: 200, hasBadOmen: true, hasRaidOmen: true }));
  assert.equal(session.phase, "raiding");
  assert.equal(session.windowUntil, 200 + RAID_EXPECT_TICKS);
  assert.equal(action.type, "none");
});

test("bad-omen：不祥之兆自然过期（袭击未触发，如不在村庄）→ 回 drinking 重喝", () => {
  const s: RaidSession = { ...createRaidSession("bot1", 100), phase: "bad-omen", phaseSince: 100, lastDrink: 100 };
  const { session, action } = advanceRaidSession(s, state({ now: 200, hasBadOmen: false }));
  assert.equal(session.phase, "drinking");
  assert.equal(action.type, "none"); // 回 drinking 等下一轮巡检 drink（冷却抑制）
});

test("bad-omen：带不祥之兆久未触发 → warn-stuck 提醒（保持等待）", () => {
  const s: RaidSession = { ...createRaidSession("bot1", 100), phase: "bad-omen", phaseSince: 100 };
  const { session, action } = advanceRaidSession(
    s,
    state({ now: 100 + RAID_STUCK_TICKS + 1, hasBadOmen: true })
  );
  assert.equal(action.type, "warn-stuck");
  assert.equal(session.phase, "bad-omen"); // 保持等待效果过期
});

test("raiding：挂着村庄英雄但事件丢失 → claim-victory 补记", () => {
  const s: RaidSession = { ...createRaidSession("bot1", 100), phase: "raiding", phaseSince: 100, windowUntil: 100 + RAID_EXPECT_TICKS };
  const { session, action } = advanceRaidSession(s, state({ now: 500, hasVillageHero: true }));
  assert.equal(action.type, "claim-victory");
  assert.equal(session.phase, "drinking"); // 胜利处理后进入下一瓶
});

test("【核心回归】raiding：窗口过期 + 无袭击者 = 袭击已结束（胜利丢失）→ 重喝（修复死锁）", () => {
  const s: RaidSession = {
    ...createRaidSession("bot1", 100),
    phase: "raiding",
    phaseSince: 100,
    windowUntil: 100 + RAID_EXPECT_TICKS,
    lastDrink: 100,
  };
  // 窗口内 + 无袭击者 → 袭击可能还在远处进行 → 等待
  const inside = advanceRaidSession(s, state({ now: 100 + RAID_EXPECT_TICKS - 1 }));
  assert.equal(inside.action.type, "none");
  // 窗口过期 + 无袭击者（袭击者已消失）→ 袭击结束 → 重喝（旧巡检在此死锁）
  const expired = advanceRaidSession(s, state({ now: 100 + RAID_EXPECT_TICKS + 1 }));
  assert.equal(expired.action.type, "drink");
  assert.equal(expired.session.phase, "drinking");
});

test("raiding：窗口过期但附近仍有袭击者 → 袭击进行中，继续等待", () => {
  const s: RaidSession = {
    ...createRaidSession("bot1", 100),
    phase: "raiding",
    phaseSince: 100,
    windowUntil: 100 + RAID_EXPECT_TICKS,
  };
  const { action } = advanceRaidSession(
    s,
    state({ now: 100 + RAID_EXPECT_TICKS + 1, hasRaiderNearby: true })
  );
  assert.equal(action.type, "none");
});

test("raiding：窗口内 → 等待（袭击正常推进）", () => {
  const s: RaidSession = {
    ...createRaidSession("bot1", 100),
    phase: "raiding",
    phaseSince: 100,
    windowUntil: 100 + RAID_EXPECT_TICKS,
  };
  const { action } = advanceRaidSession(s, state({ now: 500 }));
  assert.equal(action.type, "none");
});

test("raiding：窗口过期无袭击者但重喝冷却中 → 回 drinking 等待冷却", () => {
  const s: RaidSession = {
    ...createRaidSession("bot1", 100),
    phase: "raiding",
    phaseSince: 100,
    windowUntil: 100 + RAID_EXPECT_TICKS,
    lastDrink: 100 + RAID_EXPECT_TICKS - 1, // 冷却刚过不久
  };
  const { session, action } = advanceRaidSession(s, state({ now: 100 + RAID_EXPECT_TICKS + 1 }));
  assert.equal(action.type, "none");
  assert.equal(session.phase, "drinking"); // 已回 drinking，下轮巡检冷却过再 drink
});
