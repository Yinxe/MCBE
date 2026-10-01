// ─── core/rules — 共享钓鱼点池（FishingPool） ──────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  claimSpot,
  countUsable,
  isSpotUsableFor,
  markFailSpot,
  mergeScanned,
  passesSpotConstraints,
  pickBestSpot,
  releaseSpot,
  resetFailSpot,
  spotKey,
  SPOT_MAX_DISTANCE,
  SPOT_MAX_FAIL_STRIKES,
  type PoolSpot,
} from "../scripts/rules/FishingPool";
import type { FishingSpot } from "../scripts/rules/FishingRules";

/** 构造一个池条目 */
function makeSpot(key: string, overrides: Partial<PoolSpot> = {}): PoolSpot {
  return {
    key,
    dimension: "minecraft:overworld",
    stand: { x: 10, y: 64, z: 10 },
    support: { x: 10, y: 63, z: 10 },
    waters: [{ x: 11, y: 64, z: 10 }],
    aim: { target: { x: 12, y: 64, z: 10 }, level: 3 },
    status: "free",
    failCount: 0,
    ...overrides,
  };
}

test("spotKey：维度内定位键（取整）", () => {
  assert.equal(spotKey("minecraft:overworld", { x: 10.9, y: 64.2, z: -3.1 }), "minecraft:overworld@10,64,-4");
});

test("mergeScanned：去重保留已有状态/占用/失败计数，新点按 free 加入", () => {
  const existing = [
    makeSpot("minecraft:overworld@10,64,10", { status: "occupied", claimant: "$A", failCount: 2 }),
  ];
  const scanned: FishingSpot[] = [
    {
      stand: { x: 10, y: 64, z: 10 }, // 已存在 → 不覆盖
      support: { x: 10, y: 63, z: 10 },
      waters: [{ x: 11, y: 64, z: 10 }],
      aim: { target: { x: 12, y: 64, z: 10 }, level: 3 },
    },
    {
      stand: { x: 20, y: 64, z: 20 }, // 新点 → free
      support: { x: 20, y: 63, z: 20 },
      waters: [{ x: 21, y: 64, z: 20 }],
      aim: { target: { x: 22, y: 64, z: 20 }, level: 5 },
    },
  ];
  const merged = mergeScanned(existing, scanned, "minecraft:overworld");
  assert.equal(merged.length, 2);
  const kept = merged.find((s) => s.key === "minecraft:overworld@10,64,10");
  assert.equal(kept?.status, "occupied");
  assert.equal(kept?.claimant, "$A");
  assert.equal(kept?.failCount, 2);
  const added = merged.find((s) => s.key === "minecraft:overworld@20,64,20");
  assert.equal(added?.status, "free");
  assert.equal(added?.failCount, 0);
});

test("isSpotUsableFor：不可用排除 / 独占归属 / 维度不符", () => {
  const free = makeSpot("k1");
  const occupiedByA = makeSpot("k2", { status: "occupied", claimant: "$A" });
  const unavailable = makeSpot("k3", { status: "unavailable" });
  assert.equal(isSpotUsableFor(free, "$B"), true);
  assert.equal(isSpotUsableFor(occupiedByA, "$A"), true); // 假人可用自己独占的点
  assert.equal(isSpotUsableFor(occupiedByA, "$B"), false); // 其他假人不可用
  assert.equal(isSpotUsableFor(unavailable, "$A"), false);
  // 维度过滤
  assert.equal(isSpotUsableFor(free, "$B", "minecraft:nether"), false);
  assert.equal(isSpotUsableFor(free, "$B", "minecraft:overworld"), true);
});

test("countUsable / pickBestSpot：排除不可用与独占归属，星级降序 + 距离升序", () => {
  const spots = [
    makeSpot("k1", { stand: { x: 0, y: 64, z: 0 }, aim: { target: { x: 1, y: 64, z: 0 }, level: 3 } }),
    makeSpot("k2", { stand: { x: 5, y: 64, z: 0 }, aim: { target: { x: 6, y: 64, z: 0 }, level: 5 } }), // 高星但远
    makeSpot("k3", { stand: { x: 2, y: 64, z: 0 }, aim: { target: { x: 3, y: 64, z: 0 }, level: 5 } }), // 高星且近 → 最佳
    makeSpot("k4", { status: "occupied", claimant: "$A", stand: { x: 1, y: 64, z: 0 }, aim: { target: { x: 2, y: 64, z: 0 }, level: 5 } }), // 他人独占 → 排除
    makeSpot("k5", { status: "unavailable", stand: { x: 3, y: 64, z: 0 }, aim: { target: { x: 4, y: 64, z: 0 }, level: 5 } }),
  ];
  assert.equal(countUsable(spots, "$B"), 3); // k1/k2/k3
  const best = pickBestSpot(spots, "$B", { x: 0, y: 64, z: 0 });
  assert.equal(best?.key, "k3"); // 星级 5 + 距离更近优先（k4 他人独占、k5 不可用被排除）
  // $A 自己的独占点 k4（5 星且最近）也入选——假人可用自己独占的点
  const bestForA = pickBestSpot(spots, "$A", { x: 0, y: 64, z: 0 });
  assert.equal(bestForA?.key, "k4");
});

