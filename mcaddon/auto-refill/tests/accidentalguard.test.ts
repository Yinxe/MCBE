// ─── 挖掘防误触逻辑单测（纯数据，node:test） ───────
// 覆盖 AccidentalGuard：首次信号拦截 / 窗口内同信号放行 / 越窗重置 /
// 信号多维独立性（玩家·主手·方块）/ 确认后记录清除 / 过期条目清理。

import { test } from "node:test";
import assert from "node:assert/strict";
import { AccidentalGuard, ANTI_TOUCH_WINDOW_TICKS } from "../scripts/AccidentalGuard";

const W = ANTI_TOUCH_WINDOW_TICKS; // 50 tick

test("首次同信号 → 拦截（true）；窗口内二次 → 放行（false）", () => {
  const g = new AccidentalGuard();
  assert.equal(g.shouldIntercept("p1", "minecraft:iron_pickaxe", "minecraft:stone", 100), true);
  assert.equal(g.shouldIntercept("p1", "minecraft:iron_pickaxe", "minecraft:stone", 130), false);
});

test("空手（无主手物品）也算信号：空手挖方块首次拦截、同方块空手二次放行", () => {
  const g = new AccidentalGuard();
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 100), true);
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 120), false);
});

test("不同方块 → 信号不同（各自首次拦截）", () => {
  const g = new AccidentalGuard();
  assert.equal(g.shouldIntercept("p1", "minecraft:iron_pickaxe", "minecraft:stone", 100), true);
  assert.equal(g.shouldIntercept("p1", "minecraft:iron_pickaxe", "minecraft:deepslate", 110), true);
});

test("不同主手物品 → 信号不同（空手↔持物各自首次拦截）", () => {
  const g = new AccidentalGuard();
  assert.equal(g.shouldIntercept("p1", "minecraft:iron_pickaxe", "minecraft:stone", 100), true);
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 110), true); // 换成空手 → 新信号
});

test("不同玩家 → 信号彼此独立（互不影响）", () => {
  const g = new AccidentalGuard();
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 100), true);
  assert.equal(g.shouldIntercept("p2", undefined, "minecraft:stone", 110), true);
});

test("窗口边界：恰好等于窗口 → 放行；超过窗口 → 视为新信号（拦截·重置）", () => {
  const exactly = new AccidentalGuard();
  assert.equal(exactly.shouldIntercept("p1", undefined, "minecraft:stone", 100), true);
  assert.equal(exactly.shouldIntercept("p1", undefined, "minecraft:stone", 100 + W), false); // 恰在窗口内
  const expired = new AccidentalGuard();
  assert.equal(expired.shouldIntercept("p1", undefined, "minecraft:stone", 100), true);
  assert.equal(expired.shouldIntercept("p1", undefined, "minecraft:stone", 100 + W + 1), true); // 超窗 → 重置拦截
});

test("确认放行后记录清除：下一轮相同信号重新进入首次拦截", () => {
  const g = new AccidentalGuard();
  g.shouldIntercept("p1", undefined, "minecraft:stone", 100); // 拦截
  g.shouldIntercept("p1", undefined, "minecraft:stone", 120); // 放行（记录已清）
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 140), true); // 新一轮 → 首次拦截
});

test("过期信号自动清理：旧条目不误判后续命中", () => {
  const g = new AccidentalGuard();
  g.shouldIntercept("p1", undefined, "minecraft:stone", 100); // 记录（后过期）
  // 远窗口之外的另一次命中触发 prune，p1 的旧信号被清理
  assert.equal(g.shouldIntercept("p2", "minecraft:iron_axe", "minecraft:log", 10000), true);
  // p1 旧信号已清 → 同信号再次命中视为新信号 → 拦截
  assert.equal(g.shouldIntercept("p1", undefined, "minecraft:stone", 10001), true);
});