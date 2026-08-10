// ─── 工具选择引擎单测（纯逻辑，node:test） ─────────────
// 覆盖 ToolScorer 的角色判定 / 达标判定 / 各内置策略排序 /
// ToolSelector 双层 fallback 与"无适用→保持"。全部候选为纯数据构造，
// 不依赖 @minecraft。镜像 item-route 的测试机制（tsconfig.test.json 单独
// 编译纯模块 + tests）。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplacePool,
  createDefaultScorers,
  isMineCapable,
  isUrgent,
  matchesTargetProfile,
  roleOf,
  ToolSelector,
  ABS_DURABILITY_FLOOR,
} from "../scripts/ToolScorer";
import { type RankableCandidate, type RankContext } from "../scripts/types";

// ─── 构造候选的辅助 ────────────────────────────────────

function cand(partial: Partial<RankableCandidate> & { slot: number }): RankableCandidate {
  return {
    typeId: "minecraft:iron_pickaxe",
    role: "pickaxe",
    tier: 3,
    durability: 100,
    maxDurability: 250,
    durabilityRatio: 0.4,
    silk: false,
    efficiency: 0,
    fortune: 0,
    smite: 0,
    sharpness: 0,
    ...partial,
  };
}

function mineCtx(overrides: Partial<RankContext> = {}): RankContext {
  return { playerName: "Tester", domain: "mine", blockTypeId: "minecraft:stone", ...overrides };
}

const stoneReq = { targets: [{ category: "pickaxe" as const }], path: "keyword" };

// ─── 角色判定 ──────────────────────────────────────────

test("roleOf 识别工具/武器类别，其他返回 undefined", () => {
  assert.equal(roleOf("minecraft:iron_pickaxe"), "pickaxe");
  assert.equal(roleOf("minecraft:netherite_axe"), "axe");
  assert.equal(roleOf("minecraft:golden_shovel"), "shovel");
  assert.equal(roleOf("minecraft:shears"), "shears");
  assert.equal(roleOf("minecraft:diamond_sword"), "sword");
  assert.equal(roleOf("minecraft:mace"), "mace");
  assert.equal(roleOf("minecraft:trident"), "trident");
  assert.equal(roleOf("minecraft:bow"), "bow");
  assert.equal(roleOf("minecraft:crossbow"), "crossbow");
  assert.equal(roleOf("minecraft:apple"), undefined);
  assert.equal(roleOf("minecraft:stone"), undefined);
  assert.equal(roleOf("custom:wand"), undefined);
});

// ─── 达标判定 ──────────────────────────────────────────

test("matchesTargetProfile：类别 + 最低品质 + 精准采集约束", () => {
  const iron = cand({ slot: 1, tier: 3 });
  assert.equal(matchesTargetProfile(iron, { category: "pickaxe" }), true);
  assert.equal(matchesTargetProfile(iron, { category: "pickaxe", minTier: 3 }), true);
  assert.equal(matchesTargetProfile(iron, { category: "pickaxe", minTier: 4 }), false);
  assert.equal(matchesTargetProfile(iron, { category: "shovel" }), false);
  assert.equal(matchesTargetProfile(cand({ slot: 2, silk: true }), { category: "pickaxe", silk: true }), true);
  assert.equal(matchesTargetProfile(iron, { category: "pickaxe", silk: true }), false);
});

test("isMineCapable：精准采集方块只看 silk，普通方块匹配任一目标", () => {
  const iron = cand({ slot: 1 });
  const silkHand = cand({ slot: 2, silk: true });
  // wantsSilk 优先：即使有 req 也只收 silk（玻璃/冰的语义，跨类别找带精准的工具）
  assert.equal(isMineCapable(iron, stoneReq, true), false);
  assert.equal(isMineCapable(silkHand, stoneReq, true), true);
  // 普通方块按 req
  assert.equal(isMineCapable(iron, stoneReq, false), true);
  assert.equal(isMineCapable(silkHand, undefined, false), false);
  // 无需求无非需 → 不认识 → 不干预
  assert.equal(isMineCapable(iron, undefined, false), false);
});

// ─── 内置策略排序 ──────────────────────────────────────

