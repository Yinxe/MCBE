import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McWarehouseStore } from "../scripts/mc/storage/McWarehouseStore";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { WarehouseSnapshot } from "../scripts/core/storage/Stores";

const snapshot = (id: string): WarehouseSnapshot => ({
  id,
  displayName: `仓库${id}`,
  ownerId: "p1",
  members: [{ playerId: "p1", role: "owner" as const }],
  area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
  settings: createDefaultSettings(),
  containerIds: ["c1", "c2"],
});

function makeStore() {
  const kv = new InMemoryKeyValueStore();
  return { kv, store: new McWarehouseStore(new ShardStore(kv)) };
}

test("McWarehouseStore: 注册/列表/加载/删除", () => {
  const { store } = makeStore();
  assert.deepEqual(store.list(), []);
  store.save(snapshot("w1"));
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.load("w1")?.displayName, "仓库w1");
  store.save(snapshot("w2"));
  assert.equal(store.list().length, 2);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
  assert.equal(store.list().length, 1);
});

test("McWarehouseStore: 覆盖更新不产生重复注册", () => {
  const { store } = makeStore();
  store.save(snapshot("w1"));
  store.save({ ...snapshot("w1"), displayName: "改名" });
  assert.equal(store.list().length, 1);
  assert.equal(store.load("w1")?.displayName, "改名");
});

test("McWarehouseStore: 容器注册表全量重写", () => {
  const { store } = makeStore();
  const entries = [
    { id: "c1", role: "input" as const, locations: [{ x: 1, y: 2, z: 3 }], enabled: true, priority: 10 },
    { id: "c2", role: "single" as const, locations: [{ x: 4, y: 2, z: 5 }], enabled: true, priority: 10 },
  ];
  store.saveContainers("w1", entries);
  assert.deepEqual(store.loadContainers("w1"), entries);
  // 全量重写：删掉 c2
  store.saveContainers("w1", [entries[0] as (typeof entries)[number]]);
  assert.deepEqual(store.loadContainers("w1")?.map((c) => c.id), ["c1"]);
  store.remove("w1");
  assert.equal(store.loadContainers("w1"), undefined);
});