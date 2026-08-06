import { test } from "node:test";
import assert from "node:assert/strict";
import { DirectStore } from "../scripts/mc/storage/DirectStore";
import { McStatsStore } from "../scripts/mc/storage/McStatsStore";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { ContainerStatsData } from "../scripts/core/storage/Stores";

const stats = (containerId: string): ContainerStatsData => ({
  containerId,
  role: "multi",
  totalSlots: 4,
  usedSlots: 2,
  totalItems: 10,
  uniqueTypes: 1,
  isWarning: false,
  byType: { "minecraft:stone": 10 },
});

test("McStatsStore: 每容器一条 saveContainer/loadContainer/removeContainer（普通 DP 直存）", () => {
  const store = new McStatsStore(new DirectStore(new InMemoryKeyValueStore()));
  store.saveContainer("c1", stats("c1"));
  store.saveContainer("c2", stats("c2"));
  assert.equal(store.loadContainer("c1")?.byType["minecraft:stone"], 10);
  assert.equal(store.loadContainer("c2")?.containerId, "c2");
  // 互不影响（每容器独立键）
  store.removeContainer("c1");
  assert.equal(store.loadContainer("c1"), undefined);
  assert.equal(store.loadContainer("c2")?.containerId, "c2");
});
