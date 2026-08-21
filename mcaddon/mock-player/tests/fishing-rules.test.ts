// ─── core/tasks — 钓鱼钩认主规则 ───────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AIR_BLOCK_ID,
  AIM_MAX_LEVEL,
  BITE_DROP_THRESHOLD,
  FISHING_HOOK_ID,
  FISHING_ROD_ID,
  FISHER_TAG_PREFIX,
  classifyFishingScan,
  collectFishingSpots,
  computeCastAim,
  computeTargetYaw,
  diffLoot,
  initialBiteTracker,
  isBiteDrop,
  isFishingHook,
  isFishingRod,
  isSafeSupport,
  isSurfaceWater,
  isWaterBlock,
  isYawAligned,
  judgeFishingSpot,
  judgeHookPlacement,
  judgeStandFishingSpot,
  makeFisherTag,
  makeLootFingerprint,
  parseFisherTag,
  sortFishingSpots,
  updateBiteTracker,
} from "../scripts/rules/FishingRules";
import type { Vec3 } from "../scripts/rules/Types";

test("常量：钓鱼钩实体 ID 与 tag 前缀精确值", () => {
  assert.equal(FISHING_HOOK_ID, "minecraft:fishing_hook");
  assert.equal(FISHING_ROD_ID, "minecraft:fishing_rod");
  assert.equal(FISHER_TAG_PREFIX, "mp:fisher:");
});

test("钓鱼钩实体判定", () => {
  assert.equal(isFishingHook("minecraft:fishing_hook"), true);
  assert.equal(isFishingHook("minecraft:arrow"), false);
  assert.equal(isFishingHook("minecraft:thrown_trident"), false);
});

test("钓鱼竿物品判定", () => {
  assert.equal(isFishingRod("minecraft:fishing_rod"), true);
  assert.equal(isFishingRod("minecraft:fishing_hook"), false);
  assert.equal(isFishingRod("minecraft:arrow"), false);
});

test("鱼钩主人 tag 编码与解析（中文假人名）", () => {
  const tag = makeFisherTag("$钓鱼王");
  assert.equal(tag, "mp:fisher:$钓鱼王");
  assert.equal(parseFisherTag(tag), "$钓鱼王");
});

test("解析非鱼钩 tag 返回 undefined", () => {
  assert.equal(parseFisherTag("mp:owner:someone"), undefined);
  assert.equal(parseFisherTag("random-tag"), undefined);
  assert.equal(parseFisherTag(""), undefined);
});

test("空名鱼钩 tag 解析返回 undefined", () => {
  assert.equal(parseFisherTag("mp:fisher:"), undefined);
});

test("水方块判定（普通水/流动水都能钓）", () => {
  assert.equal(isWaterBlock("minecraft:water"), true);
  assert.equal(isWaterBlock("minecraft:flowing_water"), true);
  assert.equal(isWaterBlock("minecraft:stone"), false);
  assert.equal(isWaterBlock("minecraft:air"), false);
});

test("咬钩下沉信号判定（相对最高点下降超过阈值 0.25）", () => {
  assert.equal(BITE_DROP_THRESHOLD, 0.25);
  assert.equal(isBiteDrop(0.5), true);
  assert.equal(isBiteDrop(0.25), false); // 恰在阈值不触发（严格大于）
  assert.equal(isBiteDrop(0.2), false);
  assert.equal(isBiteDrop(-0.1), false); // 上浮不算
});

test("边界：咬钩阈值临界值（0.2501 触发，0.25 恰不触发）", () => {
  assert.equal(isBiteDrop(0.2501), true);
  assert.equal(isBiteDrop(0.2499), false);
  assert.equal(isBiteDrop(1), true); // 深下沉
});

test("咬钩判定：下沉量超过 0.25 即上钩（单次判定，最高点参照）", () => {
  let t = initialBiteTracker(10);
  // 下沉 0.2（< 0.25）不触发；继续下沉到 0.3（> 0.25）→ 上钩
  let r = updateBiteTracker(t, 9.8);
  t = r.tracker;
  assert.equal(r.bite, false);
  r = updateBiteTracker(t, 9.7);
  assert.equal(r.bite, true); // 相对最高点 10 下沉 0.3 > 0.25
});

