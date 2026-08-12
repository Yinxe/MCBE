// ── 阵列巡检 + 修复单测 ───────────────────────────────────────────
// 覆盖 checkAndRepair 的维护语义（v3 桶水位）：
//   - 桶方块损坏 → 重建木桶 + 桶级丢失报告（barrel-destroyed，全部占用丢失）
//   - 桶完好但实际占用 < 计数（外部取走）→ 桶级丢失报告（taken-externally）
//   - 计数失真（外部塞入）→ 静默对齐（不误报不误清）
//   - 区块未加载（unknown）跳过不误修；巡检后桶水位与真值对齐
import test from "node:test";
import assert from "node:assert/strict";
import { putItem, type PutPort } from "../src/core/put";
import {
  checkAndRepair,
  checkAndRepairLevel,
  createRepairReport,
  type RepairPort,
  type SlotStatus,
} from "../src/core/repair";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";

const DIM = "minecraft:the_end";
const RID = "2:0:0";

/** 巡检测试布局：4 层测试区 */
const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };

/**
 * 内存巡检世界替身：槽位状态表 + 按层桶水位 + 记录读改写。
 * 桶内未显式设置的槽 = empty（空槽）；usage 只登记层 0 的桶 0。
 */
function makeRepairWorld(
  slots: Map<number, SlotStatus>,
  usageOf: (level: number) => number[],
  extraUsage?: Map<number, number[]>
) {
  const record = createRegionRecord(DIM, LAYOUT);
  const usage = new Map<number, number[]>();
  usage.set(0, usageOf(0));
  if (extraUsage) {
    for (const [l, u] of extraUsage) usage.set(l, u);
  }
  let barrelRebuilt = false; // 幂等重建：同桶只第一次真正建桶（对齐真实 ensureBarrelForRepair）
  const port: RepairPort = {
    readRecord: () => JSON.parse(JSON.stringify(record)) as PersistedRegion,
    writeRecord: (r) => {
      Object.assign(record, JSON.parse(JSON.stringify(r)) as PersistedRegion);
    },
    readLevelUsage: (level) => usage.get(level) ?? [],
    writeLevelUsage: (level, arr) => {
      usage.set(level, [...arr]);
    },
    probeSlot: (slotId) => slots.get(slotId) ?? "empty",
    restoreBarrel: (slotId) => {
      // 重建该槽所在桶（桶 0）：桶内槽全部重置为 empty；同桶只第一次 created
      const created = !barrelRebuilt;
      barrelRebuilt = true;
      for (let j = 0; j < 27; j++) slots.set(j, "empty");
      return { ok: true, created };
    },
  };
  return { port, usage, record: () => record };
}

/** 桶 0 前 n 槽 occupied 的状态表 + 对应水位 [n] */
function bucketStatus(occupied: number[], damaged: number[] = [], unknown: number[] = []): Map<number, SlotStatus> {
  const slots = new Map<number, SlotStatus>();
  for (const s of occupied) slots.set(s, "occupied");
  for (const s of damaged) slots.set(s, "damaged");
  for (const s of unknown) slots.set(s, "unknown");
  return slots;
}

test("checkAndRepair：全正常 → 无丢失无修复，水位不变", () => {
  const slots = bucketStatus([0, 1, 2]); // 桶 0 占 3 件
  const { port, usage } = makeRepairWorld(slots, () => [3]);
  const report = checkAndRepair(port, LAYOUT);
  assert.equal(report.scanned, 27); // 桶 0 的全部可用槽被探测
  assert.equal(report.fixedBarrels, 0);
  assert.deepEqual(report.lostDetails, []);
  assert.equal(report.unknownSlots, 0);
  assert.deepEqual(usage.get(0), [3]); // 水位不动
});

