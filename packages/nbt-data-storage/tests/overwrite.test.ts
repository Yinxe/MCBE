// ── 原位覆写（overwriteSlot）单测 ─────────────────────────────────
// 语义：指定已有格子覆盖写入（slotId 不变），旧物品返回调用方（不丢）。
// 护栏：仅 occupied 允许；empty 拒绝（请用 put）；damaged/unknown 拒绝（请先巡检）。
import test from "node:test";
import assert from "node:assert/strict";
import { overwriteSlot, type OverwritePort } from "../src/core/overwrite";
import type { SlotStatus } from "../src/core/repair";

const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };

/** 内存覆写世界：slotId → 状态 + 物品（字符串代指） */
function makeOverwriteWorld(slots: Map<number, SlotStatus>, items: Map<number, string>) {
  const port: OverwritePort = {
    probeSlot: (slotId) => slots.get(slotId) ?? "unknown",
    readItem: (slotId) => items.get(slotId),
    writeItem: (slotId, item) => {
      const status = slots.get(slotId);
      if (status !== "occupied") return false;
      items.set(slotId, item as string);
      return true;
    },
  };
  return { port, items };
}

test("overwriteSlot：位置有实物 → 覆写成功，返回旧物品（slotId 不变）", () => {
  const slots = new Map<number, SlotStatus>([[3, "occupied"]]);
  const items = new Map<number, string>([[3, "old-sword"]]);
  const { port, items: world } = makeOverwriteWorld(slots, items);
  const r = overwriteSlot(port, 3, "new-axe", LAYOUT);
  assert.equal(r.ok, true);
  assert.equal(r.old, "old-sword"); // 旧物返回（不丢）
  assert.equal(world.get(3), "new-axe"); // 原位覆写
});

test("overwriteSlot：空槽 → 拒绝（覆写需目标已有物品）", () => {
  const slots = new Map<number, SlotStatus>([[5, "empty"]]);
  const { port, items } = makeOverwriteWorld(slots, new Map());
  const r = overwriteSlot(port, 5, "x", LAYOUT);
  assert.equal(r.ok, false);
  assert.ok(r.error?.includes("为空"));
  assert.equal(items.has(5), false); // 未写入
});

test("overwriteSlot：非木桶/未加载 → 拒绝（请先巡检）", () => {
  for (const status of ["damaged", "unknown"] as SlotStatus[]) {
    const slots = new Map<number, SlotStatus>([[7, status]]);
    const { port, items } = makeOverwriteWorld(slots, new Map());
    const r = overwriteSlot(port, 7, "x", LAYOUT);
    assert.equal(r.ok, false);
    assert.ok(r.error?.includes("巡检"));
    assert.equal(items.has(7), false);
  }
});

test("overwriteSlot：越界/空物品/写入失败 → 拒绝且不破坏", () => {
  const slots = new Map<number, SlotStatus>([[3, "occupied"]]);
  const items = new Map<number, string>([[3, "old"]]);
  const { port } = makeOverwriteWorld(slots, items);
  assert.equal(overwriteSlot(port, 99999, "x", LAYOUT).ok, false); // 越界
  assert.equal(overwriteSlot(port, 3, undefined, LAYOUT).ok, false); // 空物品
  // 写入失败（位置在写入瞬间异常）
  const failPort: OverwritePort = {
    ...port,
    writeItem: () => false,
  };
  const r = overwriteSlot(failPort, 3, "new", LAYOUT);
  assert.equal(r.ok, false);
  assert.equal(r.old, undefined); // 失败不返回旧物（旧物未受影响）
  assert.equal(items.get(3), "old");
});