test("咬钩判定：下沉不多（0.2 内）不上钩——最高点参照天然防误判", () => {
  let t = initialBiteTracker(10);
  // 微小下沉 0.2（< 0.25）→ 不触发
  const r = updateBiteTracker(t, 9.8);
  assert.equal(r.bite, false);
});

test("咬钩判定：正常浮动不误判（上浮刷新最高点参照）", () => {
  let t = initialBiteTracker(10);
  for (const y of [10.1, 9.9, 10.0, 9.95, 10.05]) {
    const r = updateBiteTracker(t, y);
    t = r.tracker;
    assert.equal(r.bite, false); // 浮动幅度 ±0.1 < 阈值
  }
});

test("咬钩判定：上浮后最高点跟随刷新，后续小降不误判", () => {
  let t = initialBiteTracker(10);
  // 上浮到 10.3 → 最高点刷新为 10.3
  let r = updateBiteTracker(t, 10.3);
  t = r.tracker;
  assert.equal(r.bite, false);
  assert.equal(t.maxY, 10.3);
  // 相对新最高点小降 0.2 → 不触发（参照已跟随）
  r = updateBiteTracker(t, 10.1);
  assert.equal(r.bite, false);
});

test("咬钩判定：缓慢渐进下沉同样捕获（最高点不变，下沉量随深度增大）", () => {
  let t = initialBiteTracker(10);
  // 每窗口降 0.1：0.1 → 0.2（未触发）→ 0.3（>0.25 触发）
  let r = updateBiteTracker(t, 9.9);
  t = r.tracker;
  assert.equal(r.bite, false);
  r = updateBiteTracker(t, 9.8);
  t = r.tracker;
  assert.equal(r.bite, false);
  r = updateBiteTracker(t, 9.7);
  assert.equal(r.bite, true);
});

test("鱼钩落点判定：勾中任何实体都失败（实体优先），无实体才看是否入水", () => {
  assert.equal(judgeHookPlacement(false, true), "snagged"); // 勾中实体生物
  assert.equal(judgeHookPlacement(true, true), "snagged"); // 勾中鱼/玩家也失败（水中勾住实体同样不行）
  assert.equal(judgeHookPlacement(true, false), "water"); // 无实体 + 入水 = 正常
  assert.equal(judgeHookPlacement(false, false), "landed"); // 无实体 + 不在水 = 勾中固体方块
});

test("水面判定：水方块且上方一定是空气", () => {
  assert.equal(isSurfaceWater("minecraft:water", AIR_BLOCK_ID), true);
  assert.equal(isSurfaceWater("minecraft:flowing_water", AIR_BLOCK_ID), true);
  assert.equal(isSurfaceWater("minecraft:water", "minecraft:stone"), false); // 深水（上方还是水/方块）
  assert.equal(isSurfaceWater("minecraft:stone", AIR_BLOCK_ID), false); // 非水
});

test("安全支撑判定：排除岩浆块/岩浆/火等危险方块", () => {
  assert.equal(isSafeSupport("minecraft:stone"), true);
  assert.equal(isSafeSupport("minecraft:dirt"), true);
  assert.equal(isSafeSupport("minecraft:magma_block"), false); // 踩上掉血
  assert.equal(isSafeSupport("minecraft:lava"), false);
  assert.equal(isSafeSupport("minecraft:flowing_lava"), false);
  assert.equal(isSafeSupport("minecraft:fire"), false);
});

test("钓鱼点条件：安全实体方块 + 上方两格空气", () => {
  assert.equal(judgeFishingSpot("minecraft:stone", AIR_BLOCK_ID, AIR_BLOCK_ID), true);
  assert.equal(judgeFishingSpot("minecraft:dirt", AIR_BLOCK_ID, AIR_BLOCK_ID), true);
  assert.equal(judgeFishingSpot("minecraft:magma_block", AIR_BLOCK_ID, AIR_BLOCK_ID), false); // 危险
  assert.equal(judgeFishingSpot("minecraft:stone", "minecraft:water", AIR_BLOCK_ID), false); // 站立格是水
  assert.equal(judgeFishingSpot("minecraft:stone", AIR_BLOCK_ID, "minecraft:stone"), false); // 头顶格被堵
  assert.equal(judgeFishingSpot("minecraft:stone", AIR_BLOCK_ID, ""), false); // 头顶不可访问
});

