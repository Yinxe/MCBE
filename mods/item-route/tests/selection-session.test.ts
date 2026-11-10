import { test } from "node:test";
import assert from "node:assert/strict";
import { SelectionSessionStore, type SelectionSession } from "../scripts/mc/interaction/SelectionSessionStore";

test("SelectionSessionStore: set/get/clear/clearAll", () => {
  const store = new SelectionSessionStore();
  const s1: SelectionSession = { kind: "createWarehouse", name: "仓A", defaultRole: "single", defaultEnabled: true };
  assert.equal(store.get("p1"), undefined);
  store.set("p1", s1);
  assert.deepEqual(store.get("p1"), s1);
  store.clear("p1");
  assert.equal(store.get("p1"), undefined);
});

test("SelectionSessionStore: 覆盖旧会话（同 playerName 二次 set 替换）", () => {
  const store = new SelectionSessionStore();
  store.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "multi", defaultEnabled: true });
  store.set("p1", { kind: "resizeWarehouse", warehouseId: "w9" });
  assert.deepEqual(store.get("p1"), { kind: "resizeWarehouse", warehouseId: "w9" });
});

test("SelectionSessionStore: 多玩家独立 + clearAll", () => {
  const store = new SelectionSessionStore();
  store.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "misc", defaultEnabled: false });
  store.set("p2", { kind: "resizeWarehouse", warehouseId: "w2" });
  assert.equal(store.get("p1")?.kind, "createWarehouse");
  assert.equal(store.get("p2")?.kind, "resizeWarehouse");
  store.clearAll();
  assert.equal(store.get("p1"), undefined);
  assert.equal(store.get("p2"), undefined);
});
