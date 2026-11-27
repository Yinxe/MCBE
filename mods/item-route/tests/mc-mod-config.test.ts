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

// ── 引导标记 ────────────────────────────────────────────
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

// ── 菜单信息开关（menuInfo） ─────────────────────────────
test("McModConfig: menuInfo 默认全开 + 局部合并持久化", () => {
  const kv = new InMemoryKeyValueStore();
  const cfg = McModConfig.load(new ShardStore(kv));
  assert.equal(cfg.menuInfo["warehouseId"], true);
  assert.equal(cfg.menuInfo["containerFamilyRank"], true);
  // 关一个 → 局部合并（其余仍开）
  cfg.setMenuInfo({ warehouseId: false });
  assert.equal(cfg.menuInfo["warehouseId"], false);
  assert.equal(cfg.menuInfo["containerFamilyRank"], true); // 未传保留
  // 重载持久化
  const reloaded = McModConfig.load(new ShardStore(kv));
  assert.equal(reloaded.menuInfo["warehouseId"], false);
  assert.equal(reloaded.menuInfo["containerFamilyRank"], true);
});