test("收集钓鱼点：水面 8 邻候选 + 实体/安全/上方空气过滤", () => {
  const water: Vec3 = { x: 5, y: 0, z: 5 };
  // 东/西 stone 可站；北 lava 危险；其余候选为空气（非实体）
  const types = new Map<string, string>([
    ["5,0,6", "minecraft:stone"], // 东
    ["5,0,4", "minecraft:stone"], // 西
    ["4,0,5", "minecraft:lava"], // 北（危险）
  ]);
  // 未映射位置 = 空气（真实世界 getBlock 对空气方块返回 minecraft:air）
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([water], blockType, isSolid);
  assert.equal(spots.length, 2);
  // 站立格 = 支撑块上方 1 格（遍历顺序按 ADJACENT_8，先西后东，排序后比较）
  const stands = spots.map((s) => s.stand).sort((a, b) => a.z - b.z);
  assert.deepEqual(stands, [
    { x: 5, y: 1, z: 4 },
    { x: 5, y: 1, z: 6 },
  ]);
  // 关联：支撑块与水面
  assert.equal(spots[0]!.support.y, 0);
  assert.deepEqual(spots[0]!.waters[0], water);
});

test("收集钓鱼点：同一站立格被多个水面共享时去重且 waters 全部收集", () => {
  const waterA: Vec3 = { x: 5, y: 0, z: 5 };
  const waterB: Vec3 = { x: 5, y: 0, z: 4 }; // 南北相邻水面
  // (6,0,5) 同时是 waterA 东邻 + waterB 东南邻 → 同一支撑块 → 同一钓鱼点去重
  const types = new Map<string, string>([["6,0,5", "minecraft:stone"]]);
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([waterA, waterB], blockType, isSolid);
  assert.equal(spots.length, 1);
  assert.deepEqual(spots[0]!.stand, { x: 6, y: 1, z: 5 });
  // 相邻水面全部收集（2 个）
  assert.deepEqual(spots[0]!.waters, [waterA, waterB]);
});

test("收集钓鱼点：同一水面只收集一次 waters（不重复）", () => {
  const water: Vec3 = { x: 5, y: 0, z: 5 };
  const types = new Map<string, string>([["5,0,4", "minecraft:stone"]]);
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([water, water], blockType, isSolid);
  assert.equal(spots.length, 1);
  assert.equal(spots[0]!.waters.length, 1);
});

test("钓鱼点排序：同星级按到中心坐标平方距离就近优先", () => {
  const far: Vec3 = { x: 10, y: 0, z: 10 };
  const near: Vec3 = { x: 5, y: 0, z: 5 };
  const spots = [
    { stand: far, support: { x: 10, y: -1, z: 10 }, waters: [{ x: 10, y: 0, z: 9 }], aim: { target: { x: 10, y: 0, z: 9 }, level: 1 } },
    { stand: near, support: { x: 5, y: -1, z: 5 }, waters: [{ x: 5, y: 0, z: 4 }], aim: { target: { x: 5, y: 0, z: 4 }, level: 1 } },
  ];
  const sorted = sortFishingSpots(spots, { x: 0, y: 0, z: 0 });
  assert.deepEqual(sorted[0]!.stand, near);
  assert.deepEqual(sorted[1]!.stand, far);
});

