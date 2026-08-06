import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { DirectStore } from "../scripts/mc/storage/DirectStore";
import { McWarehouseStore } from "../scripts/mc/storage/McWarehouseStore";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";
import type { WarehouseSnapshot } from "../scripts/core/storage/Stores";

const snapshot = (id: string): WarehouseSnapshot => ({
  id,
  displayName: `仓库${id}`,
  ownerName: "p1",
  members: [{ playerName: "p1", role: "owner" as const }],
  area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } },
  settings: createDefaultSettings(),
});

function makeStore() {
  const kv = new InMemoryKeyValueStore();
  // 常规数据走 DirectStore（普通 DP 直存）；legacyShards 仅供旧整仓键（ShardStore 分包格式）迁移
  const shards = new ShardStore(kv);
  const store = new McWarehouseStore(new DirectStore(kv), shards);
  return { kv, shards, store };
}

/** 旧版整仓容器注册表键（仅迁移测试用，与 McWarehouseStore 内 legacy 键格式一致） */
const legacyContainersKey = (wid: string): string => `ir2:wh:${wid}:containers`;

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

// ── 容器注册表：每容器一条键（最小单位） ──────────────────
test("McWarehouseStore: 单容器键写/读/删（最小单位）", () => {
  const { store } = makeStore();
  const entry = {
    id: "c1",
    warehouseId: "w1",
    role: "input" as const,
    locations: [{ x: 1, y: 2, z: 3 }],
    enabled: true,
    priority: 10,
    warningEnabled: true,
  };
  store.saveContainer("c1", entry);
  assert.deepEqual(store.loadContainer("c1"), entry);
  // 属性变更 → 只重写该容器自己的键
  store.saveContainer("c1", { ...entry, role: "multi" });
  assert.equal(store.loadContainer("c1")?.role, "multi");
  store.removeContainer("c1");
  assert.equal(store.loadContainer("c1"), undefined);
});

test("McWarehouseStore: 索引维护 + loadAllContainers 按索引组装", () => {
  const { store } = makeStore();
  const c1 = {
    id: "c1",
    warehouseId: "w1",
    role: "input" as const,
    locations: [],
    enabled: true,
    priority: 10,
    warningEnabled: true,
  };
  const c2 = {
    id: "c2",
    warehouseId: "w1",
    role: "single" as const,
    locations: [],
    enabled: true,
    priority: 10,
    warningEnabled: true,
  };
  // 模拟装配层"注册容器 + 同步索引"
  store.saveContainer(c1.id, c1);
  store.saveContainer(c2.id, c2);
  store.saveContainerIds("w1", ["c1", "c2"]);
  assert.deepEqual(
    store.loadAllContainers("w1").map((c) => c.id),
    ["c1", "c2"]
  );
  // 移除 c2 → 清键 + 索引同步 → 只剩 c1
  store.removeContainer("c2");
  store.saveContainerIds("w1", ["c1"]);
  assert.deepEqual(
    store.loadAllContainers("w1").map((c) => c.id),
    ["c1"]
  );
});

test("McWarehouseStore: 旧整仓键自动迁移为每容器键", () => {
  const { shards, store } = makeStore();
  const entries = [
    {
      id: "c1",
      warehouseId: "w1",
      role: "input" as const,
      locations: [],
      enabled: true,
      priority: 10,
      warningEnabled: true,
    },
    {
      id: "c2",
      warehouseId: "w1",
      role: "single" as const,
      locations: [],
      enabled: true,
      priority: 10,
      warningEnabled: true,
    },
  ];
  // 模拟旧版：整仓键（generation 写入）
  shards.write(legacyContainersKey("w1"), entries, "generation");
  // 首次 loadAllContainers → 就地迁移：拆单键 + 写索引 + 删旧键
  assert.deepEqual(
    store.loadAllContainers("w1").map((c) => c.id),
    ["c1", "c2"]
  );
  // 旧键已删、索引就位 → 二次调用走索引（幂等）
  assert.equal(shards.read(legacyContainersKey("w1")), undefined);
  assert.deepEqual(
    store.loadAllContainers("w1").map((c) => c.id),
    ["c1", "c2"]
  );
  // 每个容器已化为独立键
  assert.equal(store.loadContainer("c1")?.id, "c1");
  assert.equal(store.loadContainer("c2")?.id, "c2");
});

test("McWarehouseStore: remove 清索引 + 每个容器键", () => {
  const { store } = makeStore();
  const c1 = {
    id: "c1",
    warehouseId: "w1",
    role: "input" as const,
    locations: [],
    enabled: true,
    priority: 10,
    warningEnabled: true,
  };
  const c2 = {
    id: "c2",
    warehouseId: "w1",
    role: "single" as const,
    locations: [],
    enabled: true,
    priority: 10,
    warningEnabled: true,
  };
  store.saveContainer("c1", c1);
  store.saveContainer("c2", c2);
  store.saveContainerIds("w1", ["c1", "c2"]);
  store.save(snapshot("w1"));
  // 删仓 → 清 meta + 索引 + 每个容器键
  store.remove("w1");
  assert.equal(store.load("w1"), undefined);
  assert.equal(store.loadContainer("c1"), undefined);
  assert.equal(store.loadContainer("c2"), undefined);
  assert.equal(store.loadAllContainers("w1").length, 0);
});
