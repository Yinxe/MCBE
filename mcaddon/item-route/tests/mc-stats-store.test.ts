import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McStatsStore } from "../scripts/mc/storage/McStatsStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { StatsSnapshotData } from "../scripts/core/storage/Stores";

test("McStatsStore: 写穿透 save/load/remove", () => {
  const store = new McStatsStore(new ShardStore(new InMemoryKeyValueStore()));
  const snap: StatsSnapshotData = { warehouseId: "w1", containers: { c1: { usedSlots: 2 } }, warehouse: { totalItems: 5 } };
  store.save("w1", snap);
  assert.deepEqual(store.load("w1"), snap);
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
});