// ─── 兼容仓归位计划 domain 测试：搬序/跳过/同槽去重 ────────────────
import test from "node:test";
import assert from "node:assert/strict";
import { carryCount, planBindingCarry } from "../scripts/domain/StorageCarry";
import type { StorageBinding } from "../scripts/domain/Record";

const PLACEHOLDER = "minecraft:structure_void";

function binding(inv: Record<string, number>, equip: Record<string, number> = {}): StorageBinding {
  return { regionId: "the_end:18750:18750", inv, equip };
}

test("背包按格号升序、装备按槽序搬；占位与读不到的格跳过", () => {
  const store = new Map<number, string>([
    [0, "apple"],
    [3, PLACEHOLDER],
    [5, "sword"],
    [7, "shield"],
    [8, "helmet"],
  ]);
  const plan = planBindingCarry<string>(
    binding({ "5": 5, "0": 0, "3": 3, "9": 9 }, { offhand: 7, head: 8 }),
    (slotId) => store.get(slotId),
    (item) => item !== PLACEHOLDER
  );
  assert.deepEqual(
    plan.inv.map((e) => [e.key, e.item, e.fromSlotId]),
    [
      ["0", "apple", 0],
      ["5", "sword", 5],
    ]
  );
  assert.deepEqual(
    plan.equip.map((e) => [e.key, e.item, e.fromSlotId]),
    [
      ["head", "helmet", 8],
      ["offhand", "shield", 7],
    ]
  );
  assert.equal(plan.skipped, 2, "占位格 3 与读不到的格 9 各计一次跳过");
  assert.equal(carryCount(plan), 4);
});

test("同一源槽被两个绑定键引用：只搬一次，重复键计入跳过", () => {
  const plan = planBindingCarry<string>(
    binding({ "0": 4, "1": 4 }),
    () => "stone",
    () => true
  );
  assert.equal(carryCount(plan), 1);
  assert.equal(plan.inv[0]!.key, "0");
  assert.equal(plan.skipped, 1);
});

test("装备表里的未知槽名不参与搬迁，也不计入跳过（不是有效绑定）", () => {
  const plan = planBindingCarry<string>(
    binding({}, { head: 1, tail: 2 }),
    () => "iron",
    () => true
  );
  assert.equal(plan.equip.length, 1);
  assert.equal(plan.equip[0]!.key, "head");
  assert.equal(plan.skipped, 0);
});

test("空绑定表：无搬迁、无跳过", () => {
  const plan = planBindingCarry<string>(
    binding({}),
    () => undefined,
    () => true
  );
  assert.equal(carryCount(plan), 0);
  assert.equal(plan.skipped, 0);
});
