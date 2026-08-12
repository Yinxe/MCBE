// ── 调整每桶槽数后的"对齐存储"验证 ────────────────────────────────
// 场景：1 槽/桶存了 5 件（桶 0-4 各占槽 0，水印 109）→ 调整到 27 槽/桶
// → 继续 put 必须**先填前面的空槽**（桶 0 槽 1、槽 2…），而不是从水印附近倒着填。
// 依赖 rebuildPools 的洞池降序存储约定（pop 取最小空槽）。
import test from "node:test";
import assert from "node:assert/strict";
import { putItem, type PutPort } from "../src/core/put";
import { rebuildPools, resizeLayout } from "../src/core/region";
import type { PersistedRegion } from "../src/core/record";
import { slotIdToPosition } from "../src/core/layout";

const RID = "2:0:0";
const DIM = "minecraft:the_end";

function makeWorld() {
  let record: PersistedRegion | undefined;
  const barrels = new Map<string, boolean[]>();
  const pools = new Map<number, number[]>();
  const port: PutPort = {
    readRecord: () => (record ? (JSON.parse(JSON.stringify(record)) as PersistedRegion) : undefined),
    writeRecord: (r) => {
      record = JSON.parse(JSON.stringify(r)) as PersistedRegion;
    },
    readLevelPool: (level) => pools.get(level) ?? [],
    writeLevelPool: (level, locals) => {
      pools.set(level, [...locals]);
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
  return { port, barrels, pools, record: () => record };
}

test("对齐存储：1 槽 → 27 槽后，新 put 先填前面的空槽（最小洞优先）", () => {
  const world = makeWorld();
  const L1 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, slotPerBarrel: 1, test: true };
  // 1 槽模式存 5 件：slotId 0,27,54,81,108（桶 0-4 各占槽 0）
  for (let n = 0; n < 5; n++) putItem(world.port, `i${n}`, RID, DIM, L1);
  assert.equal(world.record()?.meta.nextFree, 109);

  // 调整到 27 槽 + 重建洞池（StoredRegion.resizeLayout 的完整流程）
  assert.equal(resizeLayout(world.port, world.record()!.layout, { slotPerBarrel: 27 }), null);
  rebuildPools(
    {
      readRecord: world.port.readRecord,
      writeRecord: world.port.writeRecord,
      readLevelPool: world.port.readLevelPool,
      writeLevelPool: world.port.writeLevelPool,
      probeSlot: (slotId) => {
        const p = slotIdToPosition(slotId, world.record()!.layout);
        return p ? (world.barrels.get(`${p.x},${p.y},${p.z}`)?.[p.slotInBarrel] ?? false) : false;
      },
    },
    world.record()!.layout
  );
  assert.equal(world.record()?.meta.holeCount, 104); // 桶 0-4 的 26×4=104 个空槽（桶4 槽1-26 = 26，共 5×26=130？5 桶 × 26 = 130…）
  // 实际：桶 0-4 各 27 槽，占 5 个（槽 0），空 26×5=130；水印 109 内空槽 = 109-5=104（水印只到 108，桶 4 槽 10 之后未分配不扫）
  // 断言以运行值为主：洞池降序（大 local 在底）

  // 继续 put 3 件 → 必须复用**最小**洞（桶 0 槽 1、2、3）
  const ids: number[] = [];
  for (let n = 0; n < 3; n++) {
    const ref = putItem(world.port, `n${n}`, RID, DIM, world.record()!.layout);
    ids.push(ref?.slotId ?? -1);
  }
  assert.deepEqual(ids, [1, 2, 3]); // 先填前面的空槽（对齐存储）
  assert.equal(world.record()?.meta.nextFree, 109); // 水印不动（复用洞）
});
