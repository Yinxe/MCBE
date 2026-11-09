// ─── 实体种类武器偏好表单测（纯数据，node:test） ───────
// 覆盖 WeaponPreference：亡灵 → smite>sharpness 附魔链 + 剑>斧工具链
// （附魔 1 级优先，工具 2 级优先）；非亡灵 → sharpness 优先 + 剑>斧。

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupWeaponStrategy } from "../scripts/WeaponPreference";

test("lookupWeaponStrategy：亡灵 → 亡灵杀手>锋利（附魔 1 级），剑>斧（工具 2 级）", () => {
  const undead = {
    name: "undead-smite",
    enchantChain: ["smite", "sharpness"],
    toolChain: ["sword", "axe", "*"],
    fallback: "weapon",
  };
  assert.deepEqual(lookupWeaponStrategy("minecraft:zombie"), undead);
  assert.deepEqual(lookupWeaponStrategy("minecraft:drowned"), undead);
  assert.deepEqual(lookupWeaponStrategy("minecraft:skeleton_horse"), undead);
  assert.deepEqual(lookupWeaponStrategy("minecraft:phantom"), undead);
  assert.deepEqual(lookupWeaponStrategy("minecraft:husk"), undead);
});

test("lookupWeaponStrategy：非亡灵 → 锋利优先（附魔 1 级），剑>斧（工具 2 级）", () => {
  const sharp = {
    name: "sharpness-general",
    enchantChain: ["sharpness"],
    toolChain: ["sword", "axe", "*"],
    fallback: "weapon",
  };
  assert.deepEqual(lookupWeaponStrategy("minecraft:piglin"), sharp);
  assert.deepEqual(lookupWeaponStrategy("minecraft:creeper"), sharp);
  assert.deepEqual(lookupWeaponStrategy("minecraft:spider"), sharp);
  assert.deepEqual(lookupWeaponStrategy("minecraft:player"), sharp);
  assert.deepEqual(lookupWeaponStrategy("minecraft:iron_golem"), sharp);
});
