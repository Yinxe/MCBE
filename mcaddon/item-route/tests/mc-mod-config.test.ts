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