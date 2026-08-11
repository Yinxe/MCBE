// ─── 工具选择引擎单测（纯逻辑，node:test） ─────────────
// 覆盖 ToolScorer 的角色判定 / 达标判定 / 命名策略（frugal/quality/durability/
// priority/weapon）/ 两级偏好组合（preferenceScorer：附魔 1 级 + 工具 2 级 +
// strict/exclude/crossEnchant）/ ToolSelector 双层 fallback / 耐久保护。全部
// 候选为纯数据构造，不依赖 @minecraft。镜像 item-route 的测试机制。

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReplacePool,
  createDefaultScorers,
  hitEnchantAny,
  isMineCapable,
  isUrgent,
  matchesTargetProfile,
  preferenceScorer,
  roleOf,
  ToolSelector,
  ABS_DURABILITY_FLOOR,
} from "../scripts/ToolScorer";
import { type PreferenceSpec, type RankableCandidate, type RankContext } from "../scripts/types";

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
const shearReq = { targets: [{ category: "shears" as const }], path: "keyword" };
const hoeReq = { targets: [{ category: "hoe" as const }], path: "keyword" };

/** 常用两级偏好规格（与偏好表一致） */
const SPEC = {
  undead: {
    name: "undead-smite",
    enchantChain: ["smite" as const, "sharpness" as const],
    toolChain: ["sword" as const, "axe" as const, "*" as const],
  },
  sharp: {
    name: "sharpness-general",
    enchantChain: ["sharpness" as const],
    toolChain: ["sword" as const, "axe" as const, "*" as const],
  },
  leaves: {
    name: "leaves-silk",
    enchantChain: ["silk" as const],
    toolChain: ["hoe" as const, "shears" as const, "*" as const],
    strict: true,
    crossEnchant: true,
  },
  crop: {
    name: "crop-fortune",
    enchantChain: ["fortune" as const],
    toolChain: ["hoe" as const, "*" as const],
    exclude: ["shovel" as const],
    strict: true,
    crossEnchant: true,
  },
  glass: {
    name: "glass-silk",
    enchantChain: ["silk" as const],
    toolChain: ["pickaxe" as const, "*" as const],
    strict: true,
  },
} satisfies Record<string, PreferenceSpec>;

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
  assert.equal(isMineCapable(iron, stoneReq, true), false);
  assert.equal(isMineCapable(silkHand, stoneReq, true), true);
  assert.equal(isMineCapable(iron, stoneReq, false), true);
  assert.equal(isMineCapable(silkHand, undefined, false), false);
  assert.equal(isMineCapable(iron, undefined, false), false);
});

test("isMineCapable：偏好驱动——跨类别附魔入池（树叶/农作物）+ 排除角色（时运锹）", () => {
  // 树叶：任意带精准的工具跨类别入池（即使不是剪子类别）
  assert.equal(isMineCapable(cand({ slot: 1, role: "pickaxe", silk: true }), shearReq, false, SPEC.leaves), true);
  assert.equal(isMineCapable(cand({ slot: 2, role: "shears" }), shearReq, false, SPEC.leaves), true); // 类别兜底
  // 农作物：时运锹被排除，时运非锹跨类别入池，普通锄按类别兜底
  assert.equal(isMineCapable(cand({ slot: 1, role: "shovel", fortune: 3 }), hoeReq, false, SPEC.crop), false);
  assert.equal(isMineCapable(cand({ slot: 2, role: "axe", fortune: 1 }), hoeReq, false, SPEC.crop), true);
  assert.equal(isMineCapable(cand({ slot: 3, role: "hoe" }), hoeReq, false, SPEC.crop), true);
  // 玻璃：wantsSilk 优先，只看带精准（不受偏好影响）
  assert.equal(isMineCapable(cand({ slot: 1, silk: true }), undefined, true, SPEC.glass), true);
  assert.equal(isMineCapable(cand({ slot: 2 }), undefined, true, SPEC.glass), false);
});

