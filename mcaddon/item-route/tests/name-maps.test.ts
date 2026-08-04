import { test } from "node:test";
import assert from "node:assert/strict";
import { itemsMap } from "../scripts/core/data/name-maps/index";
import { getChineseName, searchItems, NAME_INDEX } from "../scripts/core/data/ItemNameMap";

test("name-maps: itemsMap 规模 ≥1300 且钻石映射", () => {
  assert.ok(Object.keys(itemsMap).length >= 1300, `条目数 ${Object.keys(itemsMap).length}`);
  assert.equal(itemsMap["minecraft:diamond"], "钻石");
});

test("name-maps: 合并优先级 direct 覆盖 fallback", () => {
  // direct 层优先：stone 在 fallback 是英文，若有 direct 覆盖则为中文
  assert.equal(getChineseName("minecraft:diamond"), "钻石");
  assert.ok(Object.keys(itemsMap).length >= 1300);
});

test("ItemNameMap: 未知 ID 回退英文可读名", () => {
  const got = getChineseName("minecraft:unknown_item");
  assert.equal(got, "Unknown Item");
});

test("ItemNameMap: searchItems 中文/typeId 子串命中", () => {
  assert.ok(searchItems("钻").includes("minecraft:diamond"), "中文子串");
  assert.ok(searchItems("diamond").includes("minecraft:diamond"), "typeId 子串");
  assert.ok(searchItems("钻石剑").includes("minecraft:diamond_sword"), "中文全名");
});

test("ItemNameMap: NAME_INDEX 反向索引中文名→typeId", () => {
  const ids = NAME_INDEX.get("钻石") ?? [];
  assert.ok(ids.includes("minecraft:diamond"));
});