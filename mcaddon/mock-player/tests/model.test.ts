// ─── core/model — 类型模型与常量 ───────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { DP_PREFIX, EQUIP_SLOT_NAMES, INVENTORY_SIZE, SWAP_SLOT_NAMES, TAG_PREFIX, createDefaultConfig, DEFAULT_QUOTA } from "../scripts/core/model/Types";
import type { ModConfig } from "../scripts/core/model/Types";

test("常量：DP 前缀与标签前缀互不相同", () => {
  assert.equal(DP_PREFIX, "mockplayer:players:");
  assert.equal(TAG_PREFIX, "mockplayer:tag:");
  assert.notEqual(DP_PREFIX, TAG_PREFIX);
});

test("常量：背包 36 格（快捷栏 9 + 背包 27）", () => {
  assert.equal(INVENTORY_SIZE, 36);
});

test("常量：装备槽 5 个且副手在互换列表内", () => {
  assert.deepEqual([...EQUIP_SLOT_NAMES], ["head", "chest", "legs", "feet", "offhand"]);
  assert.equal(SWAP_SLOT_NAMES.length, 5);
  assert.ok(SWAP_SLOT_NAMES.includes("offhand"));
});

test("类型：BotRecord 序列化往返（JSON 无损，含 ownerName）", () => {
  const record = {
    name: "bot1",
    ownerName: "Steve",
    online: true,
    death: false,
    entityId: "abc123",
    tags: ["mockplayer:tag:bot"],
    isSneaking: true,
    lastPoint: { location: { x: 1, y: 2, z: 3 }, dimension: "minecraft:overworld", rotation: { x: 0, y: 90 }, lookTarget: { x: 4, y: 5, z: 6 } },
    respawnPoint: { location: { x: 0, y: 64, z: 0 }, dimension: "minecraft:overworld", rotation: { x: 0, y: 0 }, lookTarget: { x: 1, y: 64, z: 1 } },
    deathPoint: null,
    experience: { level: 30, xpProgress: 100, totalXp: 1395 },
    spawnMode: "chunkload" as const,
  };
  const roundTrip = JSON.parse(JSON.stringify(record));
  assert.deepEqual(roundTrip, record);
  assert.equal(roundTrip.spawnMode, "chunkload");
  assert.equal(roundTrip.ownerName, "Steve");
});

test("类型：ModConfig 序列化往返 + 默认值", () => {
  const config: ModConfig = createDefaultConfig();
  assert.equal(config.defaultQuota, DEFAULT_QUOTA);
  assert.equal(DEFAULT_QUOTA, 5);
  // ⚠️ 不用 assert.deepEqual(config.quotas, {})：断言签名会把空字面量推断为
  // never[] / {} 并收窄后续变量类型（node:assert 的 asserts actual is T）
  assert.equal(Object.keys(config.quotas).length, 0);
  assert.equal(config.admins.length, 0);

  config.quotas["Alex"] = 10;
  config.admins.push("Notch");
  const roundTrip = JSON.parse(JSON.stringify(config)) as ReturnType<typeof createDefaultConfig>;
  assert.deepEqual(roundTrip, config);
  assert.equal(roundTrip.quotas["Alex"], 10);
  assert.deepEqual(roundTrip.admins, ["Notch"]);
});

test("类型：无主假人（无 ownerName）兼容旧数据", () => {
  const legacy = JSON.parse(JSON.stringify({ name: "old_bot", online: false, death: false, tags: [], isSneaking: false, lastPoint: null, respawnPoint: { location: { x: 0, y: 64, z: 0 }, dimension: "minecraft:overworld", rotation: { x: 0, y: 0 }, lookTarget: { x: 1, y: 64, z: 1 } }, deathPoint: null, experience: { level: 0, xpProgress: 0, totalXp: 0 } }));
  assert.equal(legacy.ownerName, undefined);
});

test("类型：SerializedItemStack 可序列化（含附魔/容器）", () => {
  const item = {
    typeId: "minecraft:diamond_sword",
    amount: 1,
    damage: 3,
    enchantments: [{ id: "sharpness", level: 5 }],
    container: [null, { typeId: "minecraft:stick", amount: 1 }],
  };
  const roundTrip = JSON.parse(JSON.stringify(item)) as typeof item;
  assert.deepEqual(roundTrip, item);
  assert.equal(roundTrip.enchantments?.[0]?.id, "sharpness");
  assert.equal(roundTrip.container?.[1]?.typeId, "minecraft:stick");
});