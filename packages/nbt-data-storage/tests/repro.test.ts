// ── 调整每桶槽数后的"对齐存储"验证 ────────────────────────────────
// 场景：1 槽/桶存了 5 件（桶 0-4 各占槽 0）→ 调整到 27 槽/桶
// → 继续 put 必须**先填前面的空桶空槽**（桶 0 的槽 1、槽 2…），而不是物化新桶。
// 依赖桶水位的"未满桶优先 + 桶内真值探测"分配（v3，无空洞登记）。
import test from "node:test";
import assert from "node:assert/strict";
import { putItem, type PutPort } from "../src/core/put";
import { rebuildUsage, resizeLayout } from "../src/core/region";
import type { PersistedRegion } from "../src/core/record";
import { slotIdToPosition } from "../src/core/layout";

const RID = "2:0:0";
const DIM = "minecraft:the_end";

function makeWorld() {
  let record: PersistedRegion | undefined;
  const barrels = new Map<string, boolean[]>();
  const usage = new Map<number, number[]>();
  const port: PutPort = {
    readRecord: () => (record ? (JSON.parse(JSON.stringify(record)) as PersistedRegion) : undefined),
    writeRecord: (r) => {
      record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
    },
    readLevelUsage: (level) => usage.get(level) ?? [],
    writeLevelUsage: (level, arr) => {
      usage.set(level, [...arr]);
    },
    ensureBarrel: (x, y, z) => {
      const k = `${x},${y},${z}`;
      if (barrels.has(k)) return { ok: true, created: false };
      barrels.set(k, new Array(27).fill(false));
      return { ok: true, created: true };
    },
    isSlotOccupied: (x, y, z, slot) => barrels.get(`${x},${y},${z}`)?.[slot] ?? false,
    writeItem: (x, y, z, slot) => {
      const b = barrels.get(`${x},${y},${z}`);
      if (!b) return false;
      b[slot] = true;
      return true;
    },
  };
  return { port, barrels, usage, record: () => record };
}

test("对齐存储：1 槽 → 27 槽后，新 put 先填前面的空桶空槽（最小桶优先）", () => {
  const world = makeWorld();
  const L1 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, slotPerBarrel: 1, test: true };
  // 1 槽模式存 5 件：slotId 0,27,54,81,108（桶 0-4 各占槽 0）
  for (let n = 0; n < 5; n++) putItem(world.port, `i${n}`, RID, DIM, L1);
  assert.deepEqual(world.usage.get(0), [1, 1, 1, 1, 1]); // 5 桶各占 1

  // 调整到 27 槽 + 重建桶水位（StoredRegion.resizeLayout 的完整流程）
  assert.equal(resizeLayout(world.port, world.record()!.layout, { slotPerBarrel: 27 }), null);
  rebuildUsage(
    {
      readRecord: world.port.readRecord,
      writeRecord: world.port.writeRecord,
      readLevelUsage: world.port.readLevelUsage,
      writeLevelUsage: world.port.writeLevelUsage,
      probeSlot: (slotId) => {
        const p = slotIdToPosition(slotId, world.record()!.layout);
        return p ? (world.barrels.get(`${p.x},${p.y},${p.z}`)?.[p.slotInBarrel] ?? false) : false;
      },
    },
    world.record()!.layout
  );
  assert.deepEqual(world.usage.get(0), [1, 1, 1, 1, 1]); // 对齐后仍各占 1

  // 继续 put 3 件 → 桶 0 未满（计数 1 < 27）→ 桶内探测槽 0 被占 → 槽 1、2、3
  const ids: number[] = [];
  for (let n = 0; n < 3; n++) {
    const ref = putItem(world.port, `n${n}`, RID, DIM, world.record()!.layout);
    ids.push(ref?.slotId ?? -1);
  }
  assert.deepEqual(ids, [1, 2, 3]); // 先填前面的空桶空槽（对齐存储）
  assert.deepEqual(world.usage.get(0), [4, 1, 1, 1, 1]); // 桶 0 计数 4，其余不动
});

test("对齐存储：take 后空桶/空槽分配优先级——计数未满桶优先于物化新桶", () => {
  const world = makeWorld();
  const L = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };
  // 填满桶 0（27 件）+ 桶 1 放 1 件
  for (let n = 0; n < 27; n++) putItem(world.port, `f${n}`, RID, DIM, L);
  putItem(world.port, "b", RID, DIM, L); // slotId 27（桶 1 槽 0）
  assert.deepEqual(world.usage.get(0), [27, 1]);
  // 模拟 take 桶 1 的件：清真值 + 计数回滚
  world.barrels.get("1,120,0")![0] = false;
  const u = world.usage.get(0) ?? [];
  u[1] -= 1;
  world.usage.set(0, u);
  assert.deepEqual(world.usage.get(0), [27, 0]);
  // 新 put → 桶 1 计数 0 < 27 → 桶内槽 0 空 → 复用（不物化桶 2）
  const ref = putItem(world.port, "c", RID, DIM, L);
  assert.equal(ref?.slotId, 27); // 桶 1 槽 0
  assert.deepEqual(world.usage.get(0), [27, 1]);
});