// ─── 命名策略排序 ──────────────────────────────────────

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

// ─── 两级偏好组合（preferenceScorer） ──────────────────

test("preferenceScorer：附魔 1 级优先（亡灵杀手 max → 锋利），同附魔下工具 2 级剑>斧", () => {
  const scorer = preferenceScorer(SPEC.undead);
  const pool = [
    cand({ slot: 2, role: "axe", tier: 6, smite: 0, sharpness: 5 }), // 锋利5 斧
    cand({ slot: 1, role: "sword", tier: 5, smite: 1, sharpness: 0 }), // 亡灵杀手1 剑
    cand({ slot: 3, role: "sword", tier: 4, smite: 5, sharpness: 0 }), // 亡灵杀手5 剑
  ];
  const ranked = scorer.rank(pool, mineCtx({ domain: "weapon" }))!;
  assert.equal(ranked[0]!.slot, 3); // smite5 剑（附魔 1 级最高）
  assert.equal(ranked[1]!.slot, 1); // smite1 剑 > 锋利5 斧（附魔 1 级压过工具 2 级）
  assert.equal(ranked[2]!.slot, 2);
});

test("preferenceScorer：工具 2 级优先——同锋利等级下剑→斧→其它", () => {
  const scorer = preferenceScorer(SPEC.sharp);
  const pool = [
    cand({ slot: 1, role: "axe", tier: 6, sharpness: 2 }),
    cand({ slot: 2, role: "sword", tier: 4, sharpness: 2 }),
    cand({ slot: 3, role: "sword", tier: 4, sharpness: 5 }),
  ];
  const ranked = scorer.rank(pool, mineCtx({ domain: "weapon" }))!;
  assert.equal(ranked[0]!.slot, 3); // 锋利5
  assert.equal(ranked[1]!.slot, 2); // 同锋利2 → 剑优先于斧
  assert.equal(ranked[2]!.slot, 1);
});

test("preferenceScorer：树叶精准优先，锄>剪>其它任意精准工具；strict 无精准 → null", () => {
  const scorer = preferenceScorer(SPEC.leaves);
  const pool = [
    cand({ slot: 1, role: "pickaxe", tier: 6, silk: true }), // 其它任意精准
    cand({ slot: 2, role: "shears", tier: 4, silk: true }), // 精准剪
    cand({ slot: 3, role: "hoe", tier: 3, silk: true }), //    精准锄
    cand({ slot: 4, role: "shears", tier: 4 }), //             无精准（类别兜底）
  ];
  const ranked = scorer.rank(pool, mineCtx({}))!;
  assert.equal(ranked[0]!.slot, 3); // 锄
  assert.equal(ranked[1]!.slot, 2); // 剪
  assert.equal(ranked[2]!.slot, 1); // 其它任意精准
  assert.equal(ranked[3]!.slot, 4); // 无精准兜底
  assert.equal(scorer.rank([cand({ slot: 9, role: "shears" })], mineCtx({})), null); // strict：全无精准
});

test("preferenceScorer：农作物时运优先（锄>任意）+ 时运锹排除；strict 无时运 → null", () => {
  const scorer = preferenceScorer(SPEC.crop);
  const pool = [
    cand({ slot: 1, role: "shovel", tier: 6, fortune: 3 }), // 时运锹 → 排除
    cand({ slot: 4, role: "hoe", tier: 6, fortune: 1 }), //   时运锄
    cand({ slot: 3, role: "hoe", tier: 4, fortune: 1 }), //   时运锄
    cand({ slot: 2, role: "axe", tier: 6, fortune: 1 }), //   时运斧（非锹跨类别）
  ];
  const ranked = scorer.rank(pool, mineCtx({}))!;
  assert.equal(ranked[0]!.slot, 4); // 同时运1 → 锄（tier6）> 锄（tier4）
  assert.equal(ranked[1]!.slot, 3);
  assert.equal(ranked[2]!.slot, 2); // 斧（时运+非锹）
  assert.equal(
    ranked.some((c) => c.slot === 1),
    false
  ); // 时运锹不在列表
  assert.equal(scorer.rank([cand({ slot: 1, role: "shovel", fortune: 3 })], mineCtx({})), null); // 唯一候选被排除
});

