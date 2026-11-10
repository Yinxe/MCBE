// domain 规则单测：三叉戟扫描 / 钓点站位判定 / 工具守护 / 认主解析。
import test from "node:test";
import assert from "node:assert/strict";

import { scanTridentSlots, isTrident, TRIDENT_ID } from "../scripts/domain/TridentRules";
import { judgeStandSpot, extendAim, sortSpotCandidates, isSafeSupport } from "../scripts/domain/FishingSpot";
import type { SpotCandidate } from "../scripts/domain/FishingSpot";
import {
  isWatchedTool,
  isDurabilityCritical,
  findReplacementIndex,
  pickStowSlot,
  planGuardSwap,
  canClearMainhand,
} from "../scripts/domain/ToolRules";
import {
  makeOwnerTag,
  makeOwner2Tag,
  encodeItemTag,
  decodeItemTag,
  parseOwnerTags,
  resolveClaimOwner,
  isFamilyOwned,
  clusterPoints,
} from "../scripts/domain/ClaimRules";

// ─── TridentRules ──

test("scanTridentSlots：主手三叉戟计入一次且背包主手格不重复", () => {
  const items: (string | null)[] = [TRIDENT_ID, "minecraft:stone", TRIDENT_ID, null];
  const out = scanTridentSlots(items, 0, true);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { slotIndex: 0, isMainhand: true });
  assert.deepEqual(out[1], { slotIndex: 2, isMainhand: false });
});

test("scanTridentSlots：主手非三叉戟时照常全扫", () => {
  const items: (string | null)[] = ["minecraft:sword", TRIDENT_ID];
  const out = scanTridentSlots(items, 0, false);
  assert.deepEqual(out, [{ slotIndex: 1, isMainhand: false }]);
});

test("isTrident：精确匹配", () => {
  assert.ok(isTrident(TRIDENT_ID));
  assert.ok(!isTrident("minecraft:tridenten"));
});

// ─── FishingSpot ──

const AIR = "minecraft:air";
const waterProbe = { id: "minecraft:water", air: false, liquid: true };
const sandProbe = { id: "minecraft:sand", air: false, liquid: false };

test("judgeStandSpot：支撑安全+上方两格精确空气+邻水", () => {
  assert.ok(judgeStandSpot(sandProbe, AIR, AIR, 1));
  assert.ok(!judgeStandSpot(sandProbe, "minecraft:cave_air", AIR, 1), "cave_air 不放行");
  assert.ok(!judgeStandSpot(waterProbe, AIR, AIR, 1), "液体支撑不放行");
  assert.ok(!judgeStandSpot({ id: "minecraft:magma_block", air: false, liquid: false }, AIR, AIR, 1), "危险支撑不放行");
  assert.ok(!judgeStandSpot(sandProbe, AIR, AIR, 0), "不邻水不放行");
});

test("isSafeSupport：空气/液体/黑名单全拒", () => {
  assert.ok(!isSafeSupport({ id: AIR, air: true, liquid: false }));
  assert.ok(!isSafeSupport({ id: "minecraft:lava", air: false, liquid: true }));
  assert.ok(isSafeSupport(sandProbe));
});

test("extendAim：连续水面延伸到尽头，星级=格数", () => {
  const water = new Set(["1,0", "2,0", "3,0"]);
  const r = extendAim({ x: 0, y: 64, z: 0 }, { x: 1, y: 0 }, (p) => water.has(`${p.x},${p.z}`));
  assert.ok(r);
  assert.equal(r.level, 3);
  assert.deepEqual(r.target, { x: 3, y: 64, z: 0 });
});

test("extendAim：首格非水 → undefined", () => {
  assert.equal(
    extendAim({ x: 0, y: 64, z: 0 }, { x: 1, y: 0 }, () => false),
    undefined
  );
});

test("sortSpotCandidates：星级降序、同星级距中心升序", () => {
  const mk = (level: number, distSqCenter: number): SpotCandidate => ({
    stand: { x: 0, y: 0, z: 0 },
    aim: { target: { x: 0, y: 0, z: 0 }, level },
    distSqCenter,
  });
  const out = sortSpotCandidates([mk(2, 5), mk(5, 99), mk(2, 1)]);
  assert.deepEqual(
    out.map((s) => [s.aim.level, s.distSqCenter]),
    [
      [5, 99],
      [2, 1],
      [2, 5],
    ]
  );
});

// ─── ToolRules ──

test("isWatchedTool：精确 id 与后缀双通道", () => {
  assert.ok(isWatchedTool("minecraft:fishing_rod"));
  assert.ok(isWatchedTool("minecraft:diamond_pickaxe"));
  assert.ok(!isWatchedTool("minecraft:apple"));
});

test("isDurabilityCritical：百分比与绝对点数双阈值", () => {
  assert.ok(isDurabilityCritical({ damage: 60, maxDurability: 64 }), "剩余4 <5%");
  assert.ok(isDurabilityCritical({ damage: 57, maxDurability: 65 }), "剩余8 <10点");
  assert.ok(!isDurabilityCritical({ damage: 30, maxDurability: 64 }));
  assert.ok(!isDurabilityCritical({ damage: 60, maxDurability: 64, unbreakable: true }));
  assert.ok(!isDurabilityCritical({}), "无组件视为健康");
});

