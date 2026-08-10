// ─── 方块偏好表单测（纯数据，node:test） ───────────────
// 覆盖 MinePreference：命中规则 → StrategyPref；未命中 → undefined（用默认策略）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupMineStrategy } from "../scripts/MinePreference";

test("lookupMineStrategy：命中规则返回首选策略", () => {
  assert.deepEqual(lookupMineStrategy("minecraft:grass_block"), { strategy: "silk" });
  assert.deepEqual(lookupMineStrategy("minecraft:podzol"), { strategy: "silk" });
  assert.deepEqual(lookupMineStrategy("minecraft:oak_leaves"), { strategy: "silk" });
});

test("lookupMineStrategy：未命中返回 undefined（走默认策略）", () => {
  assert.equal(lookupMineStrategy("minecraft:stone"), undefined);
  assert.equal(lookupMineStrategy("minecraft:diamond_ore"), undefined);
});
