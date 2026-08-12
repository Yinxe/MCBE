// ── 阵列巡检 + 修复单测 ───────────────────────────────────────────
// 覆盖 checkAndRepair 的维护语义：
//   - 桶方块损坏 → 重建木桶 + 报告丢失槽
//   - 元数据占用但实物空（外部取走）→ 报告丢失 + 回收为洞可复用
//   - 洞池内已知空槽不误报；区块未加载（unknown）跳过不误修
//   - 巡检后洞池与世界真值对齐（容量恢复）
import test from "node:test";
import assert from "node:assert/strict";
import { putItem } from "../src/core/put";
import { checkAndRepair, type RepairPort, type SlotStatus } from "../src/core/repair";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";
import { allocateSlotId, createLevelPools, releaseSlotId } from "../src/core/meta";

const DIM = "minecraft:the_end";
const RID = "2:0:0";

/** 巡检测试布局：4 层测试区 */
const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };

/** 内存巡检世界替身：槽位状态表 + 按层洞池 + 记录读改写 */
function makeRepairWorld(slots: Map<number, SlotStatus>, holes: Map<number, number[]>, nextFree = 10) {
  let record = createRegionRecord(DIM, LAYOUT);
  record.meta.nextFree = nextFree;
  record.meta.holeLevels = [...holes.keys()].sort((a, b) => a - b);
  record.meta.holeCount = [...holes.values()].reduce((n, a) => n + a.length, 0);
  const pools = new Map(holes);
  const port: RepairPort = {
    readRecord: () => JSON.parse(JSON.stringify(record)) as PersistedRegion,
    writeRecord: (r) => {
      record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
    },
    readLevelPool: (level) => pools.get(level) ?? [],
    writeLevelPool: (level, locals) => {
      pools.set(level, [...locals]);
    },
    probeSlot: (slotId) => slots.get(slotId) ?? "unknown",
    restoreBarrel: (slotId) => {
      slots.set(slotId, "empty"); // 重建后容器为空（物品随方块损坏丢失）
      return { ok: true, created: true };
    },
  };
  return { port, pools, record: () => record };
}

/** 造 N 个 occupied 槽位的状态表 */
function occupiedSlots(n: number): Map<number, SlotStatus> {
  const slots = new Map<number, SlotStatus>();
  for (let i = 0; i < n; i++) slots.set(i, "occupied");
  return slots;
}

test("checkAndRepair：全正常 → 无丢失无修复，洞池不变", () => {
  const { port, record } = makeRepairWorld(occupiedSlots(10), new Map());
  const report = checkAndRepair(port, LAYOUT);
  assert.equal(report.scanned, 10);
  assert.equal(report.fixedBarrels, 0);
  assert.deepEqual(report.lostSlots, []);
  assert.equal(report.unknownSlots, 0);
  assert.equal(record().meta.nextFree, 10); // 水印不动
});

test("checkAndRepair：桶方块损坏 → 重建木桶 + 报告丢失槽（物品随方块丢失）", () => {
  const slots = occupiedSlots(10);
  slots.set(3, "damaged"); // 桶 0 槽 3 所在木桶被破坏（变空气/其它方块）
  slots.set(8, "damaged");
  const { port, record } = makeRepairWorld(slots, new Map());
  const report = checkAndRepair(port, LAYOUT);
  assert.equal(report.fixedBarrels, 2); // 两处都重建
  assert.deepEqual(
    report.lostSlots.sort((a, b) => a - b),
    [3, 8]
  ); // 重建后为空 = 丢失
  // 丢失槽已回收为洞（容量恢复可复用）
  assert.deepEqual(record().meta.holeLevels, [0]);
  assert.equal(record().meta.holeCount, 2);
});

test("checkAndRepair：元数据占用但实物空（外部取走）→ 报告丢失并回收为洞", () => {
  const slots = occupiedSlots(10);
  slots.set(5, "empty"); // 外部取走/意外消失（非洞池登记）
  const { port, record, pools } = makeRepairWorld(slots, new Map());
  const report = checkAndRepair(port, LAYOUT);
  assert.deepEqual(report.lostSlots, [5]);
  assert.equal(report.fixedBarrels, 0);
  // 巡检后洞池含槽 5（可再次分配）
  assert.deepEqual(record().meta.holeLevels, [0]);
  assert.ok(pools.get(0)?.includes(5));
  // 实测可复用：allocate 出 5
  const meta = record().meta;
  const pools2 = createLevelPools(LAYOUT.maxLevels);
  pools2.byLevel[0] = [...(pools.get(0) ?? [])];
  assert.equal(allocateSlotId(meta, pools2, 10 * 27, 27), 5);
});

test("checkAndRepair：洞池内已知空槽不误报；unknown 跳过不误修", () => {
  const slots = occupiedSlots(10);
  slots.set(2, "empty"); // 洞池登记的洞（正常 take 释放）
  slots.set(7, "unknown"); // 区块未加载
  const holes = new Map<number, number[]>([[0, [2]]]);
  const { port, record } = makeRepairWorld(slots, holes);
  const report = checkAndRepair(port, LAYOUT);
  assert.deepEqual(report.lostSlots, []); // 洞不误报、unknown 不误报
  assert.equal(report.unknownSlots, 1);
  assert.equal(report.fixedBarrels, 0);
  // 洞池保留
  assert.deepEqual(record().meta.holeLevels, [0]);
  assert.equal(record().meta.holeCount, 1);
});