test("findReplacementIndex：同型替换排除当前槽；健康闸剔除残件（差异修复 #12）", () => {
  const items: (string | null)[] = ["minecraft:iron_pickaxe", null, "minecraft:iron_pickaxe", "minecraft:iron_pickaxe"];
  assert.equal(
    findReplacementIndex(items, "minecraft:iron_pickaxe", 0, () => true),
    2
  );
  assert.equal(
    findReplacementIndex(items, "minecraft:iron_pickaxe", 2, () => true),
    0
  );
  assert.equal(
    findReplacementIndex(items, "minecraft:stone_pickaxe", 0, () => true),
    -1
  );
  // 槽 2 不健康→顺延槽 3
  assert.equal(
    findReplacementIndex(items, "minecraft:iron_pickaxe", 0, (slot) => slot !== 2),
    3
  );
  assert.equal(
    findReplacementIndex(items, "minecraft:iron_pickaxe", 0, () => false),
    -1
  );
});

test("pickStowSlot：空槽优先；目标撞主手位0且手位非0时后移（归档 swap(0,x) 受损回主手 bug）", () => {
  // hand=1，唯一非手空槽是 0 → 不能收进 0，后移取 2
  assert.equal(pickStowSlot([null, "minecraft:rod", "x", "y"], 1), 2);
  // hand=0，空槽 1 不是主手位 → 直取
  assert.equal(pickStowSlot(["minecraft:rod", null, "x"], 0), 1);
  // 全无空槽 → 兜底首个非手槽恰为 0，同样后移
  assert.equal(pickStowSlot(["a", "b", "c"], 1), 2);
});

test("planGuardSwap：候选已在主手→仅切换选中不交换（防 swap(0,0)）", () => {
  const p = planGuardSwap(3, 0);
  assert.deepEqual(p.swaps, []);
  assert.ok(p.selectMainhand);
});

test("planGuardSwap：手位非主手→双交换把健康工具换进主手", () => {
  const p = planGuardSwap(5, 9);
  assert.deepEqual(p.swaps, [
    [0, 5],
    [0, 9],
  ]);
});

test("canClearMainhand：只有主手有物（无空槽）→ 拒清空", () => {
  assert.ok(!canClearMainhand(["minecraft:rod", "minecraft:rod"], 0));
  assert.ok(canClearMainhand(["minecraft:rod", null], 0));
});

// ─── ClaimRules ──

test("tag 编解码往返：双任 + 物品快照", () => {
  const tags = [
    makeOwnerTag("Steve"),
    makeOwner2Tag("bot1"),
    encodeItemTag([{ id: "minecraft:loyalty", level: 3 }], { current: 201, max: 251 }),
  ];
  const parsed = parseOwnerTags(tags);
  assert.equal(parsed.firstOwner, "Steve");
  assert.equal(parsed.secondOwner, "bot1");
  assert.ok(parsed.itemTag);
  const info = decodeItemTag(parsed.itemTag!);
  assert.deepEqual(info.enchantments, [{ id: "minecraft:loyalty", level: 3 }]);
  assert.deepEqual(info.durability, { current: 201, max: 251 });
});

test("decodeItemTag：无耐久段/脏数据降级不抛", () => {
  assert.deepEqual(decodeItemTag("mp:item:"), { enchantments: [], durability: undefined });
  assert.deepEqual(decodeItemTag("mp:item:minecraft:impaling:2"), {
    enchantments: [{ id: "minecraft:impaling", level: 2 }],
    durability: undefined,
  });
  assert.deepEqual(decodeItemTag("mp:item:garbage:xx"), { enchantments: [], durability: undefined });
});

test("resolveClaimOwner：在线第二任 > 在线第一任 > 都不动", () => {
  const online = (n: string) => n === "botA" || n === "Steve";
  assert.equal(resolveClaimOwner("Steve", "botA", online), "botA");
  assert.equal(resolveClaimOwner("Steve", "botOffline", online), "Steve");
  assert.equal(
    resolveClaimOwner("pOff1", "pOff2", () => false),
    undefined
  );
});

test("夺回前置：最优是自己才可夺回（以 resolveClaimOwner 判定）", () => {
  const online = (n: string) => n === "botA" || n === "botB";
  assert.notEqual(resolveClaimOwner("botA", "botB", online), "botA", "第二任 botB 在线，最优不是自己");
  assert.equal(resolveClaimOwner("botA", "botC", online), "botA", "离线第二任 → 回退第一任自己");
  assert.notEqual(resolveClaimOwner("botX", "botB", online), "botA", "都不相关时最优不是自己");
});

test("isFamilyOwned：第一/第二任任一命中家族即自家", () => {
  const fam = new Set(["Steve", "bot1"]);
  assert.ok(isFamilyOwned("Steve", undefined, fam));
  assert.ok(isFamilyOwned("nobody", "bot1", fam));
  assert.ok(!isFamilyOwned("nobody", "otherBot", fam));
});

test("clusterPoints：半径 3 链式连通聚组，组按规模降序、组内按密度降序", () => {
  const pts = [
    { id: "a", x: 0, y: 0, z: 0 },
    { id: "b", x: 2, y: 0, z: 0 },
    { id: "c", x: 4, y: 0, z: 0 },
    { id: "d", x: 50, y: 0, z: 0 },
  ];
  const groups = clusterPoints(pts, 3);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.length, 3);
  assert.deepEqual(
    groups[0]!.map((p) => p.id),
    ["b", "a", "c"],
    "b 双邻居密度最高，a/c 同密度保序"
  );
  assert.equal(groups[1]![0]!.id, "d");
});
