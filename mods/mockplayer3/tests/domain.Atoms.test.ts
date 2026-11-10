// ─── domain 纯逻辑单测：工具规则 / 认主规则 / 咬钩跟踪 / 角度 / 导航 / 取消令牌 ──────
import assert from "node:assert/strict";
import test from "node:test";

import {
  canClearMainhand,
  findReplacementIndex,
  isDurabilityCritical,
  isWatchedTool,
  pickStowSlot,
  planGuardSwap,
  slotLabel,
} from "../scripts/domain/ToolRules";
import {
  clusterPoints,
  decodeItemTag,
  encodeItemTag,
  parseOwnerTags,
  resolveClaimOwner,
} from "../scripts/domain/ClaimRules";
import { initBiteState, updateBiteTracker } from "../scripts/domain/BiteWatch";
import {
  angleDiffDeg,
  computeTargetYaw,
  farLookPoint,
  isHeadFacing,
  normalizeAngle,
  rotationToward,
} from "../scripts/domain/Angle";
import { judgeStandSpot, sortSpotCandidates, extendAim } from "../scripts/domain/FishingSpot";
import { canNavigate, isArrived, isStuck, NAV_MAX_DISTANCE } from "../scripts/domain/NavRules";
import { CancelToken } from "../scripts/domain/Cancellation";

const v = (x: number, y: number, z: number) => ({ x, y, z });

test("ToolRules：关注工具识别（精确 id + 材料后缀全覆盖）", () => {
  assert.equal(isWatchedTool("minecraft:netherite_pickaxe"), true);
  assert.equal(isWatchedTool("minecraft:fishing_rod"), true);
  assert.equal(isWatchedTool("minecraft:shears"), true);
  assert.equal(isWatchedTool("minecraft:stone_shovel"), true);
  assert.equal(isWatchedTool("minecraft:apple"), false);
});

test("ToolRules：耐久告急双阈值 OR；缺字段/不可破坏视为健康", () => {
  assert.equal(isDurabilityCritical({ damage: 96, maxDurability: 100 }), true); // 4%<5%
  assert.equal(isDurabilityCritical({ damage: 991, maxDurability: 1000 }), true); // 剩余 9 点<10（绝对兜底）
  assert.equal(isDurabilityCritical({ damage: 50, maxDurability: 100 }), false);
  assert.equal(isDurabilityCritical({ unbreakable: true, damage: 99, maxDurability: 100 }), false);
  assert.equal(isDurabilityCritical({}), false);
});

test("ToolRules：守护交换计划——candidate 已在主手时禁止 swap(0,0) 自交换", () => {
  const same = planGuardSwap(5, 0);
  assert.deepEqual(same.swaps, []);
  assert.equal(same.selectMainhand, true);
  assert.equal(planGuardSwap(0, 7).swaps.length, 1);
  assert.equal(planGuardSwap(3, 7).swaps.length, 2);
});

test("ToolRules：保护性收起目标槽避开主手位 0", () => {
  const items: (string | null)[] = [null, null, null]; // 全空：hand=0 时首个非主手空槽是 1
  assert.equal(pickStowSlot(items, 0), 1);
  const occupied: (string | null)[] = ["minecraft:stone", null, null];
  assert.equal(pickStowSlot(occupied, 1), 2); // 槽1为主手被排除，槽2空
  const tricky: (string | null)[] = [null, "x", "y"];
  // 空槽=0 且 hand=1≠0 → 向后扫首个非 hand 槽（防受损工具回主手）
  assert.equal(pickStowSlot(tricky, 1), 2);
  assert.equal(
    findReplacementIndex(["a", "b", "a"], "a", 0, () => true),
    2
  );
  assert.equal(canClearMainhand([null, "x"], 1), true);
  assert.equal(canClearMainhand(["x", "y"], 0), false);
  assert.equal(slotLabel(0), "热栏1");
  assert.equal(slotLabel(9), "背包10");
});

test("ClaimRules：tag 编解码与双任解析", () => {
  const tag = encodeItemTag([{ id: "minecraft:unbreaking", level: 3 }], { current: 100, max: 251 });
  assert.equal(tag, "mp:item:minecraft:unbreaking:3|100/251");
  const dec = decodeItemTag(tag);
  assert.deepEqual(dec.enchantments, [{ id: "minecraft:unbreaking", level: 3 }]);
  assert.deepEqual(dec.durability, { current: 100, max: 251 });
  assert.deepEqual(decodeItemTag("mp:item:").enchantments, []);
  const owners = parseOwnerTags(["mp:owner:阿假", "mp:owner2: bob", "mp:item:x"]);
  assert.equal(owners.firstOwner, "阿假");
  assert.equal(owners.secondOwner, " bob");
  assert.ok(owners.itemTag);
});

