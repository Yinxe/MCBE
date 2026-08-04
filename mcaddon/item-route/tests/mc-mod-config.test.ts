import { test } from "node:test";
import assert from "node:assert/strict";
import { ShardStore } from "../scripts/mc/storage/ShardStore";
import { McModConfig } from "../scripts/mc/storage/McModConfig";
import { InMemoryKeyValueStore } from "../scripts/core/storage/KeyValueStore";

test("McModConfig: 缺失 → 默认值", () => {
  const cfg = McModConfig.load(new ShardStore(new InMemoryKeyValueStore()));
  assert.equal(cfg.globalEnabled, true);
  assert.equal(cfg.globalSpeedLimit, 20);
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

test("McModConfig: 引导标记 hasSeenGuide/markSeenGuide 持久化", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  assert.equal(cfg.hasSeenGuide(), false);
  cfg.markSeenGuide();
  assert.equal(cfg.hasSeenGuide(), true);
  assert.equal(McModConfig.load(new ShardStore(kv)).hasSeenGuide(), true);
});