test("preferenceScorer：只能收镐时即品质优先；tieBreak=durability 时按耐久", () => {
  const ore = preferenceScorer({ name: "ore-quality", enchantChain: [], toolChain: ["pickaxe"] });
  const pool = [cand({ slot: 1, tier: 3, durabilityRatio: 0.9 }), cand({ slot: 2, tier: 5, durabilityRatio: 0.1 })];
  assert.equal(ore.rank(pool, mineCtx({}))![0]!.slot, 2); // 品质优先（tier）
  const hardy = preferenceScorer({
    name: "durability-first",
    enchantChain: [],
    toolChain: ["pickaxe"],
    tieBreak: "durability",
  });
  assert.equal(hardy.rank(pool, mineCtx({}))![0]!.slot, 1); // 耐久占比优先
});

test("hitEnchantAny：跨类别附魔池命中判定", () => {
  assert.equal(hitEnchantAny(cand({ slot: 1, fortune: 2 }), ["fortune"]), true);
  assert.equal(hitEnchantAny(cand({ slot: 1 }), ["fortune"]), false);
  assert.equal(hitEnchantAny(cand({ slot: 1, smite: 4 }), ["smite", "sharpness"]), true);
  assert.equal(hitEnchantAny(cand({ slot: 1, silk: true }), ["silk"]), true);
});

// ─── ToolSelector 决策（含双层 fallback） ──────────────

test("decide：空候选池 → 保持（无适用工具）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const d = selector.decide([], mineCtx({ blockRequirement: stoneReq }));
  assert.equal(d.action, "keep");
});

test("decide：普通挖掘 → 换入最优候选（默认 frugal）", () => {
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
  const d = selector.decide(pool, mineCtx({ blockRequirement: stoneReq }), "no-such-strategy");
  assert.equal(d.action, "swap"); // 仍按默认 frugal 决策
  assert.equal(d.slot, 3);
});

test("decide：silk 偏好但无带精准工具 → 横向 fallback 到默认（保持达标主手）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const current = cand({ slot: 0, role: "shears", tier: 4, isCurrent: true }); // 达标剪、无精准
  const bag = [current, cand({ slot: 5, role: "pickaxe", tier: 6 })];
  const d = selector.decide(bag, mineCtx({ blockRequirement: shearReq }), SPEC.leaves);
  assert.equal(d.action, "keep");
});

test("decide：武器域默认用 weapon 策略（剑优先于更高品质斧）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const pool = [cand({ slot: 3, role: "axe", tier: 6 }), cand({ slot: 1, role: "sword", tier: 3 })];
  const d = selector.decide(pool, mineCtx({ domain: "weapon" }));
  assert.equal(d.action, "swap");
  assert.equal(d.slot, 1); // 剑优先
});

test("decide：武器域亡灵 → 附魔 1 级（亡灵杀手>锋利）优先于默认剑", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:zombie" });
  const pool = [
    cand({ slot: 6, role: "axe", tier: 6, smite: 5 }),
    cand({ slot: 1, role: "sword", tier: 5, sharpness: 4 }),
  ];
  const d = selector.decide(pool, ctx, SPEC.undead);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 6); // smite5 斧 > 锋利4 剑（附魔 1 级）
});

test("decide：武器域亡灵无亡灵杀手 → sharpness 接上（附魔 1 级第二键）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:skeleton" });
  const pool = [
    cand({ slot: 2, role: "axe", tier: 6 }), // 无附魔
    cand({ slot: 1, role: "sword", sharpness: 4 }),
  ];
  const d = selector.decide(pool, ctx, SPEC.undead);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 1); // sharpness4 > 无附魔
});