test("checkAndRepair：桶方块损坏 → 重建木桶 + 桶级丢失（barrel-destroyed，全部占用）", () => {
  // 桶 0 占 3 件（槽 0..2），整桶被挖（损坏）
  const slots = bucketStatus([], [0, 1, 2]);
  const { port, usage } = makeRepairWorld(slots, () => [3]);
  const events: string[] = [];
  const report = checkAndRepair(port, LAYOUT, (e) => {
    if (e.type === "barrel-restored") events.push(`restored:${e.slotId}`);
    if (e.type === "item-lost-barrel") events.push(`lost:${e.level}:${e.barrelInLevel}:${e.count}:${e.kind}`);
  });
  assert.ok(report.fixedBarrels >= 1); // 重建（mock 首次重建即重置整桶，真实同桶只计一次）
  assert.deepEqual(report.lostDetails, [{ level: 0, barrelInLevel: 0, count: 3, kind: "barrel-destroyed" }]);
  assert.equal(report.lostItems, 3);
  assert.equal(events.filter((e) => e.startsWith("restored")).length, 1); // 整桶一次性重建
  assert.ok(events.some((e) => e === "lost:0:0:3:barrel-destroyed"));
  assert.deepEqual(usage.get(0), [0]); // 重建后桶空 → 水位对齐 0
});

test("checkAndRepair：外部取走（实际占用 < 计数）→ 桶级丢失（taken-externally）并对齐", () => {
  // 桶 0 计数 5，但槽 2、4 被外部取走（空）
  const slots = bucketStatus([0, 1, 3]);
  const { port, usage } = makeRepairWorld(slots, () => [5]);
  const report = checkAndRepair(port, LAYOUT);
  assert.deepEqual(report.lostDetails, [{ level: 0, barrelInLevel: 0, count: 2, kind: "taken-externally" }]);
  assert.equal(report.lostItems, 2);
  assert.deepEqual(usage.get(0), [3]); // 对齐真值（3 件）
});

test("checkAndRepair：外部塞入（实际占用 > 计数）→ 静默对齐不误报", () => {
  // 桶 0 计数 1，但槽 0..4 全有物（外部塞入 4 件）
  const slots = bucketStatus([0, 1, 2, 3, 4]);
  const { port, usage } = makeRepairWorld(slots, () => [1]);
  const report = checkAndRepair(port, LAYOUT);
  assert.deepEqual(report.lostDetails, []);
  assert.equal(report.lostItems, 0);
  assert.deepEqual(usage.get(0), [5]); // 对齐真值
});

test("checkAndRepair：unknown 槽（区块未加载）→ 跳过不误修，该桶不对齐", () => {
  // 桶 0 计数 4；槽 1 unknown（不可判定），其余 3 件占用
  const slots = bucketStatus([0, 2, 3], [], [1]);
  const { port, usage } = makeRepairWorld(slots, () => [4]);
  const report = checkAndRepair(port, LAYOUT);
  assert.deepEqual(report.lostDetails, []); // unknown 保守不报丢失
  assert.equal(report.unknownSlots, 1);
  assert.deepEqual(usage.get(0), [4]); // 保守保留计数（可判定部分 3 + unknown 1）
});

test("checkAndRepair：空桶（计数 0）不扫不动", () => {
  const slots = bucketStatus([], []); // 无任何槽位条目（全 unknown，不触发扫描）
  const { port, usage } = makeRepairWorld(slots, () => [0]);
  usage.set(0, [0]);
  const report = checkAndRepair(port, LAYOUT);
  assert.equal(report.scanned, 0);
  assert.deepEqual(report.lostDetails, []);
  assert.deepEqual(usage.get(0), [0]); // 不动
});

test("checkAndRepairLevel：分批盘点——逐层推进，各层独立累计，最后一层 nextLevel=null", () => {
  const slots = bucketStatus([0, 1]); // 桶 0 占 2 件（层 0）
  const { port, usage } = makeRepairWorld(
    slots,
    (level) => (level === 0 ? [2] : []),
    new Map([[1, [1]]]) // 层 1 桶 0 占 1 件（槽 0 位于 6912）
  );
  slots.set(6912, "occupied");
  // 模拟外部取走层 0 桶 0 的 1 件（槽 1 空，计数仍 2）
  slots.set(1, "empty");

  const total = createRepairReport();
  let level = 0;
  let steps = 0;
  for (;;) {
    const step = checkAndRepairLevel(port, LAYOUT, level);
    total.scanned += step.report.scanned;
    total.lostItems += step.report.lostItems;
    total.lostDetails.push(...step.report.lostDetails);
    steps++;
    if (step.nextLevel === null) break;
    level = step.nextLevel;
  }
  // 每层一步，LAYOUT 4 层 → 4 步
  assert.equal(steps, 4);
  // 层 0 桶 0：计数 2 vs 实际 1 → 外部取走丢失 1 件；层 1 桶 0 正常
  assert.equal(total.lostItems, 1);
  assert.deepEqual(total.lostDetails, [{ level: 0, barrelInLevel: 0, count: 1, kind: "taken-externally" }]);
  // 各层账本对齐：层 0 桶 0 → 1；层 1 桶 0 → 1
  assert.deepEqual(usage.get(0), [1]);
  assert.deepEqual(usage.get(1), [1]);
  // 空层也推进（不卡死）
  assert.deepEqual(usage.get(2), undefined);
});

