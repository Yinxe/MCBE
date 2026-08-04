import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

test("InMemoryKeyValueStore: 写读删", () => {
  const kv = new InMemoryKeyValueStore();
  assert.equal(kv.read("a"), undefined);
  kv.write("a", { n: 1 });
  assert.deepEqual(kv.read("a"), { n: 1 });
  kv.remove("a");
  assert.equal(kv.read("a"), undefined);
});

test("InMemoryKeyValueStore: 覆盖写", () => {
  const kv = new InMemoryKeyValueStore();
  kv.write("a", 1);
  kv.write("a", 2);
  assert.equal(kv.read("a"), 2);
});

test("InMemoryWarehouseStore: 列表/加载/保存/删除", () => {
  const store = new InMemoryWarehouseStore();
  const snapshot = {
    id: "w1",
    displayName: "主仓库",
    ownerId: "p1",
    members: [{ playerId: "p1", role: "owner" as const }],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
    settings: createDefaultSettings(),
    containerIds: ["c1"],
  };
  store.save(snapshot);
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.load("w1"), snapshot);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
});