test("ClaimRules：认主优先级=在线第二任>在线第一任>不动；夺回仅限最优是自己", () => {
  const online = new Set(["b"]);
  const probe = (n: string) => online.has(n);
  assert.equal(resolveClaimOwner("a", "b", probe), "b");
  assert.equal(resolveClaimOwner("a", undefined, probe), undefined); // 两任都离线→不动，等上线夺回
  assert.equal(resolveClaimOwner("b", undefined, probe), "b");
  assert.equal(resolveClaimOwner("a", "b", probe), "b"); // 夺回前置：最优非自己（b≠a）不得夺回
});

test("ClaimRules：链式聚簇按规模降序", () => {
  const pts = [
    { id: "1", x: 0, y: 0, z: 0 },
    { id: "2", x: 1, y: 0, z: 0 },
    { id: "3", x: 2, y: 0, z: 0 },
    { id: "4", x: 50, y: 0, z: 0 },
  ];
  const groups = clusterPoints(pts, 3);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]!.length, 3);
});

test("BiteWatch：滚动最高点参照捕获渐进下沉、不误报浮动", () => {
  const s = initBiteState();
  assert.equal(updateBiteTracker(s, 64.0), false);
  assert.equal(updateBiteTracker(s, 64.05), false); // 上浮刷新
  assert.equal(updateBiteTracker(s, 64.0), false); // ±0.1 内浮动不触发
  assert.equal(updateBiteTracker(s, 63.79), true); // drop 0.26>0.25
});

test("Angle：rotationToward/朝向互逆与最短弧", () => {
  assert.deepEqual(rotationToward(v(0, 0, 0), v(0, 0, 0)), { x: 0, y: 0 });
  const south = rotationToward(v(0, 0, 0), v(0, 0, 5));
  assert.equal(Math.abs(south.y) < 1e-6, true);
  assert.equal(normalizeAngle(350), -10);
  assert.equal(angleDiffDeg(179, -179), 2);
  assert.equal(isHeadFacing({ x: 0, y: 5 }, { x: 0, y: 15 }), true); // 10°≤12°
  assert.equal(isHeadFacing({ x: 0, y: 5 }, { x: 0, y: 30 }), false);
  assert.equal(computeTargetYaw(v(0, 0, 0), v(0, 0, 10)), 0); // +Z=南 yaw0
  const fp = farLookPoint(v(0, 64, 0), { x: 0, y: 0 }, 64);
  assert.equal(Math.abs(fp.z - 64) < 1e-9, true);
});

test("FishingSpot：站位判定（支撑安全+上方两格精确空气+邻水）", () => {
  const water = (id: string) => ({
    id,
    air: false,
    liquid: id.startsWith("minecraft:water") || id === "minecraft:flowing_water",
  });
  assert.equal(judgeStandSpot(water("minecraft:grass_block"), "minecraft:air", "minecraft:air", 1), true);
  assert.equal(judgeStandSpot(water("minecraft:lava"), "minecraft:air", "minecraft:air", 1), false);
  assert.equal(judgeStandSpot(water("minecraft:stone"), "minecraft:cave_air", "minecraft:air", 1), false); // cave_air 非精确 air
  assert.equal(judgeStandSpot(water("minecraft:stone"), "minecraft:air", "minecraft:air", 0), false);
  const aim = extendAim(v(10, 64, 10), { x: 1, y: 0 }, (p) => p.x <= 13);
  assert.equal(aim?.level, 3);
  assert.equal(
    extendAim(v(0, 0, 0), { x: 1, y: 0 }, () => false),
    undefined
  );
  const sorted = sortSpotCandidates([
    { stand: v(0, 0, 0), aim: { target: v(1, 0, 0), level: 2 }, distSqCenter: 100 },
    { stand: v(0, 0, 0), aim: { target: v(1, 0, 0), level: 5 }, distSqCenter: 900 },
    { stand: v(0, 0, 0), aim: { target: v(1, 0, 0), level: 2 }, distSqCenter: 50 },
  ]);
  assert.deepEqual(
    sorted.map((s) => `${s.aim.level}:${s.distSqCenter}`),
    ["5:900", "2:50", "2:100"]
  );
});

test("NavRules：距离预检/到达/停滞", () => {
  assert.equal(canNavigate(v(0, 64, 0), v(NAV_MAX_DISTANCE, 64, 0)), true);
  assert.equal(canNavigate(v(0, 64, 0), v(16.5, 64, 0)), false);
  assert.equal(isArrived(1.4, 4, true), true); // |dy|=4 容差内
  assert.equal(isArrived(1.4, 4.1, true), false);
  assert.equal(isArrived(1.4, 0, false), false);
  assert.equal(isStuck(5, 0, 1, false), true);
});

test("CancelToken：幂等取消、signal 唤醒", async () => {
  const t = new CancelToken();
  assert.equal(t.cancelled, false);
  t.cancel();
  t.cancel();
  assert.equal(t.cancelled, true);
  await t.signal;
  const raced = await Promise.race([
    new Promise<string>((r) => setTimeout(() => r("slow"), 500)),
    t.signal.then(() => "woke"),
  ]);
  assert.equal(raced, "woke");
});
