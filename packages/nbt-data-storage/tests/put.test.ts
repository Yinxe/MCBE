import test from "node:test";
import assert from "node:assert/strict";
import { putItem, releaseSlot, type PutPort } from "../src/core/put";
import { SLOTS_PER_LEVEL } from "../src/core/layout";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";

const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };
const DIM = "minecraft:the_end";
const RID = "2:0:0";

/**
 * 内存世界替身：DP 记录（读改写，读/写都深拷贝模拟真实 DP）+ 木桶阵列（世界真值）+ 按层空洞池。
 * 物品用字符串代指（不透明引用），验证的是 put 编排的原子/防覆盖语义。
 */
function makeWorld(maxLevels = 4) {
  let record: PersistedRegion | undefined;
  const barrels = new Map<string, boolean[]>(); // "x,y,z" -> 27 槽占用标记
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

test("putItem：顺序分配，跨桶边界新建桶，barrelCount 精确", () => {
  const { port, barrels, record } = makeWorld(4);
  for (let i = 0; i < 27; i++) {
    const ref = putItem(port, `i${i}`, RID, DIM, LAYOUT);
    assert.deepEqual(ref, { regionId: RID, slotId: i });
  }
  // 第 28 个进入第 1 桶（slotId 27）
  const ref28 = putItem(port, "x", RID, DIM, LAYOUT);
  assert.equal(ref28?.slotId, 27);
  assert.equal(record()?.meta.barrelCount, 2); // 桶 0 + 桶 1
  assert.equal(barrels.size, 2);
  assert.equal(record()?.meta.nextFree, 28);
});

test("putItem：目标槽被世界占用 → 丢弃候选换下一候选，绝不覆盖他人物品", () => {
  const { port, barrels } = makeWorld(4);
  const b0: boolean[] = new Array(27).fill(false);
  b0[0] = true;
  b0[1] = true; // 模拟外部占用槽 0、1
  barrels.set("0,120,0", b0);
  const ref = putItem(port, "sword", RID, DIM, LAYOUT);
  assert.equal(ref?.slotId, 2); // 跳过 0、1
  assert.equal(b0[0], true); // 外部物品未被覆盖
  assert.equal(b0[1], true);
  assert.equal(b0[2], true); // 我们的物品写入槽 2
});

test("putItem：物化失败 → 槽回空洞池并返回 null，下次重试复用同槽", () => {
  let failOnce = true;
  const { port, pools, record } = makeWorld(4);
  const failingPort: PutPort = {
    ...port,
    ensureBarrel: (x, y, z) => {
      if (failOnce) {
        failOnce = false;
        return { ok: false, created: false };
      }
      return port.ensureBarrel(x, y, z);
    },
  };
  const r1 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r1, null);
  assert.deepEqual(pools.get(0), [0]); // 槽 0 回洞池
  assert.equal(record()?.meta.holeCount, 1);
  const r2 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r2?.slotId, 0); // 复用同槽
});

test("putItem：写入失败 → 槽回空洞池并返回 null，不烧水印", () => {
  let failOnce = true;
  const { port, pools } = makeWorld(4);
  const failingPort: PutPort = {
    ...port,
    writeItem: (x, y, z, slot, item) => {
      if (failOnce) {
        failOnce = false;
        return false;
      }
      return port.writeItem(x, y, z, slot, item);
    },
  };
  const r1 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r1, null);
  assert.deepEqual(pools.get(0), [0]);
  const r2 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r2?.slotId, 0);
});

test("putItem：容量满（水印触顶且无洞）→ null", () => {
  const { port } = makeWorld(4);
  const rec = createRegionRecord(DIM, LAYOUT);
  rec.meta.nextFree = 4 * SLOTS_PER_LEVEL; // 水印触顶
  port.writeRecord(rec);
  const r = putItem(port, "a", RID, DIM, LAYOUT);
  assert.equal(r, null);
});

test("putItem：世界真值全占 → 有界重试耗尽返回 null（不覆盖、不无限循环）", () => {
  const { port, barrels } = makeWorld(4);
  // 前 3 桶（槽 0..80）全部占用，覆盖 64 次重试
  for (let b = 0; b < 3; b++) {
    barrels.set(`${b},120,0`, new Array(27).fill(true));
  }
  const r = putItem(port, "a", RID, DIM, LAYOUT);
  assert.equal(r, null);
  assert.equal(barrels.get("0,120,0")?.[0], true); // 外部物品原样
});

test("putItem：释放的洞被后续 put 复用；复用旧桶不重复计桶数", () => {
  const { port, barrels, pools, record } = makeWorld(4);
  const r1 = putItem(port, "a", RID, DIM, LAYOUT); // slot 0（建桶 0）
  assert.equal(r1?.slotId, 0);
  putItem(port, "b", RID, DIM, LAYOUT); // slot 1
  assert.equal(record()?.meta.barrelCount, 1);
  // 模拟 take(slot 1)：先清世界槽（真值），再回收空洞（软状态）
  const b0 = barrels.get("0,120,0")!;
  b0[1] = false;
  releaseSlot(port, 1, DIM, LAYOUT);
  assert.deepEqual(pools.get(0), [1]);
  // 再 put → 复用洞 1（桶 0 已存在 → 桶数不增）
  const r3 = putItem(port, "c", RID, DIM, LAYOUT);
  assert.equal(r3?.slotId, 1);
  assert.equal(record()?.meta.barrelCount, 1);
  // 无洞后回水印
  const r4 = putItem(port, "d", RID, DIM, LAYOUT);
  assert.equal(r4?.slotId, 2);
});

test("putItem：空物品/未定义物品 → null，无副作用", () => {
  const { port, record } = makeWorld(4);
  assert.equal(putItem(port, undefined, RID, DIM, LAYOUT), null);
  assert.equal(putItem(port, null, RID, DIM, LAYOUT), null);
  assert.equal(record(), undefined);
});
