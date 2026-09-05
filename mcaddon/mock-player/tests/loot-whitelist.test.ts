// ─── 磁吸掉落物白名单单测（rules/fishing + rules/woodcut） ──
// 纯数据清单防回退：关键物品必须在册（树苗/鱼获——方块 id ≠ 物品 id 的教训）

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FISHING_LOOT_TYPES } from "../scripts/rules/fishing/LootWhitelist";
import { WOODCUT_LOOT_TYPES } from "../scripts/rules/woodcut/LootWhitelist";

describe("WOODCUT_LOOT_TYPES（砍树磁吸白名单）", () => {
  it("圆木本体在册（与方块 id 一致）", () => {
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:oak_log"));
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:spruce_log"));
  });
  it("树叶掉落物在册（树苗——方块 id ≠ 物品 id 的核心教训）", () => {
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:oak_sapling"));
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:acacia_sapling"));
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:mangrove_propagule"));
  });
  it("树叶方标本体不在册（破坏后掉的是树苗不是 leaves——防误加）", () => {
    assert.ok(!WOODCUT_LOOT_TYPES.includes("minecraft:oak_leaves"));
  });
  it("果实/木棍在册", () => {
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:apple"));
    assert.ok(WOODCUT_LOOT_TYPES.includes("minecraft:stick"));
  });
});

describe("FISHING_LOOT_TYPES（钓鱼磁吸白名单）", () => {
  it("鱼获在册", () => {
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:cod"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:salmon"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:pufferfish"));
  });
  it("钓到物在册（墨囊/贝壳/鞍/名牌）", () => {
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:ink_sac"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:nautilus_shell"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:saddle"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:name_tag"));
  });
  it("钓鱼垃圾可拾物在册（腐肉/碗/木棍）", () => {
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:rotten_flesh"));
    assert.ok(FISHING_LOOT_TYPES.includes("minecraft:bowl"));
  });
});
