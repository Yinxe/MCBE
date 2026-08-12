// ─── core/storage — InMemoryBotStore 行为 ──────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryBotStore } from "../scripts/core/storage/BotStore";
import { INVENTORY_SIZE } from "../scripts/core/model/Types";
import { makeItem, makeRecord } from "./helpers/factories";

function makeStore() {
  return new InMemoryBotStore();
}

test("记录：save/load/loadAll/remove 往返", () => {
  const store = makeStore();
  store.saveRecord(makeRecord("a"));
  store.saveRecord(makeRecord("b"));
  assert.equal(store.loadRecord("a")?.name, "a");
  assert.equal(store.loadRecord("x"), undefined);
  assert.equal(store.loadAllRecords().length, 2);
  store.removeRecord("a");
  assert.equal(store.loadAllRecords().length, 1);
});

test("记录：saveRecord 是拷贝（外部修改不影响已存数据）", () => {
  const store = makeStore();
  const record = makeRecord("a");
  store.saveRecord(record);
  record.online = true;
  assert.equal(store.loadRecord("a")?.online, false);
});

test("背包：saveInventory/loadInventory 往返（null 不占 found）", () => {
  const store = makeStore();
  const items: (ReturnType<typeof makeItem> | null)[] = new Array(INVENTORY_SIZE).fill(null);
  items[0] = makeItem("minecraft:diamond", 5);
  items[5] = makeItem("minecraft:stick", 2);
  store.saveInventory("a", items);

  const loaded = store.loadInventory("a");
  assert.ok(loaded);
  assert.equal(loaded.length, INVENTORY_SIZE);
  assert.equal(loaded[0]?.typeId, "minecraft:diamond");
  assert.equal(loaded[5]?.amount, 2);
  assert.equal(loaded[1], null);
});

test("背包：全空返回 undefined（调用方据此判断无需恢复）", () => {
  const store = makeStore();
  assert.equal(store.loadInventory("a"), undefined);
  // 保存全空数组（等价于删 key）
  store.saveInventory("a", new Array(INVENTORY_SIZE).fill(null));
  assert.equal(store.loadInventory("a"), undefined);
});

test("背包：saveSlot 单格保存 / null 删除", () => {
  const store = makeStore();
  store.saveSlot("a", 3, makeItem("minecraft:arrow", 10));
  assert.equal(store.loadInventory("a")?.[3]?.typeId, "minecraft:arrow");
  store.saveSlot("a", 3, null);
  // 删除后无任何格子 → loadInventory 返回 undefined
  assert.equal(store.loadInventory("a"), undefined);
});

test("背包：同名假人背包互不干扰", () => {
  const store = makeStore();
  store.saveSlot("a", 0, makeItem("minecraft:diamond"));
  store.saveSlot("b", 0, makeItem("minecraft:stick"));
  assert.equal(store.loadInventory("a")?.[0]?.typeId, "minecraft:diamond");
  assert.equal(store.loadInventory("b")?.[0]?.typeId, "minecraft:stick");
});

test("装备：saveEquipment/loadEquipment 往返，全空返回 undefined", () => {
  const store = makeStore();
  assert.equal(store.loadEquipment("a"), undefined);
  store.saveEquipment("a", { head: makeItem("minecraft:diamond_helmet"), chest: null });
  const loaded = store.loadEquipment("a");
  assert.ok(loaded);
  assert.equal(loaded.head?.typeId, "minecraft:diamond_helmet");
  assert.equal(loaded.chest, undefined); // null 槽不出现
});

test("装备：saveEquipSlot 单槽保存", () => {
  const store = makeStore();
  store.saveEquipSlot("a", "feet", makeItem("minecraft:golden_boots"));
  assert.equal(store.loadEquipment("a")?.feet?.typeId, "minecraft:golden_boots");
});

test("removeInventory：只清背包+装备，不动记录", () => {
  const store = makeStore();
  store.saveRecord(makeRecord("a"));
  store.saveSlot("a", 0, makeItem("minecraft:diamond"));
  store.saveEquipSlot("a", "head", makeItem("minecraft:diamond_helmet"));
  store.removeInventory("a");
  assert.equal(store.loadInventory("a"), undefined);
  assert.equal(store.loadEquipment("a"), undefined);
  assert.equal(store.loadRecord("a")?.name, "a"); // 记录保留
});