test("checkAndRepairLevel：越界层号 → 立即结束（nextLevel=null）", () => {
  const slots = bucketStatus([]);
  const { port } = makeRepairWorld(slots, () => []);
  const step = checkAndRepairLevel(port, LAYOUT, LAYOUT.maxLevels);
  assert.equal(step.report.scanned, 0);
  assert.equal(step.nextLevel, null);
});

test("checkAndRepair：真实 put 流程后外部破坏桶 → 巡检修复并释放容量", () => {
  // 用 putItem 真实写入 27 槽桶（桶 0 满），然后模拟桶 0 被挖（变空气）
  const layout = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };
  const world = (() => {
    let record: PersistedRegion | undefined;
    const barrels = new Map<string, boolean[]>();
    const usage = new Map<number, number[]>();
    const port: PutPort = {
      readRecord: () => (record ? (JSON.parse(JSON.stringify(record)) as PersistedRegion) : undefined),
      writeRecord: (r: PersistedRegion) => {
        record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
      },
      readLevelUsage: (level: number) => usage.get(level) ?? [],
      writeLevelUsage: (level: number, arr: number[]) => {
        usage.set(level, [...arr]);
      },
      ensureBarrel: (x: number, y: number, z: number) => {
        const k = `${x},${y},${z}`;
        if (barrels.has(k)) return { ok: true, created: false };
        barrels.set(k, new Array(27).fill(false));
        return { ok: true, created: true };
      },
      isSlotOccupied: (x: number, y: number, z: number, slot: number) => barrels.get(`${x},${y},${z}`)?.[slot] ?? false,
      writeItem: (x: number, y: number, z: number, slot: number) => {
        const b = barrels.get(`${x},${y},${z}`);
        if (!b) return false;
        b[slot] = true;
        return true;
      },
    };
    return { port, barrels, usage, record: () => record };
  })();
  for (let n = 0; n < 27; n++) putItem(world.port, `i${n}`, RID, DIM, layout);
  assert.deepEqual(world.usage.get(0), [27]);

  // 桶 0（0,120,0）被挖掉 → 变成空气
  world.barrels.delete("0,120,0");
  const repairPort: RepairPort = {
    readRecord: world.port.readRecord,
    writeRecord: world.port.writeRecord,
    readLevelUsage: world.port.readLevelUsage,
    writeLevelUsage: world.port.writeLevelUsage,
    probeSlot: (slotId) => {
      if (slotId >= 27) return "occupied"; // 桶 1 及以后仍有物
      return world.barrels.has("0,120,0") ? "empty" : "damaged";
    },
    restoreBarrel: (slotId) => {
      if (slotId >= 27) return { ok: false, created: false };
      // 重建桶 0（27 槽空容器）；同桶多槽只第一个真正创建
      const created = !world.barrels.has("0,120,0");
      world.barrels.set("0,120,0", new Array(27).fill(false));
      return { ok: true, created };
    },
  };
  const report = checkAndRepair(repairPort, layout);
  assert.equal(report.fixedBarrels, 1); // 一个桶（同桶只计一次重建）
  assert.deepEqual(report.lostDetails, [{ level: 0, barrelInLevel: 0, count: 27, kind: "barrel-destroyed" }]);
  assert.equal(report.lostItems, 27); // 桶 0 全部 27 格丢失
  assert.deepEqual(world.usage.get(0), [0]); // 水位对齐：桶 0 计数 0（桶常驻，空桶不扫）
  // 容量恢复：后续 put 复用桶 0 的真空槽（桶水位 0 < usable → 桶内探测空槽 → 写入）
  const ref = putItem(world.port, "reuse", RID, DIM, layout);
  assert.equal(ref?.slotId, 0); // 复用桶 0 槽 0
  assert.equal(report.scanned, 27); // 只扫桶 0 的可用槽
});