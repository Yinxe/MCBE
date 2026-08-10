// ─── 实体种类武器偏好表单测（纯数据，node:test） ───────
// 覆盖 WeaponPreference：非亡灵 → undefined（默认武器策略）；
// 亡灵 → smite 优先 + sharpness 纵向 fallback。

import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupWeaponStrategy } from "../scripts/WeaponPreference";

test("lookupWeaponStrategy：亡灵 → smite 优先 + sharpness fallback", () => {
  assert.deepEqual(lookupWeaponStrategy("minecraft:zombie"), { strategy: "smite", fallbackChain: ["sharpness"] });
  assert.deepEqual(lookupWeaponStrategy("minecraft:skeleton_horse"), {
    strategy: "smite",
    fallbackChain: ["sharpness"],
  });
  assert.deepEqual(lookupWeaponStrategy("minecraft:drowned"), { strategy: "smite", fallbackChain: ["sharpness"] });
  assert.deepEqual(lookupWeaponStrategy("minecraft:phantom"), { strategy: "smite", fallbackChain: ["sharpness"] });
});

test("lookupWeaponStrategy：非亡灵 → undefined（走默认武器策略）", () => {
  assert.equal(lookupWeaponStrategy("minecraft:piglin"), undefined);
  assert.equal(lookupWeaponStrategy("minecraft:creeper"), undefined);
  assert.equal(lookupWeaponStrategy("minecraft:spider"), undefined);
  assert.equal(lookupWeaponStrategy("minecraft:player"), undefined);
  assert.equal(lookupWeaponStrategy("minecraft:iron_golem"), undefined);
});