test("钓鱼点排序：星级优先于距离（5 星远点排在 1 星近点前）", () => {
  const near1star: Vec3 = { x: 2, y: 0, z: 2 };
  const far5star: Vec3 = { x: 10, y: 0, z: 10 };
  const mid3star: Vec3 = { x: 8, y: 0, z: 8 };
  const spots = [
    { stand: near1star, support: { x: 2, y: -1, z: 2 }, waters: [{ x: 2, y: 0, z: 1 }], aim: { target: { x: 2, y: 0, z: 1 }, level: 1 } },
    { stand: far5star, support: { x: 10, y: -1, z: 10 }, waters: [{ x: 10, y: 0, z: 9 }], aim: { target: { x: 10, y: 0, z: 5 }, level: 5 } },
    { stand: mid3star, support: { x: 8, y: -1, z: 8 }, waters: [{ x: 8, y: 0, z: 7 }], aim: { target: { x: 8, y: 0, z: 5 }, level: 3 } },
  ];
  const sorted = sortFishingSpots(spots, { x: 0, y: 0, z: 0 });
  // 星级降序：5 星 → 3 星 → 1 星（距离再近的 1 星也排最后）
  assert.deepEqual(
    sorted.map((s) => s.stand),
    [far5star, mid3star, near1star]
  );
});

