// ─── NBT 存储绑定表纯逻辑测试 ─────────────────────────
// core/storage/Binding.ts：绑定表创建/读写/清空/枚举/有存档判定。
// key-value 对象结构：无 key = 未绑定（稀疏，不受数组长度约束）。

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  allBoundSlotIds,
  bindEquipSlot,
  bindSlot,
  boundEquipSlotId,
  boundSlotId,
  createBinding,
  hasAnyBinding,
  unbindEquipSlot,
  unbindSlot,
} from "../scripts/core/storage/Binding";
import { EQUIP_SLOT_NAMES, INVENTORY_SIZE } from "../scripts/core/model/Types";

test("createBinding 初始全未绑定（空对象）", () => {
  const b = createBinding("2:0:-64");
  assert.equal(b.regionId, "2:0:-64");
  assert.deepEqual(b.inv, {});
  assert.deepEqual(b.equip, {});
  assert.equal(hasAnyBinding(b), false);
});

test("boundSlotId 未绑定返回 undefined", () => {
  const b = createBinding("2:0:-64");
  assert.equal(boundSlotId(b, 0), undefined);
  assert.equal(boundSlotId(b, 35), undefined);
  assert.equal(boundSlotId(undefined, 0), undefined);
});

test("bindSlot / boundSlotId 往返（对象稀疏）", () => {
  const b = createBinding("2:0:-64");
  bindSlot(b, 5, 1000);
  assert.equal(boundSlotId(b, 5), 1000);
  assert.equal(boundSlotId(b, 4), undefined); // 其他格不受影响
  assert.equal(hasAnyBinding(b), true);
  // 对象结构：只含绑定过的格（稀疏）
  assert.deepEqual(Object.keys(b.inv), ["5"]);
});

test("bindSlot 边界：0 与 35 合法，越界抛错", () => {
  const b = createBinding("2:0:-64");
  bindSlot(b, 0, 1);
  bindSlot(b, INVENTORY_SIZE - 1, 2);
  assert.equal(boundSlotId(b, 0), 1);
  assert.equal(boundSlotId(b, INVENTORY_SIZE - 1), 2);
  assert.throws(() => bindSlot(b, INVENTORY_SIZE, 3));
  assert.throws(() => bindSlot(b, -1, 3));
});

test("bindSlot 非法 slotId 抛错（负数/小数）", () => {
  const b = createBinding("2:0:-64");
  assert.throws(() => bindSlot(b, 0, -1));
  assert.throws(() => bindSlot(b, 0, 1.5));
});

test("unbindSlot 清空绑定（对象删 key）", () => {
  const b = createBinding("2:0:-64");
  bindSlot(b, 3, 42);
  unbindSlot(b, 3);
  assert.equal(boundSlotId(b, 3), undefined);
  assert.equal(hasAnyBinding(b), false);
  // 未绑定清空无副作用
  unbindSlot(b, 3);
  unbindSlot(b, 99); // 越界 slot 无 key，无副作用
});

test("装备槽绑定往返（全部 5 槽名）", () => {
  const b = createBinding("2:0:-64");
  EQUIP_SLOT_NAMES.forEach((name, i) => {
    assert.equal(boundEquipSlotId(b, name), undefined);
    bindEquipSlot(b, name, 100 + i);
    assert.equal(boundEquipSlotId(b, name), 100 + i);
  });
  assert.equal(hasAnyBinding(b), true);
  unbindEquipSlot(b, "head");
  assert.equal(boundEquipSlotId(b, "head"), undefined);
});

test("bindEquipSlot 非法 slotId 抛错", () => {
  const b = createBinding("2:0:-64");
  assert.throws(() => bindEquipSlot(b, "head", -1));
});

test("allBoundSlotIds 枚举全部绑定（背包 + 装备）", () => {
  const b = createBinding("2:0:-64");
  assert.deepEqual(allBoundSlotIds(b), []);
  bindSlot(b, 0, 10);
  bindSlot(b, 35, 20);
  bindEquipSlot(b, "chest", 30);
  const ids = allBoundSlotIds(b).sort((x, y) => x - y);
  assert.deepEqual(ids, [10, 20, 30]);
});

test("hasAnyBinding 判定（undefined / 空表 / 部分绑定）", () => {
  assert.equal(hasAnyBinding(undefined), false);
  assert.equal(hasAnyBinding(createBinding("2:0:-64")), false);
  const b = createBinding("2:0:-64");
  bindEquipSlot(b, "offhand", 7);
  assert.equal(hasAnyBinding(b), true);
});
