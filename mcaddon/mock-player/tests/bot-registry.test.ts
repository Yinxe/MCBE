// ─── core/service — 假人注册表生命周期 ─────────────────

import { test } from "node:test";
import assert from "node:assert/strict";

import { BotRegistry } from "../scripts/service/BotRegistry";
import { InMemoryBotStore } from "../scripts/service/port/BotStore";
import { makeRecord, makeItem } from "./helpers/factories";

function makeRegistry() {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  return { store, registry };
}

test("set：仅内存更新不写持久化", () => {
  const { store, registry } = makeRegistry();
  const record = makeRecord();
  registry.set(record);
  assert.equal(registry.size, 1);
  assert.equal(store.recordWrites, 0);
  assert.equal(store.loadRecord("bot1"), undefined);
});

test("save：内存 + 持久化写穿", () => {
  const { store, registry } = makeRegistry();
  registry.save(makeRecord("bot1"));
  assert.equal(registry.size, 1);
  assert.equal(store.recordWrites, 1);
  assert.equal(store.loadRecord("bot1")?.name, "bot1");
});

test("get/has/all：查询与枚举", () => {
  const { registry } = makeRegistry();
  registry.save(makeRecord("a"));
  registry.save(makeRecord("b"));
  assert.equal(registry.has("a"), true);
  assert.equal(registry.get("b")?.name, "b");
  assert.equal(registry.get("c"), undefined);
  assert.equal(registry.all().length, 2);
});

test("remove：内存 + 记录 + 背包/装备 + 恢复标记全清理", () => {
  const { store, registry } = makeRegistry();
  const record = makeRecord("bot1");
  registry.save(record);
  store.saveInventory("bot1", [makeItem("minecraft:diamond"), null]);
  store.saveEquipSlot("bot1", "head", makeItem("minecraft:diamond_helmet"));
  registry.markRestored("bot1");

  registry.remove("bot1");

  assert.equal(registry.size, 0);
  assert.equal(registry.isRestored("bot1"), false);
  assert.equal(store.loadRecord("bot1"), undefined);
  assert.equal(store.loadInventory("bot1"), undefined);
  assert.equal(store.loadEquipment("bot1"), undefined);
});

test("restoreAll：重启后强制 offline / 非死亡 / 无实体 ID 并回写", () => {
  const { store, registry } = makeRegistry();
  // 模拟旧持久化数据（在线/死亡/有 entityId）
  store.saveRecord(makeRecord("bot1", { online: true, death: true, entityId: "e1" }));
  store.saveRecord(makeRecord("bot2", { online: true }));

  const restored = registry.restoreAll();

  assert.equal(restored.length, 2);
  for (const r of restored) {
    assert.equal(r.online, false);
    assert.equal(r.death, false);
    assert.equal(r.entityId, undefined);
  }
  // 回写持久化
  assert.equal(store.loadRecord("bot1")?.online, false);
});

test("restoreAll：loadAllRecords 返回全部已存记录（损坏过滤是 mc 层 JSON 解析职责）", () => {
  const { store, registry } = makeRegistry();
  store.saveRecord(makeRecord("a"));
  store.saveRecord(makeRecord("b"));
  const restored = registry.restoreAll();
  assert.equal(restored.length, 2);
  assert.equal(restored[0]?.name, "a");
});

test("restoreAll：重复调用保持重启语义（始终强制离线状态）", () => {
  const { store, registry } = makeRegistry();
  store.saveRecord(makeRecord("bot1", { online: true }));
  registry.restoreAll();
  // 即使内存状态被改回 online，再次 restoreAll 也按持久化强制重置
  const r = registry.get("bot1")!;
  r.online = true;
  registry.restoreAll();
  assert.equal(registry.get("bot1")?.online, false);
});

test("恢复标记：markRestored / isRestored / removeRestored", () => {
  const { registry } = makeRegistry();
  assert.equal(registry.isRestored("bot1"), false);
  registry.markRestored("bot1");
  assert.equal(registry.isRestored("bot1"), true);
  registry.removeRestored("bot1");
  assert.equal(registry.isRestored("bot1"), false);
});

test("恢复标记：rename 时随迁", () => {
  const { registry } = makeRegistry();
  registry.save(makeRecord("old"));
  registry.markRestored("old");
  registry.rename("old", "new");
  assert.equal(registry.isRestored("old"), false);
  assert.equal(registry.isRestored("new"), true);
  assert.equal(registry.get("new")?.name, "new");
});

test("rename：内存 key 迁移 + 持久化新 key", () => {
  const { store, registry } = makeRegistry();
  registry.save(makeRecord("old"));
  registry.rename("old", "new");
  assert.equal(registry.has("old"), false);
  assert.equal(registry.get("new")?.name, "new");
  assert.equal(store.loadRecord("new")?.name, "new");
});

test("rename：绑定表随迁（renameBinding）——改名后背包/装备数据仍可读", () => {
  const { store, registry } = makeRegistry();
  const record = makeRecord("old");
  registry.save(record);
  // 先存入背包/装备（InMemory 替身：slot key 前缀含假人名）
  store.saveInventory("old", [makeItem("minecraft:diamond", 1), null]);
  store.saveEquipment("old", { head: makeItem("minecraft:iron_helmet", 1) });

  registry.rename("old", "new");

  // 旧名下无数据（已迁移），新名下数据完整
  assert.equal(store.loadInventory("old"), undefined);
  assert.equal(store.loadEquipment("old"), undefined);
  const inv = store.loadInventory("new");
  assert.ok(inv);
  assert.equal(inv[0]?.typeId, "minecraft:diamond");
  const equip = store.loadEquipment("new");
  assert.equal(equip?.head?.typeId, "minecraft:iron_helmet");
});

test("save(silent=true)：静默保存仍写持久化", () => {
  const { store, registry } = makeRegistry();
  registry.save(makeRecord("bot1"), true);
  assert.equal(store.recordWrites, 1);
});