test("checkAndRepair：非木桶方块（含其它容器）→ 一律重建覆盖", () => {
  const slots = occupiedSlots(10);
  slots.set(4, "damaged"); // 有人在阵列坐标放了箱子/其它方块（预期之外的干扰）
  const { port, record } = makeRepairWorld(slots, new Map());
  const events: string[] = [];
  const report = checkAndRepair(port, LAYOUT, (e) => {
    if (e.type === "barrel-restored") events.push(`restored:${e.slotId}`);
  });
  assert.equal(report.fixedBarrels, 1); // 直接覆盖重建
  assert.deepEqual(report.lostSlots, [4]);
  assert.deepEqual(events, ["restored:4"]);
  assert.equal(record().meta.holeCount, 1); // 覆盖后空槽回收
});

test("checkAndRepair：丢失原因区分（桶损坏 vs 外部取走）+ onEvent 回调", () => {
  const slots = occupiedSlots(10);
  slots.set(3, "damaged"); // 桶损坏
  slots.set(6, "empty"); // 外部取走
  const { port } = makeRepairWorld(slots, new Map());
  const events: string[] = [];
  const report = checkAndRepair(port, LAYOUT, (e) => {
    if (e.type === "barrel-restored") events.push(`restored:${e.slotId}`);
    if (e.type === "item-lost") events.push(`lost:${e.slotId}:${e.kind}`);
  });
  assert.deepEqual(
    report.lostDetails.sort((a, b) => a.slotId - b.slotId),
    [
      { slotId: 3, kind: "barrel-destroyed" },
      { slotId: 6, kind: "taken-externally" },
    ]
  );
  assert.deepEqual(events.sort(), ["lost:3:barrel-destroyed", "lost:6:taken-externally", "restored:3"]);
});

test("checkAndRepair：洞在损坏桶中 → 重建桶但不误报物品丢失", () => {
  // 槽 3 是洞（曾 take 释放），槽 8 有实物；两者所在桶被破坏（damaged）
  const slots = occupiedSlots(10);
  slots.set(3, "damaged");
  slots.set(8, "damaged");
  const holes = new Map<number, number[]>([[0, [3]]]); // 槽 3 登记为洞
  const { port, record } = makeRepairWorld(slots, holes);
  const report = checkAndRepair(port, LAYOUT);
  assert.ok(report.fixedBarrels >= 1); // 桶已重建（mock 每槽计一次 created，真实同桶只计一次）
  assert.deepEqual(report.lostSlots, [8]); // 只有有物的槽 8 报丢失；洞槽 3 不误报
  assert.deepEqual(report.lostDetails, [{ slotId: 8, kind: "barrel-destroyed" }]);
  assert.equal(record().meta.holeCount, 2); // 洞 3 保留 + 丢失槽 8 回收为洞（容量恢复）
});

test("checkAndRepair：真实 put 流程后外部破坏一个桶 → 巡检修复并释放容量", () => {
  // 用 putItem 真实写入 27 槽桶（桶 0 满），然后模拟桶 0 被挖（槽全空 + damaged）
  const layout = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };
  const world = (() => {
    let record: PersistedRegion | undefined;
    const barrels = new Map<string, boolean[]>();
    const pools = new Map<number, number[]>();
    const port = {
      readRecord: () => (record ? (JSON.parse(JSON.stringify(record)) as PersistedRegion) : undefined),
      writeRecord: (r: PersistedRegion) => {
        record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
      },
      readLevelPool: (level: number) => pools.get(level) ?? [],
      writeLevelPool: (level: number, locals: number[]) => {
        pools.set(level, [...locals]);
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
    return { port, barrels, pools, record: () => record };
  })();
  for (let n = 0; n < 27; n++) putItem(world.port, `i${n}`, RID, DIM, layout);
  assert.equal(world.record()?.meta.nextFree, 27);

  // 桶 0（0,120,0）被挖掉 → 变成空气
  world.barrels.delete("0,120,0");
  const repairPort: RepairPort = {
    readRecord: world.port.readRecord,
    writeRecord: world.port.writeRecord,
    readLevelPool: world.port.readLevelPool,
    writeLevelPool: world.port.writeLevelPool,
    probeSlot: (slotId) => {
      // slotId < 27 都在桶 0：桶被重建后为空，否则 damaged；其余 occupied（真实 put 的桶 1..）
      if (slotId >= 27) return "occupied";
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
  assert.equal(report.fixedBarrels, 1); // 一个桶（27 个槽只计一次重建）
  assert.equal(report.lostSlots.length, 27); // 桶 0 全部 27 格丢失
  // 容量恢复：27 个空槽全部回归洞池，可复用
  assert.equal(world.record()?.meta.holeCount, 27);
  const meta = world.record()?.meta;
  assert.ok(meta);
  const pools2 = createLevelPools(layout.maxLevels);
  pools2.byLevel[0] = [...(world.pools.get(0) ?? [])];
  const reused = allocateSlotId(meta, pools2, 6912 * 4, 27);
  assert.ok(reused !== null && reused < 27); // 复用丢失的桶 0 槽之一（洞池 LIFO，不保证最小）
});
