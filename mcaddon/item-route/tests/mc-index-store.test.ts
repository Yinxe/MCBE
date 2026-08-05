import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McIndexStore } from "../scripts/mc/storage/McIndexStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { IndexSnapshotData } from "../scripts/core/storage/Stores";

const snap = (n: number): IndexSnapshotData => ({
  version: 1,
  byItem: { [`minecraft:stone:${n}`]: { single: ["s1"], multi: [] } },
  containerItems: { s1: [`minecraft:stone:${n}`] },
  singleBindings: { s1: `minecraft:stone:${n}` },
});

test("McIndexStore: markDirty + flush 批量落盘 + 读取（flush 时序列化）", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.markDirty("w1", { serialize: () => snap(1) });
  store.markDirty("w2", { serialize: () => snap(2) });
  assert.equal(store.hasDirty(), true);
  store.flush();
  assert.equal(store.hasDirty(), false);
  assert.equal(store.load("w1")?.byItem["minecraft:stone:1"]!.single[0], "s1");
  assert.equal(store.load("w2")?.byItem["minecraft:stone:2"]!.single[0], "s1");
});

test("McIndexStore: remove 清键 + 清脏", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.markDirty("w1", { serialize: () => snap(1) });
  store.flush();
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
  assert.equal(store.hasDirty(), false);
});