test("frugal：无主手时按目标优先级 → 品质 → 耐久", () => {
  const scorers = createDefaultScorers();
  const frugal = scorers.get("frugal")!;
  const pool = [
    cand({ slot: 2, role: "shovel", tier: 4, durabilityRatio: 0.9 }),
    cand({ slot: 1, tier: 3, durabilityRatio: 0.5 }),
    cand({ slot: 3, tier: 5, durabilityRatio: 0.8 }),
  ];
  const req = { targets: [{ category: "pickaxe" as const }, { category: "shovel" as const }], path: "x" };
  const ranked = frugal!.rank(pool, mineCtx({ blockRequirement: req }));
  assert.equal(ranked![0]!.slot, 3); // 镐优先级第 0 组，槽 3 品质最高
});

test("frugal：主手达标 → 保持（排第 0，不择优）", () => {
  const scorers = createDefaultScorers();
  const frugal = scorers.get("frugal")!;
  const current = cand({ slot: 0, tier: 3, durabilityRatio: 0.2, isCurrent: true });
  const pool = [cand({ slot: 5, tier: 5, durabilityRatio: 0.9 }), current];
  const ranked = frugal!.rank(pool, mineCtx({ blockRequirement: stoneReq }));
  assert.equal(ranked![0]!.isCurrent, true);
  assert.equal(ranked![0]!.slot, 0);
});

test("quality：不给主手特权，品质最高者排前（会升级）", () => {
  const scorers = createDefaultScorers();
  const quality = scorers.get("quality")!;
  const current = cand({ slot: 0, tier: 3, durabilityRatio: 0.9, isCurrent: true });
  const diamond = cand({ slot: 4, tier: 5, durabilityRatio: 0.1 });
  const ranked = quality!.rank([current, diamond], mineCtx({}));
  assert.equal(ranked![0]!.slot, 4);
});

test("durability：剩余占比最高者排前，占比相同比品质", () => {
  const scorers = createDefaultScorers();
  const durability = scorers.get("durability")!;
  const pool = [
    cand({ slot: 1, tier: 5, durabilityRatio: 0.5 }),
    cand({ slot: 2, tier: 3, durabilityRatio: 0.95 }),
    cand({ slot: 3, tier: 6, durabilityRatio: 0.95 }),
  ];
  const ranked = durability!.rank(pool, mineCtx({}));
  assert.equal(ranked![0]!.slot, 3); // 0.95 平 → 下界合金
});

test("silk：带精准采集者排前；全员无精准 → null", () => {
  const scorers = createDefaultScorers();
  const silk = scorers.get("silk")!;
  const pool = [cand({ slot: 1, tier: 5 }), cand({ slot: 2, silk: true, tier: 3 })];
  assert.equal(silk!.rank(pool, mineCtx({}))![0]!.slot, 2);
  assert.equal(silk!.rank([cand({ slot: 5 })], mineCtx({})), null);
});

test("efficiency：效率附魔越高越优先；全员无效率 → null", () => {
  const scorers = createDefaultScorers();
  const efficiency = scorers.get("efficiency")!;
  const pool = [cand({ slot: 1, efficiency: 0, tier: 6 }), cand({ slot: 2, efficiency: 3, tier: 3 })];
  assert.equal(efficiency!.rank(pool, mineCtx({}))![0]!.slot, 2);
  assert.equal(efficiency!.rank([cand({ slot: 5 })], mineCtx({})), null);
});

test("priority：严格按 targets 优先级，忽略品质（无主手特权）", () => {
  const scorers = createDefaultScorers();
  const priority = scorers.get("priority")!;
  const req = { targets: [{ category: "axe" as const }, { category: "shovel" as const }], path: "x" };
  const pool = [
    cand({ slot: 2, role: "shovel", tier: 5, durabilityRatio: 1 }),
    cand({ slot: 4, role: "axe", tier: 2, durabilityRatio: 1 }),
  ];
  assert.equal(priority!.rank(pool, mineCtx({ blockRequirement: req }))![0]!.slot, 4); // 斧第 0 组优先
});

