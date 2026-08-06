import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McIndexStore } from "../scripts/mc/storage/McIndexStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";

test("McIndexStore: 每容器条目写/读/删（最小单位）", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.saveContainer("c1", { items: ["minecraft:stone"], singleBinding: "minecraft:stone" });
  assert.deepEqual(store.loadContainer("c1"), { items: ["minecraft:stone"], singleBinding: "minecraft:stone" });
  // 改 c1 → 只重写该容器自己的键
  store.saveContainer("c1", { items: ["minecraft:stone", "minecraft:iron_ingot"] });
  assert.deepEqual(store.loadContainer("c1")?.items, ["minecraft:stone", "minecraft:iron_ingot"]);
  store.removeContainer("c1");
  assert.equal(store.loadContainer("c1"), undefined);
});

test("McIndexStore: 各容器条目相互独立（单容器粒度）", () => {
  const store = new McIndexStore(new ShardStore(new InMemoryKeyValueStore()));
  store.saveContainer("c1", { items: ["minecraft:stone"] });
  store.saveContainer("c2", { items: ["minecraft:iron_ingot"] });
  store.saveContainer("c1", { items: ["minecraft:dirt"] }); // 只改 c1
  assert.deepEqual(store.loadContainer("c2")?.items, ["minecraft:iron_ingot"]); // c2 不受影响
});