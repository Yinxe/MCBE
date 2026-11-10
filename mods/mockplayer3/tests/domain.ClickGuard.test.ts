// ─── 误点拦截 domain 纯逻辑单测：方块分档 / 无条件判定 / 有意交互许可窗 ──
// 锁：真人不在本层（桥已过滤）；命中名单一律拦、许可窗内一律放行；许可窗是计时窗而非
// 一次性令牌：一次按住期间引擎逐 tick 重复事件，取走即失效会拦下第二拍。
import test from "node:test";
import assert from "node:assert/strict";

import {
  CLICK_GUARD_BLOCKED_BLOCKS,
  CLICK_PERMIT_TTL_TICKS,
  ClickPermits,
  isClickGuardBlockedBlock,
  judgeBlockClick,
} from "../scripts/domain/ClickGuard";

// ─── 方块分档 ──

test("isClickGuardBlockedBlock：容器必在名单内（箱子/发射器/投掷器）", () => {
  for (const id of ["minecraft:chest", "minecraft:dispenser", "minecraft:dropper"]) {
    assert.equal(CLICK_GUARD_BLOCKED_BLOCKS.has(id), true, `${id} 应属拦截名单`);
    assert.equal(isClickGuardBlockedBlock(id), true);
  }
});

test("isClickGuardBlockedBlock：宝库不入名单（只在宝库模式有意开箱，路过误点也不该被自家闸挡）", () => {
  assert.equal(CLICK_GUARD_BLOCKED_BLOCKS.has("minecraft:vault"), false, "宝库不属拦截名单");
  assert.equal(isClickGuardBlockedBlock("minecraft:vault"), false);
});

test("isClickGuardBlockedBlock：染色/氧化变体由后缀规则兜下，不靠逐色枚举", () => {
  for (const id of [
    "minecraft:red_shulker_box",
    "minecraft:undyed_shulker_box",
    "minecraft:waxed_oxidized_copper_chest",
    "minecraft:exposed_copper_chest",
  ]) {
    assert.equal(isClickGuardBlockedBlock(id), true, `${id} 应随后缀入列`);
  }
});

test("isClickGuardBlockedBlock：门/按钮/拉杆/活板门与 ordinary 方块一律不入列", () => {
  for (const id of [
    "minecraft:oak_door",
    "minecraft:stone_button",
    "minecraft:lever",
    "minecraft:iron_trapdoor",
    "minecraft:stone",
    "minecraft:air",
    "",
  ]) {
    assert.equal(isClickGuardBlockedBlock(id), false, `${id} 不该被拦`);
  }
});

// ─── 判定矩阵 ──

test("judgeBlockClick：命中名单即拦（容器），宝库不在名单故无许可也放行", () => {
  assert.equal(judgeBlockClick("minecraft:chest", false), true);
  assert.equal(judgeBlockClick("minecraft:furnace", false), true);
  assert.equal(judgeBlockClick("minecraft:vault", false), false, "宝库不入名单");
});

test("judgeBlockClick：名单外一律放行", () => {
  for (const id of ["minecraft:stone", "minecraft:lever", "minecraft:oak_door"]) {
    assert.equal(judgeBlockClick(id, false), false, `${id} 不在名单内必须放行`);
  }
});

test("judgeBlockClick：许可窗内有意的开箱照样成功", () => {
  assert.equal(judgeBlockClick("minecraft:chest", true), false);
});

// ─── 交互许可记录 ──

test("ClickPermits：窗内每一拍都放行（连发不自拦），过窗即失效", () => {
  const permits = new ClickPermits();
  permits.grant(1, 100);
  for (let tick = 100; tick <= 100 + CLICK_PERMIT_TTL_TICKS; tick++) {
    assert.equal(permits.permitted(1, tick), true, `第 ${tick} 拍应在窗内`);
  }
  assert.equal(permits.permitted(1, 100 + CLICK_PERMIT_TTL_TICKS + 1), false);
});

test("ClickPermits：按 botId 记账不串账，重新发放续窗", () => {
  const permits = new ClickPermits();
  permits.grant(1, 50);
  assert.equal(permits.permitted(2, 50), false, "别的假人不受此许可影响");
  assert.equal(permits.permitted(1, 52), true);
  permits.grant(1, 60);
  assert.equal(permits.permitted(1, 62), true, "续发即续窗");
  assert.equal(permits.permitted(1, 40), false, "时光倒流的查询不作数");
});

test("ClickPermits：forget 清账（下线/删假人不留旧窗）", () => {
  const permits = new ClickPermits();
  permits.grant(7, 10);
  permits.forget(7);
  assert.equal(permits.permitted(7, 10), false);
});