test("weapon：剑 → 斧 → 重锤/三叉戟（其他平等），组内品质/耐久", () => {
  const scorers = createDefaultScorers();
  const weapon = scorers.get("weapon")!;
  const pool = [
    cand({ slot: 2, role: "mace", tier: 2, durabilityRatio: 1 }),
    cand({ slot: 9, role: "trident", tier: 2, durabilityRatio: 1 }),
    cand({ slot: 3, role: "axe", tier: 6 }),
    cand({ slot: 1, role: "sword", tier: 4 }),
  ];
  const ranked = weapon!.rank(pool, mineCtx({ domain: "weapon" }));
  assert.equal(ranked![0]!.slot, 1); // 剑第 0 组
  assert.equal(ranked![1]!.slot, 3); // 斧第 1 组
  // 重锤/三叉戟同组平等 → 品质/耐久决胜（同为 tier2、ratio=1 → 保持槽位序）
  assert.equal(ranked![2]!.slot, 2);
  assert.equal(ranked![3]!.slot, 9);
});

test("smite：亡灵杀手等级最高者优先（无视武器类别）；全员无亡灵杀手 → null", () => {
  const scorers = createDefaultScorers();
  const smite = scorers.get("smite")!;
  const pool = [
    cand({ slot: 1, role: "sword", tier: 5, smite: 3, sharpness: 2 }),
    cand({ slot: 2, role: "axe", tier: 6, smite: 5 }),
    cand({ slot: 3, role: "sword", tier: 5, sharpness: 4 }),
  ];
  assert.equal(smite!.rank(pool, mineCtx({ domain: "weapon" }))![0]!.slot, 2); // smite5 的斧优先
  assert.equal(smite!.rank([cand({ slot: 9, role: "sword", sharpness: 3 })], mineCtx({})), null);
});

test("sharpness：锋利等级最高者优先；全员无锋利 → null", () => {
  const scorers = createDefaultScorers();
  const sharpness = scorers.get("sharpness")!;
  const pool = [
    cand({ slot: 1, role: "sword", tier: 5, smite: 3 }),
    cand({ slot: 2, role: "axe", tier: 6, sharpness: 2 }),
    cand({ slot: 3, role: "sword", tier: 5, sharpness: 4 }),
  ];
  assert.equal(sharpness!.rank(pool, mineCtx({ domain: "weapon" }))![0]!.slot, 3);
  assert.equal(sharpness!.rank([cand({ slot: 9, role: "sword", smite: 2 })], mineCtx({})), null);
});

test("decide：武器域对亡灵偏好 → 老 sk锋优先链（smite → sharpness → 默认）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:zombie" });
  const pref = { strategy: "smite", fallbackChain: ["sharpness"] };
  const pool = [
    cand({ slot: 6, role: "axe", tier: 6, smite: 5 }),
    cand({ slot: 1, role: "sword", tier: 5, sharpness: 4 }),
  ];
  assert.equal(selector.decide(pool, ctx, pref).action, "swap");
  assert.equal((selector.decide(pool, ctx, pref) as { slot: number }).slot, 6); // smite 优先于默认剑
});

test("decide：武器域对亡灵但无 smite → sharpness 接上", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:skeleton" });
  const pref = { strategy: "smite", fallbackChain: ["sharpness"] };
  const pool = [
    cand({ slot: 2, role: "axe", tier: 6 }), // 无 smite 无 sharpness
    cand({ slot: 1, role: "sword", sharpness: 4 }),
  ];
  const d = selector.decide(pool, ctx, pref);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 1); // smite 全 0 → sharpness 覆盖
});

test("decide：武器域对亡灵但全场无附魔 → 落到默认 weapon 策略（剑优先）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:zombie" });
  const pref = { strategy: "smite", fallbackChain: ["sharpness"] };
  const pool = [cand({ slot: 2, role: "axe", tier: 6 }), cand({ slot: 1, role: "sword", tier: 5 })];
  const d = selector.decide(pool, ctx, pref);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 1); // 剑（默认第 0 组）
});

// ─── ToolSelector 决策（含双层 fallback） ──────────────

test("decide：空候选池 → 保持（无适用工具）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const d = selector.decide([], mineCtx({ blockRequirement: stoneReq }));
  assert.equal(d.action, "keep");
});

test("decide：普通挖掘 → 换入最优候选（+ 默认挖掘策略）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const pool = [cand({ slot: 5, tier: 5, durabilityRatio: 0.9 })];
  const d = selector.decide(pool, mineCtx({ blockRequirement: stoneReq }));
  assert.equal(d.action, "swap");
  assert.equal(d.slot, 5);
});