test("claimSpot / releaseSpot：占用标记与释放回 free（失败达上限不复活）", () => {
  let spots = [makeSpot("k1"), makeSpot("k2", { failCount: SPOT_MAX_FAIL_STRIKES })];
  spots = claimSpot(spots, "k1", "$B");
  assert.equal(spots[0]!.status, "occupied");
  assert.equal(spots[0]!.claimant, "$B");
  // 释放未达失败上限 → 回 free
  spots = releaseSpot(spots, "k1");
  assert.equal(spots[0]!.status, "free");
  assert.equal(spots[0]!.claimant, undefined);
  // 失败已达上限的点释放 → 保持 unavailable
  const releasedUnavail = releaseSpot(spots, "k2");
  assert.equal(releasedUnavail.find((s) => s.key === "k2")?.status, "unavailable");
});

test("markFailSpot：连续失败达 3 次 → 标记不可用并共享", () => {
  let spots = [makeSpot("k1")];
  const r1 = markFailSpot(spots, "k1");
  assert.equal(r1.failCount, 1);
  assert.equal(r1.unavailable, false);
  assert.equal(r1.spots[0]!.status, "occupied"); // 未达上限保持占用（继续尝试）
  const r2 = markFailSpot(r1.spots, "k1");
  assert.equal(r2.failCount, 2);
  const r3 = markFailSpot(r2.spots, "k1");
  assert.equal(r3.failCount, SPOT_MAX_FAIL_STRIKES);
  assert.equal(r3.unavailable, true);
  assert.equal(r3.spots[0]!.status, "unavailable");
  assert.equal(isSpotUsableFor(r3.spots[0]!, "$A"), false);
});

test("resetFailSpot：钓到鱼清零失败计数（保持占用）", () => {
  let spots = [makeSpot("k1", { status: "occupied", claimant: "$A", failCount: 2 })];
  spots = resetFailSpot(spots, "k1");
  assert.equal(spots[0]!.failCount, 0);
  assert.equal(spots[0]!.status, "occupied"); // 仍占用
  assert.equal(spots[0]!.claimant, "$A");
});

test("passesSpotConstraints：距离约束（只选自身 16 格内）+ 现场有效性回调", () => {
  const spot = makeSpot("k1", { stand: { x: 18, y: 64, z: 0 } }); // 距中心 18 格
  // 缺省 maxDistance = SPOT_MAX_DISTANCE(16)：超出 → 不过
  assert.equal(passesSpotConstraints(spot, { center: { x: 0, y: 64, z: 0 } }), false);
  // 显式放宽 maxDistance → 通过（18 ≤ 20）
  assert.equal(passesSpotConstraints(spot, { center: { x: 0, y: 64, z: 0 }, maxDistance: 20 }), true);
  // 现场有效性回调：实体占用 → 不过
  const center = { x: 0, y: 64, z: 0 };
  assert.equal(passesSpotConstraints(spot, { center, maxDistance: 20, isValid: () => false }), false);
  assert.equal(passesSpotConstraints(spot, { center, maxDistance: 20, isValid: () => true }), true);
  // 边界：恰等于 16 算有效（≤）
  const edge = makeSpot("k2", { stand: { x: 16, y: 64, z: 0 } });
  assert.equal(passesSpotConstraints(edge, { center: { x: 0, y: 64, z: 0 } }), true);
});

test("countUsable：只统计自身 maxDistance 内 + 现场无实体的有效点", () => {
  const center = { x: 0, y: 64, z: 0 };
  const spots = [
    makeSpot("near", { stand: { x: 5, y: 64, z: 0 } }), // 16 内
    makeSpot("far", { stand: { x: 30, y: 64, z: 0 } }), // 超 16 → 排除
    makeSpot("occupied", { stand: { x: 3, y: 64, z: 0 } }), // 现场被实体占用 → isValid 排除
  ];
  // 仅距离：near/occupied 2 个
  assert.equal(countUsable(spots, "$B", undefined, { center, maxDistance: SPOT_MAX_DISTANCE }), 2);
  // 距离 + 实体占用：只有 near 1 个
  assert.equal(
    countUsable(spots, "$B", undefined, {
      center,
      maxDistance: SPOT_MAX_DISTANCE,
      isValid: (s) => s.key !== "occupied",
    }),
    1,
  );
});

test("pickBestSpot：只选满足约束（距离 + 现场无实体）的点", () => {
  const center = { x: 0, y: 64, z: 0 };
  const starSpot = (key: string, x: number, level: number): PoolSpot =>
    makeSpot(key, { stand: { x, y: 64, z: 0 }, aim: { target: { x: x + 1, y: 64, z: 0 }, level } });
  const spots = [
    starSpot("farHigh", 30, 5), // 高星但超 16 → 排除
    starSpot("blockedHigh", 3, 5), // 高星但被实体占用 → 排除
    starSpot("bestValid", 8, 4), // 唯一合格 → 最佳
  ];
  const best = pickBestSpot(spots, "$B", center, undefined, {
    center,
    maxDistance: SPOT_MAX_DISTANCE,
    isValid: (s) => s.key !== "blockedHigh",
  });
  assert.equal(best?.key, "bestValid");
});

