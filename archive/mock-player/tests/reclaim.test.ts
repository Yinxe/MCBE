// ─── core/service — 回收规划 ───────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FULL_OPTIONS, hasAnyArmor, isFullReclaim, serializedToPreview, formatItemPreview,
  buildInventorySummary, buildOfflineReclaimPreview,
} from "../scripts/service/ReclaimPlanner";
import { makeItem, makeRecord, emptyInventory } from "./helpers/factories";

test("FULL_OPTIONS：全量回收判定", () => {
  assert.equal(isFullReclaim(FULL_OPTIONS), true);
  assert.equal(isFullReclaim({ xp: true }), false);
  assert.equal(isFullReclaim({ ...FULL_OPTIONS, inventory: false }), false);
});

test("hasAnyArmor：任一护甲槽勾选", () => {
  assert.equal(hasAnyArmor({ head: true }), true);
  assert.equal(hasAnyArmor({ chest: true }), true);
  assert.equal(hasAnyArmor({ legs: true }), true);
  assert.equal(hasAnyArmor({ feet: true }), true);
  assert.equal(hasAnyArmor({}), false);
  assert.equal(hasAnyArmor({ offhand: true, inventory: true }), false);
});

test("serializedToPreview：字段映射", () => {
  const preview = serializedToPreview(makeItem("minecraft:diamond_sword", 1, {
    nameTag: "神剑",
    damage: 3,
    enchantments: [{ id: "sharpness", level: 5 }],
  }));
  assert.deepEqual(preview, {
    typeId: "minecraft:diamond_sword",
    amount: 1,
    nameTag: "神剑",
    damage: 3,
    enchantments: [{ id: "sharpness", level: 5 }],
  });
});

test("formatItemPreview：名称 + 数量 + 耐久 + 附魔", () => {
  const text = formatItemPreview({
    typeId: "minecraft:diamond_sword",
    amount: 2,
    damage: 3,
    maxDurability: 1561,
    enchantments: [{ id: "sharpness", level: 5 }],
  });
  assert.equal(text, "diamond_sword x2 [1558/1561] §9锋利V");
});

test("formatItemPreview：中文附魔名 + 无耐久/无附魔", () => {
  const noDur = formatItemPreview({ typeId: "minecraft:diamond", amount: 1, enchantments: [] });
  assert.equal(noDur, "diamond");
  const ench = formatItemPreview({ typeId: "minecraft:bow", amount: 1, enchantments: [{ id: "power", level: 3 }] });
  assert.equal(ench, "bow §9力量III");
});

test("formatItemPreview：nameTag 优先显示", () => {
  const text = formatItemPreview({ typeId: "minecraft:stick", amount: 1, nameTag: "打狗棒", enchantments: [] });
  assert.equal(text, "打狗棒");
});

test("buildInventorySummary：前 3 种 + 省略提示", () => {
  assert.equal(buildInventorySummary({}), "空");
  assert.equal(buildInventorySummary({ diamond: 5 }), "diamond×5");
  const summary = buildInventorySummary({ diamond: 1, stick: 2, stone: 3, wood: 4 });
  assert.equal(summary, "diamond, stick×2, stone×3, 还有1种");
});

test("buildOfflineReclaimPreview：主手取热栏第一格", () => {
  const inv = emptyInventory();
  inv[2] = makeItem("minecraft:diamond_sword");
  inv[9] = makeItem("minecraft:diamond");
  const preview = buildOfflineReclaimPreview(makeRecord("bot1"), inv, {});
  assert.equal(preview.mainhand?.typeId, "minecraft:diamond_sword");
  assert.match(preview.inventorySummary, /diamond/);
});

test("buildOfflineReclaimPreview：无背包数据时主手为 null", () => {
  const preview = buildOfflineReclaimPreview(makeRecord("bot1"), undefined, undefined);
  assert.equal(preview.mainhand, null);
  assert.equal(preview.inventorySummary, "空");
});

test("buildOfflineReclaimPreview：装备槽映射 + 经验", () => {
  const preview = buildOfflineReclaimPreview(
    makeRecord("bot1", { experience: { level: 10, xpProgress: 0, totalXp: 100 } }),
    undefined,
    { head: makeItem("minecraft:diamond_helmet") }
  );
  assert.equal(preview.head?.typeId, "minecraft:diamond_helmet");
  assert.equal(preview.offhand, null);
  assert.deepEqual(preview.xp, { level: 10, totalXp: 100 });
});

test("buildOfflineReclaimPreview：无经验返回 xp=null", () => {
  const preview = buildOfflineReclaimPreview(makeRecord("bot1"), undefined, undefined);
  assert.equal(preview.xp, null);
});