test("decide：武器域亡灵全场无附魔 → 工具 2 级（剑 > 斧）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "weapon");
  const ctx = mineCtx({ domain: "weapon", entityTypeId: "minecraft:zombie" });
  const pool = [cand({ slot: 2, role: "axe", tier: 6 }), cand({ slot: 1, role: "sword", tier: 5 })];
  const d = selector.decide(pool, ctx, SPEC.undead);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 1); // 剑（工具 2 级）
});

test("decide：农作物 → 时运锄优先；背包只剩余时运锹 → 横向 fallback 到默认（类别兜底）", () => {
  const selector = new ToolSelector(createDefaultScorers(), "frugal");
  const pool = [cand({ slot: 5, role: "shovel", fortune: 3 }), cand({ slot: 6, role: "hoe", fortune: 1 })];
  const ctx = mineCtx({ blockRequirement: hoeReq });
  const d = selector.decide(pool, ctx, SPEC.crop);
  assert.equal(d.action, "swap");
  assert.equal((d as { slot: number }).slot, 6); // 时运锄（锹被排除）
  // 背包只剩余时运锹：buildMinePool 已按 isMineCapable 排除锹 → 池空 → 保持（不为锹而换）
  const onlyShovel = [cand({ slot: 5, role: "shovel", fortune: 3 })];
  const builderPool = onlyShovel.filter((c) => isMineCapable(c, hoeReq, false, SPEC.crop));
  assert.deepEqual(builderPool, []);
  const d2 = selector.decide(builderPool, ctx, SPEC.crop);
  assert.equal(d2.action, "keep");
});

// ─── 耐久保护 ──────────────────────────────────────────

test("isUrgent：占比低于阈值 / 绝对剩余低于下限即紧急", () => {
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.05 }), 0.1, ABS_DURABILITY_FLOOR), true);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.2 }), 0.1, ABS_DURABILITY_FLOOR), false);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.9, durability: 5 }), 0.1, ABS_DURABILITY_FLOOR), true);
});

test("isUrgent：绝对下限可配置——取占比阈值折算与下限的较大值", () => {
  // 占比达标（90%）但剩余 5 点 → floor=16 紧急；floor=1 不紧急（穿下限生效需占比也到阈值）
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.9, durability: 5 }), 0.1, 16), true);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.9, durability: 20 }), 0.1, 16), false);
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.9, durability: 5 }), 0.1, 1), false);
  // 两路都要低才不紧急（等价于 remaining < max(threshold*max, floor)）
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.05, durability: 10 }), 0.1, 16), true); // 占比低
  assert.equal(isUrgent(cand({ slot: 1, durabilityRatio: 0.05, durability: 10 }), 0.1, 1), true); // 占比仍低
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

test("buildReplacePool：绝不降级——旧高品质、背包仅更低品质同类 → null", () => {
  const old = cand({ slot: 0, tier: 5, durability: 10, durabilityRatio: 0.04 }); // 钻石镐
  const bag = [cand({ slot: 3, tier: 3, durability: 240, durabilityRatio: 0.96 })]; // 铁镐更耐久
  assert.equal(buildReplacePool(old, bag, 0.1), null); // 不换（宁保持），不改品质降级
});

test("buildReplacePool：同/更高品质可替换，同款优先于更高品质其它同类", () => {
  const old = cand({ slot: 0, typeId: "minecraft:diamond_pickaxe", tier: 5, durability: 10, durabilityRatio: 0.04 });
  const bag = [
    cand({ slot: 2, typeId: "minecraft:diamond_pickaxe", tier: 5, durability: 240, durabilityRatio: 0.96 }),
    cand({ slot: 4, typeId: "minecraft:netherite_pickaxe", tier: 6, durability: 300, durabilityRatio: 0.9 }),
  ];
  const target = buildReplacePool(old, bag, 0.1);
  assert.equal(target!.slot, 2); // 同 typeId 组优先，其次才更高品质
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