test("decide：主手达标排第 0 → 保持", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const current = cand({ slot: 0, isCurrent: true });
  const d = selector.decide([current, cand({ slot: 2, tier: 5 })], mineCtx({ blockRequirement: stoneReq }));
  assert.equal(d.action, "keep");
});

test("decide：偏好策略未注册 → 垂直 fallback 到默认策略", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const pool = [cand({ slot: 3, tier: 5 })];
  const d = selector.decide(pool, mineCtx({ blockRequirement: stoneReq }), { strategy: "no-such-strategy" });
  assert.equal(d.action, "swap"); // 仍按默认 frugal 决策
  assert.equal(d.slot, 3);
});

test("decide：silk 偏好但无带精准工具 → 横向 fallback 到默认策略", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const current = cand({ slot: 0, isCurrent: true }); // 达标（镐）主手
  const bag = [cand({ slot: 4, tier: 5 }), current];
  const d = selector.decide(bag, mineCtx({ blockRequirement: stoneReq }), { strategy: "silk" });
  assert.equal(d.action, "keep"); // silk 表达不了（无 silk）→ 落到默认，主手达标保持
});

test("decide：武器域默认用 weapon 策略（剑优先于更高品质斧）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const pool = [cand({ slot: 3, role: "axe", tier: 6 }), cand({ slot: 1, role: "sword", tier: 3 })];
  const d = selector.decide(pool, mineCtx({ domain: "weapon" }));
  assert.equal(d.action, "swap");
  assert.equal(d.slot, 1); // 剑优先
});

// ─── 耐久保护 ──────────────────────────────────────────

test("isUrgent：占比低于阈值 / 绝对剩余低于下限即紧急", () => {
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.05 }), 0.1, ABS_DURABILITY_FLOOR), true);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.2 }), 0.1, ABS_DURABILITY_FLOOR), false);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.9, durability: 5 }), 0.1, ABS_DURABILITY_FLOOR), true);
});

test("buildReplacePool：严格更耐久 + 占比达标才入选，同 typeId 优先", () => {
  const old = cand({ slot: 0, tier: 3, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    cand({ slot: 3, typeId: "minecraft:iron_pickaxe", tier: 3, durability: 240, durabilityRatio: 0.96 }),
    cand({ slot: 4, typeId: "minecraft:diamond_pickaxe", tier: 5, durability: 300, durabilityRatio: 0.9 }),
  ];
  const target = buildReplacePool(old, bag, 0.1);
  assert.equal(target!.slot, 3); // 同 typeId 组优先于更高品质
});

test("buildReplacePool：无更耐久的候选 → null（不降级）", () => {
  const old = cand({ slot: 0, tier: 3, durability: 200, durabilityRatio: 0.8 });
  const bag = [cand({ slot: 3, tier: 3, durability: 150, durabilityRatio: 0.6 })];
  assert.equal(buildReplacePool(old, bag, 0.1), null);
});

test("buildReplacePool：候选占比不达标也排除", () => {
  const old = cand({ slot: 0, durability: 10, durabilityRatio: 0.04 });
  const bag = [cand({ slot: 3, durability: 20, durabilityRatio: 0.08 })]; // 更耐久但占比不达标
  assert.equal(buildReplacePool(old, bag, 0.1), null);
});

test("buildReplacePool：旧带精准 → 优先同 typeId 且带精准的同款", () => {
  const old = cand({ slot: 0, typeId: "minecraft:iron_pickaxe", silk: true, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    cand({ slot: 2, typeId: "minecraft:iron_pickaxe", silk: true, durability: 240, durabilityRatio: 0.96 }),
    cand({ slot: 4, typeId: "minecraft:diamond_pickaxe", silk: false, durability: 300, durabilityRatio: 0.9 }),
  ];
  const target = buildReplacePool(old, bag, 0.1);
  assert.equal(target!.slot, 2); // 同款且带精准（保留精准属性），优于更高品质但不带精准
});

test("buildReplacePool：排除旧槽位自身", () => {
  const old = cand({ slot: 0, durability: 10, durabilityRatio: 0.04 });
  const bag = [cand({ slot: 0, durability: 999, durabilityRatio: 0.99 })]; // 同槽（不可能但也防）
  assert.equal(buildReplacePool(old, bag, 0.1), null);
});