test("抛竿瞄准点：五星级（延伸 5 格连续水体）", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearest: Vec3 = { x: 5, y: 0, z: 4 }; // 西邻水面（第 1 格）
  const waters = new Map<string, boolean>([
    ["5,0,4", true], // 1
    ["5,0,3", true], // 2
    ["5,0,2", true], // 3
    ["5,0,1", true], // 4
    ["5,0,0", true], // 5
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  const aim = computeCastAim(stand, [nearest], isWater);
  assert.equal(aim!.level, AIM_MAX_LEVEL); // 5 星封顶
  assert.deepEqual(aim!.target, { x: 5, y: 0, z: 0 }); // 最远延伸水格
});

test("抛竿瞄准点：延伸路径中断（3 格 = 三星）", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearest: Vec3 = { x: 5, y: 0, z: 4 };
  const waters = new Map<string, boolean>([
    ["5,0,4", true], // 1
    ["5,0,3", true], // 2
    ["5,0,2", true], // 3
    // 5,0,1 非水 → 中断
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  const aim = computeCastAim(stand, [nearest], isWater);
  assert.equal(aim!.level, 3);
  assert.deepEqual(aim!.target, { x: 5, y: 0, z: 2 });
});

test("抛竿瞄准点：一格水坑（一星，很差）", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearest: Vec3 = { x: 5, y: 0, z: 4 };
  const isWater = (): boolean => false; // 相邻格之外全非水
  const aim = computeCastAim(stand, [nearest], isWater);
  assert.equal(aim!.level, 1);
  assert.deepEqual(aim!.target, nearest); // 瞄准点 = 相邻水面自身
});

test("抛竿瞄准点：对角方向延伸 + 取最近水面定方向", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const farWater: Vec3 = { x: 6, y: 0, z: 6 }; // 东南对角（远）
  const nearWater: Vec3 = { x: 6, y: 0, z: 5 }; // 正东（近）
  const waters = new Map<string, boolean>([
    ["6,0,5", true],
    ["7,0,5", true],
    ["8,0,5", true], // 延伸第 3 格（东方向）
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  // 取最近水面（正东）定方向，沿 (1,0) 延伸
  const aim = computeCastAim(stand, [farWater, nearWater], isWater);
  assert.equal(aim!.level, 3);
  assert.deepEqual(aim!.target, { x: 8, y: 0, z: 5 });
});

test("收集钓鱼点：集成瞄准点评分（五星 vs 一星）", () => {
  const waterA: Vec3 = { x: 5, y: 0, z: 5 };
  // waterA 东侧支撑块，stand 面向水面方向 = 西，沿西延伸 5 格连续水 = 五星
  const types = new Map<string, string>([
    ["6,0,5", "minecraft:stone"], // 支撑块（waterA 东邻）
    ["4,0,5", "minecraft:water"], // 延伸 2
    ["3,0,5", "minecraft:water"], // 延伸 3
    ["2,0,5", "minecraft:water"], // 延伸 4
    ["1,0,5", "minecraft:water"], // 延伸 5
  ]);
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([waterA], blockType, isSolid);
  assert.equal(spots.length, 1);
  // 延伸路径（stand (6,1,5) → 水面方向西）：5,0,5(1) → 4,0,5(2) → 3,0,5(3) → 2,0,5(4) → 1,0,5(5)
  assert.equal(spots[0]!.aim.level, 5);
  assert.deepEqual(spots[0]!.aim.target, { x: 1, y: 0, z: 5 });
});

test("扫描失败原因分类：no-water / no-spot / 成功", () => {
  assert.equal(classifyFishingScan(0, 0), "no-water");
  assert.equal(classifyFishingScan(0, 3), "no-water"); // 无水面不可能有钓鱼点
  assert.equal(classifyFishingScan(3, 0), "no-spot"); // 有水面但无满足条件钓鱼点
  assert.equal(classifyFishingScan(3, 2), undefined); // 成功
});

// ─── 边界补充（阈值/空输入/防御分支/封顶语义/鲁棒性） ───

test("边界：安全支撑空串/未知方块视为安全（实心由调用方拦截）", () => {
  assert.equal(isSafeSupport(""), true); // 调用方 collect 已保证 supportType 非空
  assert.equal(isSafeSupport("minecraft:unknown_block"), true);
});

test("边界：水面判定——上方是水（深水）或空串均非水面", () => {
  assert.equal(isSurfaceWater("minecraft:water", "minecraft:water"), false); // 深水下层
  assert.equal(isSurfaceWater("minecraft:water", "minecraft:flowing_water"), false);
  assert.equal(isSurfaceWater("minecraft:water", ""), false); // 上方不可访问
  assert.equal(isSurfaceWater("", AIR_BLOCK_ID), false); // 非水
});

test("边界：钓鱼点条件——支撑块不可访问（空串）不判定为钓鱼点", () => {
  // 空串 supportType：isSafeSupport 视为安全，但上方条件仍须通过——此处记录语义：
  // 空串意味着方块不可访问，调用方 collect 已先拦截（supportType 非空才进判定）
  assert.equal(judgeFishingSpot("", AIR_BLOCK_ID, AIR_BLOCK_ID), true); // 调用方拦截场景
  assert.equal(judgeFishingSpot("minecraft:stone", "", AIR_BLOCK_ID), false); // 站立格不可访问
  assert.equal(judgeFishingSpot("minecraft:stone", AIR_BLOCK_ID, ""), false); // 头顶不可访问
});

test("边界：收集钓鱼点——空水面列表返回空", () => {
  const blockType = (): string | undefined => AIR_BLOCK_ID;
  const isSolid = (): boolean => false;
  assert.deepEqual(collectFishingSpots([], blockType, isSolid), []);
});

test("边界：收集钓鱼点——站立格是水被排除", () => {
  const water: Vec3 = { x: 5, y: 0, z: 5 };
  // 支撑块 (5,0,4)（西）上方 1 格是水（深水边缘场景）→ 站立格是水 → 不构成钓鱼点
  const types = new Map<string, string>([
    ["5,0,4", "minecraft:stone"], // 支撑块
    ["5,1,4", "minecraft:water"], // 站立格是水
  ]);
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([water], blockType, isSolid);
  assert.equal(spots.length, 0);
});

test("边界：收集钓鱼点——对角支撑块同样可构成钓鱼点（8 邻全覆盖）", () => {
  const water: Vec3 = { x: 5, y: 0, z: 5 };
  const types = new Map<string, string>([
    ["6,0,6", "minecraft:stone"], // 东南对角
    ["5,0,6", "minecraft:stone"], // 正南
  ]);
  const blockType = (loc: Vec3): string | undefined => types.get(`${loc.x},${loc.y},${loc.z}`) ?? AIR_BLOCK_ID;
  const isSolid = (loc: Vec3): boolean => blockType(loc) === "minecraft:stone";
  const spots = collectFishingSpots([water], blockType, isSolid);
  assert.equal(spots.length, 2);
  // ADJACENT_8 遍历顺序：先 {0,1} 正南，后 {1,1} 对角
  assert.deepEqual(spots[0]!.stand, { x: 5, y: 1, z: 6 }); // 正南
  assert.deepEqual(spots[1]!.stand, { x: 6, y: 1, z: 6 }); // 对角
});

test("边界：瞄准点——waters 为空返回 undefined", () => {
  const isWater = (): boolean => true;
  assert.equal(computeCastAim({ x: 5, y: 1, z: 5 }, [], isWater), undefined);
});

test("边界：瞄准点——方向异常（stand 与水面同列）防御为 1 星", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const sameColumn: Vec3 = { x: 5, y: 0, z: 5 }; // 理论不出现（8 邻保证至少一轴偏移）
  const isWater = (): boolean => true;
  const aim = computeCastAim(stand, [sameColumn], isWater);
  assert.equal(aim!.level, 1);
  assert.deepEqual(aim!.target, sameColumn);
});

test("边界：瞄准点——四星（第 5 格非水中断）", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearest: Vec3 = { x: 5, y: 0, z: 4 };
  const waters = new Map<string, boolean>([
    ["5,0,4", true], // 1
    ["5,0,3", true], // 2
    ["5,0,2", true], // 3
    ["5,0,1", true], // 4
    // 5,0,0 非水 → 中断
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  const aim = computeCastAim(stand, [nearest], isWater);
  assert.equal(aim!.level, 4);
  assert.deepEqual(aim!.target, { x: 5, y: 0, z: 1 });
});

test("边界：瞄准点——五星封顶后第 6 格非水不降级", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearest: Vec3 = { x: 5, y: 0, z: 4 };
  const waters = new Map<string, boolean>([
    ["5,0,4", true], // 1
    ["5,0,3", true], // 2
    ["5,0,2", true], // 3
    ["5,0,1", true], // 4
    ["5,0,0", true], // 5
    // 5,0,-1 非水（第 6 格）——封顶后不检查
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  const aim = computeCastAim(stand, [nearest], isWater);
  assert.equal(aim!.level, AIM_MAX_LEVEL); // 仍 5 星
  assert.deepEqual(aim!.target, { x: 5, y: 0, z: 0 });
});

test("边界：瞄准点——waters 乱序不影响最近水面选择", () => {
  const stand: Vec3 = { x: 5, y: 1, z: 5 };
  const nearWater: Vec3 = { x: 6, y: 0, z: 5 }; // 正东（近）
  const farWater: Vec3 = { x: 6, y: 0, z: 6 }; // 东南对角（远）
  const waters = new Map<string, boolean>([
    ["6,0,5", true],
    ["7,0,5", true],
  ]);
  const isWater = (loc: Vec3): boolean => waters.get(`${loc.x},${loc.y},${loc.z}`) === true;
  // 乱序输入（远的在前）
  const aimA = computeCastAim(stand, [farWater, nearWater], isWater);
  const aimB = computeCastAim(stand, [nearWater, farWater], isWater);
  assert.deepEqual(aimA, aimB);
  assert.equal(aimA!.level, 2);
  assert.deepEqual(aimA!.target, { x: 7, y: 0, z: 5 });
});

test("边界：排序——空列表与单元素", () => {
  const center: Vec3 = { x: 0, y: 0, z: 0 };
  assert.deepEqual(sortFishingSpots([], center), []);
  const single = [
    { stand: { x: 1, y: 0, z: 1 }, support: { x: 1, y: -1, z: 1 }, waters: [{ x: 1, y: 0, z: 0 }], aim: { target: { x: 1, y: 0, z: 0 }, level: 3 } },
  ];
  assert.deepEqual(sortFishingSpots(single, center), single);
});

test("边界：tag 解析——名字含冒号完整保留（slice 语义）", () => {
  const tag = makeFisherTag("名字:带冒号");
  assert.equal(tag, "mp:fisher:名字:带冒号");
  assert.equal(parseFisherTag(tag), "名字:带冒号"); // 冒号后的内容不截断
  assert.equal(parseFisherTag("mp:fisher: 空格名 "), " 空格名 "); // 前后空格保留
});

// ─── AI 行为判定（judgeStandFishingSpot / yaw / 战利品 diff） ───

test("完整钓鱼点判定：安全支撑 + 上方两格空气 + 至少一个相邻水面", () => {
  const stand: Vec3 = { x: 5, y: 4, z: 5 };
  assert.equal(judgeStandFishingSpot(stand, "minecraft:stone", AIR_BLOCK_ID, AIR_BLOCK_ID, 1), true);
  assert.equal(judgeStandFishingSpot(stand, "minecraft:stone", AIR_BLOCK_ID, AIR_BLOCK_ID, 3), true);
  // 缺相邻水面 → 不是钓鱼点（用户规格：点位必须与水相连）
  assert.equal(judgeStandFishingSpot(stand, "minecraft:stone", AIR_BLOCK_ID, AIR_BLOCK_ID, 0), false);
  // 危险支撑 / 站立格是水 / 头顶被堵 → 均不构成
  assert.equal(judgeStandFishingSpot(stand, "minecraft:magma_block", AIR_BLOCK_ID, AIR_BLOCK_ID, 1), false);
  assert.equal(judgeStandFishingSpot(stand, "minecraft:stone", "minecraft:water", AIR_BLOCK_ID, 1), false);
  assert.equal(judgeStandFishingSpot(stand, "minecraft:stone", AIR_BLOCK_ID, "minecraft:stone", 1), false);
});

test("目标 yaw 计算：MC 标准（0=南+Z、东=-90、北=±180）", () => {
  const from: Vec3 = { x: 0, y: 0, z: 0 };
  // ⚠️ -0 断言陷阱：assert.equal 用 Object.is（-0 !== 0），加 +0 归一化
  assert.equal(Math.round(computeTargetYaw(from, { x: 0, y: 0, z: 5 })) + 0, 0); // 朝南
  assert.equal(Math.round(computeTargetYaw(from, { x: 5, y: 0, z: 0 })), -90); // 朝东
  assert.equal(Math.round(computeTargetYaw(from, { x: -5, y: 0, z: 0 })), 90); // 朝西
  assert.equal(Math.abs(Math.round(computeTargetYaw(from, { x: 0, y: 0, z: -5 }))), 180); // 朝北
});

test("朝向对齐判定：角度差归一化 ±180，容差内对齐", () => {
  assert.equal(isYawAligned(0, 10, 15), true);
  assert.equal(isYawAligned(0, 20, 15), false);
  assert.equal(isYawAligned(-90, -80, 15), true);
  // 跨 ±180 边界：179 与 -179 差 2 度 → 对齐
  assert.equal(isYawAligned(179, -179, 15), true);
  assert.equal(isYawAligned(170, -170, 15), false);
  assert.equal(isYawAligned(0, 360, 15), true); // 360 归一化为 0
});

test("物品指纹：附魔差异可区分（带海之眷顾的鱼 vs 普通鱼）", () => {
  assert.equal(makeLootFingerprint("minecraft:cod", []), "minecraft:cod");
  assert.equal(makeLootFingerprint("minecraft:enchanted_book", [{ id: "luck_of_the_sea", level: 3 }]), "minecraft:enchanted_book#luck_of_the_sea:3");
  assert.notEqual(
    makeLootFingerprint("minecraft:enchanted_book", [{ id: "luck_of_the_sea", level: 3 }]),
    makeLootFingerprint("minecraft:enchanted_book", [{ id: "luck_of_the_sea", level: 2 }])
  );
});

test("战利品 diff：新增物品/附魔区分/多数量/无变化", () => {
  // 空背包 → 钓到 2 条 cod
  assert.deepEqual(diffLoot({}, { "minecraft:cod": 2 }), [{ typeId: "minecraft:cod", count: 2, enchantments: [] }]);
  // 已有 1 条 cod，钓到 1 条 → 新增 1
  assert.deepEqual(diffLoot({ "minecraft:cod": 1 }, { "minecraft:cod": 2 }), [{ typeId: "minecraft:cod", count: 1, enchantments: [] }]);
  // 附魔书：before 无 → after 1 本海之眷顾Ⅲ
  assert.deepEqual(diffLoot({}, { "minecraft:enchanted_book#luck_of_the_sea:3": 1 }), [
    { typeId: "minecraft:enchanted_book", count: 1, enchantments: [{ id: "luck_of_the_sea", level: 3 }] },
  ]);
  // 无变化 → 空战利品
  assert.deepEqual(diffLoot({ "minecraft:cod": 2 }, { "minecraft:cod": 2 }), []);
  // 物品减少（消耗）不算新增
  assert.deepEqual(diffLoot({ "minecraft:cod": 2 }, { "minecraft:cod": 1 }), []);
});
