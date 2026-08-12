// ── 指定格子精准覆写（overwriteSlot）单测 ─────────────────────────
// 语义：ItemStack → 指定格子直接覆写（slotId 不变），主要用于实时数据保存：
//   - 格内已有物品（occupied）→ 替换，旧物品返回调用方（不丢）；
//   - 格内为空/洞（empty）→ **直接写入**（精准指定格子的写入手势），洞占位移除；
//   - 非木桶/未加载（damaged/unknown）→ 拒绝（请先巡检）；
//   - 越界/空物品 → 拒绝。
import test from "node:test";
import assert from "node:assert/strict";
import { overwriteSlot, type OverwritePort } from "../src/core/overwrite";
import type { SlotStatus } from "../src/core/repair";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";

const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };

/** 内存覆写世界：slotId → 状态 + 物品 + 按层洞池 */
function makeOverwriteWorld(
  slots: Map<number, SlotStatus>,
  items: Map<number, string>,
  holes: Map<number, number[]> = new Map()
) {
  let record = createRegionRecord("minecraft:the_end", LAYOUT);
  record.meta.nextFree = 100;
  record.meta.holeLevels = [...holes.keys()].sort((a, b) => a - b);
  record.meta.holeCount = [...holes.values()].reduce((n, a) => n + a.length, 0);
  const pools = new Map(holes);
  const port: OverwritePort = {
    readRecord: () => JSON.parse(JSON.stringify(record)) as PersistedRegion,
    writeRecord: (r) => {
      record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
    },
    readLevelPool: (level) => pools.get(level) ?? [],
    writeLevelPool: (level, locals) => {
      if (locals.length === 0) pools.delete(level);
      else pools.set(level, [...locals]);
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
  return { port, items, pools, record: () => record };
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

test("overwriteSlot：空槽 → 直接写入（实时数据保存），洞池占位移除", () => {
  const slots = new Map<number, SlotStatus>([[5, "empty"]]);
  const holes = new Map<number, number[]>([[0, [5]]]); // 槽 5 曾是洞
  const { port, items, pools, record } = makeOverwriteWorld(slots, new Map(), holes);
  const r = overwriteSlot(port, 5, "snapshot", LAYOUT);
  assert.equal(r.ok, true);
  assert.equal(r.old, undefined); // 原为空
  assert.equal(items.get(5), "snapshot");
  // 洞已占位移除：holeCount 归零、层池清空、holeLevels 无 0
  assert.equal(record().meta.holeCount, 0);
  assert.deepEqual(record().meta.holeLevels, []);
  assert.equal(pools.has(0), false);
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
