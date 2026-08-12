// ─── core/model — 类型模型与常量 ───────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { DP_PREFIX, EQUIP_SLOT_NAMES, INVENTORY_SIZE, SWAP_SLOT_NAMES, TAG_PREFIX } from "../scripts/core/model/Types";

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

test("类型：BotRecord 序列化往返（JSON 无损）", () => {
  const record = {
    name: "bot1",
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