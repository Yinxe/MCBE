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

test("putItem：区域真满（无洞水印触顶）→ 返回 null 且不新建桶", () => {
  const { port, barrels } = makeWorld(4);
  const rec = createRegionRecord(DIM, LAYOUT);
  rec.meta.nextFree = 4 * SLOTS_PER_LEVEL; // 水印触顶
  port.writeRecord(rec);
  const before = barrels.size;
  assert.equal(putItem(port, "a", RID, DIM, LAYOUT), null);
  assert.equal(barrels.size, before); // 拒绝时绝不建桶
});

test("putItem：有可用空位先用空位，无空位才扩容建新桶", () => {
  const { port, barrels } = makeWorld(4);
  putItem(port, "a", RID, DIM, LAYOUT); // slot 0（建桶 0）
  putItem(port, "b", RID, DIM, LAYOUT); // slot 1
  // 模拟 take(slot 0)：先清世界槽（真值），再回收空洞
  barrels.get("0,120,0")![0] = false;
  releaseSlot(port, 0, DIM, LAYOUT);
  const barrelsBefore = barrels.size;
  const r = putItem(port, "c", RID, DIM, LAYOUT);
  assert.equal(r?.slotId, 0); // 复用洞，而非扩到 slot 2
  assert.equal(barrels.size, barrelsBefore); // 未新建桶
});

test("putItem：并发扩容到同一新桶 → 后者因世界占用改选同桶下一槽，不覆盖前者写入", () => {
  const { port, barrels } = makeWorld(4);
  // 填满桶 0（槽 0..26），使水印到 27
  for (let i = 0; i < 27; i++) putItem(port, `f${i}`, RID, DIM, LAYOUT);
  // 模组 A 扩容：写入槽 27（建新桶，位置 1,120,0）
  const ra = putItem(port, "A", RID, DIM, LAYOUT);
  assert.equal(ra?.slotId, 27);
  // 模拟模组 B 读到 A 提交前的陈旧元数据（水印仍为 27），但世界里 A 的物品已在槽 27
  const stale = createRegionRecord(DIM, LAYOUT);
  stale.meta.nextFree = 27;
  port.writeRecord(stale);
  const r = putItem(port, "B", RID, DIM, LAYOUT);
  assert.equal(r?.slotId, 28); // 撞槽 27（新桶 slot 0）→ 改选槽 28（同桶 slot 1）
  assert.equal(barrels.get("1,120,0")?.[0], true); // A 的数据未被覆盖
  assert.equal(barrels.get("1,120,0")?.[1], true); // B 落在同桶下一槽
});

test("putItem：物化目标被非木桶方块占用（他人容器）→ 跳过候选，绝不替换他人方块", () => {
  const { port, barrels, record } = makeWorld(4);
  // 模拟"水印推进的目标位置"已被他人放了箱子：ensureBarrel 返回 occupied
  const guarded: PutPort = {
    ...port,
    ensureBarrel: (x, y, z) => {
      const k = `${x},${y},${z}`;
      if (barrels.has(k)) return { ok: true, created: false };
      return { ok: false, created: false, occupied: true }; // 其它方块：不替换
    },
  };
  // 全部候选位置都 occupied → 有界重试耗尽 → null，一个桶都没建
  assert.equal(putItem(guarded, "x", RID, DIM, LAYOUT), null);
  assert.equal(barrels.size, 0); // 未被替换
  assert.equal(record()?.meta.barrelCount, 0);
});

test("putItem：物化目标被占用时跳过；后续候选可用则成功写入正确槽位", () => {
  const { port, barrels } = makeWorld(4);
  // 只让"桶 0"位置（0,120,0）返回 occupied（模拟他人方块），其余正常物化
  const guarded: PutPort = {
    ...port,
    ensureBarrel: (x, y, z) => {
      if (x === 0 && y === 120 && z === 0) return { ok: false, created: false, occupied: true };
      return port.ensureBarrel(x, y, z);
    },
  };
  // 桶 0 的 27 个槽（slotId 0..26）目标位置全被占用 → 跳过 → slotId 27 落桶 1（1,120,0）
  const ref = putItem(guarded, "x", RID, DIM, LAYOUT);
  assert.equal(ref?.slotId, 27);
  assert.equal(barrels.has("0,120,0"), false); // 他人方块未被替换
  assert.equal(barrels.has("1,120,0"), true);
});
