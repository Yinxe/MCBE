// ── 指定格子精准覆写（overwriteSlot）单测 ─────────────────────────
// 语义：ItemStack → 指定格子直接覆写（slotId 不变），主要用于实时数据保存：
//   - 格内已有物品（occupied）→ 替换，旧物品返回调用方（不丢）；
//   - 格内为空（empty）→ **直接写入**（精准指定格子的写入手势），桶水位计数 +1；
//   - 非木桶/未加载（damaged/unknown）→ 拒绝（请先巡检）；
//   - 越界/空物品 → 拒绝。
import test from "node:test";
import assert from "node:assert/strict";
import { overwriteSlot, type OverwritePort } from "../src/core/overwrite";
import type { SlotStatus } from "../src/core/repair";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";

const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };

/** 内存覆写世界：slotId → 状态 + 物品 + 按层桶水位 */
function makeOverwriteWorld(slots: Map<number, SlotStatus>, items: Map<number, string>, usageOf: (level: number) => number[]) {
  const record = createRegionRecord("minecraft:the_end", LAYOUT);
  const usage = new Map<number, number[]>();
  usage.set(0, usageOf(0));
  const port: OverwritePort = {
    readRecord: () => JSON.parse(JSON.stringify(record)) as PersistedRegion,
    writeRecord: (r) => {
      Object.assign(record, JSON.parse(JSON.stringify(r)) as PersistedRegion);
    },
    readLevelUsage: (level) => usage.get(level) ?? [],
    writeLevelUsage: (level, arr) => {
      usage.set(level, [...arr]);
    },
    probeSlot: (slotId) => slots.get(slotId) ?? "unknown",
    readItem: (slotId) => items.get(slotId),
    writeItem: (slotId, item) => {
      const status = slots.get(slotId);
      if (status !== "occupied" && status !== "empty") return false;
      items.set(slotId, item as string);
      return true;
    },
  };
  return { port, items, usage, record: () => record };
}

test("overwriteSlot：位置有实物 → 覆写成功，返回旧物品（slotId 不变）", () => {
  const slots = new Map<number, SlotStatus>([[3, "occupied"]]);
  const items = new Map<number, string>([[3, "old-sword"]]);
  const { port, items: world } = makeOverwriteWorld(slots, items, () => [3]);
  const r = overwriteSlot(port, 3, "new-axe", LAYOUT);
  assert.equal(r.ok, true);
  assert.equal(r.old, "old-sword"); // 旧物返回（不丢）
  assert.equal(world.get(3), "new-axe"); // 原位覆写
});

test("overwriteSlot：空槽 → 直接写入（实时数据保存），桶水位计数 +1", () => {
  const slots = new Map<number, SlotStatus>([[5, "empty"]]);
  const { port, items, usage } = makeOverwriteWorld(slots, new Map(), () => [2]); // 桶 0 计数 2
  const r = overwriteSlot(port, 5, "snapshot", LAYOUT);
  assert.equal(r.ok, true);
  assert.equal(r.old, undefined); // 原为空
  assert.equal(items.get(5), "snapshot");
  assert.deepEqual(usage.get(0), [3]); // 桶 0 计数 2 → 3
});

test("overwriteSlot：空槽写入未登记桶 → 桶水位登记 1", () => {
  const slots = new Map<number, SlotStatus>([[27, "empty"]]); // 桶 1 槽 0（桶未登记）
  const { port, usage } = makeOverwriteWorld(slots, new Map(), () => [1]);
  const r = overwriteSlot(port, 27, "snapshot", LAYOUT);
  assert.equal(r.ok, true);
  assert.deepEqual(usage.get(0), [1, 1]); // 桶 1 登记 1
});

test("overwriteSlot：非木桶/未加载 → 拒绝（请先巡检），水位不动", () => {
  for (const status of ["damaged", "unknown"] as SlotStatus[]) {
    const slots = new Map<number, SlotStatus>([[7, status]]);
    const { port, items, usage } = makeOverwriteWorld(slots, new Map(), () => [3]);
    const r = overwriteSlot(port, 7, "x", LAYOUT);
    assert.equal(r.ok, false);
    assert.ok(r.error?.includes("巡检"));
    assert.equal(items.has(7), false);
    assert.deepEqual(usage.get(0), [3]);
  }
});

test("overwriteSlot：越界/空物品/写入失败 → 拒绝且不破坏", () => {
  const slots = new Map<number, SlotStatus>([[3, "occupied"]]);
  const items = new Map<number, string>([[3, "old"]]);
  const { port, usage } = makeOverwriteWorld(slots, items, () => [3]);
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
  assert.deepEqual(usage.get(0), [3]); // 失败不登记
});