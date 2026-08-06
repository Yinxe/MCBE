import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McModConfig } from "../scripts/mc/storage/McModConfig";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";

test("McModConfig: 缺失 → 默认值", () => {
  const cfg = McModConfig.load(new ShardStore(new InMemoryKeyValueStore()));
  assert.equal(cfg.globalEnabled, true);
  assert.equal(cfg.globalSpeedLimit, 8); // 默认最快 8 tick（与仓库默认速度一致 → 默认不额外限速）
});

test("McModConfig: 设置持久化 + clamp", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  cfg.setGlobalEnabled(false);
  cfg.setGlobalSpeedLimit(999); // clamp 到 40
  const reloaded = McModConfig.load(new ShardStore(kv));
  assert.equal(reloaded.globalEnabled, false);
  assert.equal(reloaded.globalSpeedLimit, 40);
  reloaded.setGlobalSpeedLimit(0); // clamp 到 1
  assert.equal(McModConfig.load(new ShardStore(kv)).globalSpeedLimit, 1);
});

// ── Task 3: 信物 + 引导标记 ─────────────────────────────
test("McModConfig: 默认信物 wooden_hoe + isToken", () => {
  const cfg = McModConfig.load(new ShardStore(new InMemoryKeyValueStore()));
  assert.equal(cfg.tokenItemId, "minecraft:wooden_hoe");
  assert.equal(cfg.isToken("minecraft:wooden_hoe"), true);
  assert.equal(cfg.isToken("minecraft:diamond"), false);
});

test("McModConfig: setTokenItemId 持久化", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  cfg.setTokenItemId("minecraft:stick");
  const reloaded = McModConfig.load(new ShardStore(kv));
  assert.equal(reloaded.tokenItemId, "minecraft:stick");
  assert.equal(reloaded.isToken("minecraft:stick"), true);
  assert.equal(reloaded.isToken("minecraft:wooden_hoe"), false);
});

test("McModConfig: 引导标记按玩家独立 hasSeenGuide/markSeenGuide", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  assert.equal(cfg.hasSeenGuide("p1"), false);
  assert.equal(cfg.hasSeenGuide("p2"), false);
  cfg.markSeenGuide("p1");
  assert.equal(cfg.hasSeenGuide("p1"), true);
  assert.equal(cfg.hasSeenGuide("p2"), false); // p2 不受影响
  assert.equal(McModConfig.load(new ShardStore(kv)).hasSeenGuide("p1"), true);
});

test("McModConfig: 建仓限制字段默认值", () => {
  const cfg = McModConfig.load(new ShardStore(new InMemoryKeyValueStore()));
  assert.deepEqual(cfg.maxWarehouseSpec, { x: 32, y: 16, z: 32 });
  assert.equal(cfg.maxWarehousesPerPlayer, 1);
});
