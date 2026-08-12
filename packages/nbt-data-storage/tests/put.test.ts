import test from "node:test";
import assert from "node:assert/strict";
import { putItem, decrementUsage, type PutPort } from "../src/core/put";
import { BARREL_SLOTS } from "../src/core/layout";
import { createRegionRecord, type PersistedRegion } from "../src/core/record";

const LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 };
const DIM = "minecraft:the_end";
const RID = "2:0:0";

/**
 * 内存世界替身：DP 记录（读改写，读/写都深拷贝模拟真实 DP）+ 木桶阵列（世界真值）
 * + 按层桶水位（占用计数数组）。物品用字符串代指（不透明引用），
 * 验证的是 put 编排的原子/防覆盖语义。
 */
function makeWorld(maxLevels = 4) {
  let record: PersistedRegion | undefined;
  const barrels = new Map<string, boolean[]>(); // "x,y,z" -> 27 槽占用标记
  const usage = new Map<number, number[]>(); // level -> 已物化桶的占用计数
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

test("putItem：顺序分配，跨桶边界新建桶，barrelCount 与桶水位精确", () => {
  const { port, barrels, usage, record } = makeWorld(4);
  for (let i = 0; i < 27; i++) {
    const ref = putItem(port, `i${i}`, RID, DIM, LAYOUT);
    assert.deepEqual(ref, { regionId: RID, slotId: i });
  }
  // 第 28 个进入第 1 桶（slotId 27）→ 物化新桶
  const ref28 = putItem(port, "x", RID, DIM, LAYOUT);
  assert.equal(ref28?.slotId, 27);
  assert.equal(record()?.meta.barrelCount, 2); // 桶 0 + 桶 1
  assert.equal(barrels.size, 2);
  assert.deepEqual(usage.get(0), [27, 1]); // 桶 0 满 27、桶 1 占 1
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

test("putItem：物化失败 → 无副作用并返回 null，下次重试复用同槽", () => {
  let failOnce = true;
  const { port, usage, record } = makeWorld(4);
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
  assert.equal(record(), undefined); // 未建桶无任何持久化副作用
  assert.equal(usage.has(0), false); // 水位无残留
  const r2 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r2?.slotId, 0); // 计数无残留 → 桶 0 未满 → 复用同槽
  assert.deepEqual(usage.get(0), [1]);
});

test("putItem：写入失败 → 回滚桶水位并返回 null，不烧计数", () => {
  let failOnce = true;
  const { port, usage } = makeWorld(4);
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
  assert.deepEqual(usage.get(0), [0]); // 回滚：桶 0 计数 1 → 0（登记保留，计数清零）
  const r2 = putItem(failingPort, "a", RID, DIM, LAYOUT);
  assert.equal(r2?.slotId, 0);
});

test("putItem：容量满（全部层桶满）→ null，不建新桶", () => {
  const L1 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1 };
  const { port, barrels, usage } = makeWorld(1);
  // 层 0 已物化 256 桶且全部计数满 → 无可用槽、无物化位置
  usage.set(0, new Array(256).fill(27));
  for (let b = 0; b < 256; b++) barrels.set(`${b},120,0`, new Array(27).fill(true));
  const before = barrels.size;
  assert.equal(putItem(port, "a", RID, DIM, L1), null);
  assert.equal(barrels.size, before); // 拒绝时绝不建桶
});

test("putItem：世界真值全占 → 外部桶被伪满跳过，继续物化后续新桶（不覆盖）", () => {
  const { port, barrels } = makeWorld(4);
  // 前 3 桶（槽 0..80）被外部塞满（无水位登记）
  for (let b = 0; b < 3; b++) {
    barrels.set(`${b},120,0`, new Array(27).fill(true));
  }
  const r = putItem(port, "a", RID, DIM, LAYOUT);
  assert.equal(r?.slotId, 81); // 桶 0-2 探测全占用 → 伪满跳过 → 物化桶 3 → 槽 0
  assert.equal(barrels.get("0,120,0")?.[0], true); // 外部物品原样
  assert.equal(barrels.get("1,120,0")?.[0], true);
  assert.equal(barrels.get("2,120,0")?.[0], true);
});

test("putItem：take 释放后空槽被复用；复用旧桶不重复计桶数", () => {
  const { port, barrels, usage, record } = makeWorld(4);
  const r1 = putItem(port, "a", RID, DIM, LAYOUT); // slot 0（建桶 0）
  assert.equal(r1?.slotId, 0);
  putItem(port, "b", RID, DIM, LAYOUT); // slot 1
  assert.equal(record()?.meta.barrelCount, 1);
  // 模拟 take(slot 1)：先清世界槽（真值），再回滚桶水位
  barrels.get("0,120,0")![1] = false;
  decrementUsage(port, 1, LAYOUT);
  assert.deepEqual(usage.get(0), [1]); // 桶 0 计数 2→1
  // 再 put → 桶 0 未满 → 桶内探测复用槽 1（桶已存在 → 桶数不增）
  const r3 = putItem(port, "c", RID, DIM, LAYOUT);
  assert.equal(r3?.slotId, 1);
  assert.equal(record()?.meta.barrelCount, 1);
});

test("putItem：空物品/未定义物品 → null，无副作用", () => {
  const { port, record } = makeWorld(4);
  assert.equal(putItem(port, undefined, RID, DIM, LAYOUT), null);
  assert.equal(putItem(port, null, RID, DIM, LAYOUT), null);
  assert.equal(record(), undefined);
});

test("putItem：并发扩容到同一新桶 → 后者因世界占用改选同桶下一槽，不覆盖前者写入", () => {
  const { port, barrels } = makeWorld(4);
  // 填满桶 0（槽 0..26），使水位满
  for (let i = 0; i < 27; i++) putItem(port, `f${i}`, RID, DIM, LAYOUT);
  // 模组 A 扩容：写入槽 27（建新桶，位置 1,120,0）
  const ra = putItem(port, "A", RID, DIM, LAYOUT);
  assert.equal(ra?.slotId, 27);
  // 模拟模组 B 读到 A 提交前的陈旧桶水位（桶 0 满），但世界里 A 的物品已在槽 27
  // → B 探测槽 27 被占用 → 改选槽 28（同桶下一槽）
  const r = putItem(port, "B", RID, DIM, LAYOUT);
  assert.equal(r?.slotId, 28);
  assert.equal(barrels.get("1,120,0")?.[0], true); // A 的数据未被覆盖
  assert.equal(barrels.get("1,120,0")?.[1], true); // B 落在同桶下一槽
});

test("putItem：物化目标被非木桶方块占用（他人容器）→ 伪满跳过候选，绝不替换他人方块", () => {
  const { port, barrels, record, usage } = makeWorld(4);
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
  assert.equal(record(), undefined); // 从未物化 → 无持久化副作用
  assert.equal(usage.get(0)?.length, 256); // 层 0 全部位置被标记伪满（永久跳过）
  assert.ok((usage.get(0) ?? []).every((u) => u === 27));
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

test("putItem：每桶 1 槽（微型）→ ID 只落桶内槽 0（0,27,54,…），256 次填满后第 257 次拒绝", () => {
  const MICRO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1 };
  const { port, record } = makeWorld(1);
  const barrelCounts: number[] = [];
  for (let n = 0; n < 256; n++) {
    const ref = putItem(port, `i${n}`, RID, DIM, MICRO);
    assert.equal(ref?.slotId, n * BARREL_SLOTS); // ID 按 27 桶语义分布
    barrelCounts.push(record()?.meta.barrelCount ?? 0);
  }
  // 扩容见证：每次 put 都物化一个新桶（桶数 1 → 256 单调递增）
  assert.equal(barrelCounts[0], 1);
  assert.equal(barrelCounts[255], 256);
  // 第 257 次：全部 256 桶水位满 → 拒绝
  assert.equal(putItem(port, "overflow", RID, DIM, MICRO), null);
  assert.equal(record()?.meta.barrelCount, 256); // 绝不建第 257 桶
});

test("putItem：物化后容器未就绪（探测失败）→ 刚建桶直接写槽 0，不误判伪满、不虚增桶数", () => {
  // 回归：MCBE setBlockType 后同 tick 容器组件可能未就绪——旧逻辑物化后探测失败
  // → 误判"被塞满"→ 伪满占位 → 下一位置再物化（barrelCount 虚增，出现"桶 257/256"）。
  // 修复：刚物化的桶必空（同 tick 内外部无法插入），直接写槽 0，不做探测。
  const MICRO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1 };
  const { port, barrels, usage, record } = makeWorld(1);
  const justCreated = new Set<string>(); // 刚物化未就绪的桶位置
  const delayed: PutPort = {
    ...port,
    ensureBarrel: (x, y, z) => {
      const r = port.ensureBarrel(x, y, z);
      if (r.created) justCreated.add(`${x},${y},${z}`);
      return r;
    },
    findEmptySlotInBarrel: (x, y, z, usable) => {
      // 模拟容器延迟：刚物化的桶探测不到（返回 null）；已就绪的桶正常
      const k = `${x},${y},${z}`;
      if (justCreated.has(k)) return null;
      const b = barrels.get(k);
      if (!b) return null;
      for (let j = 0; j < usable; j++) if (!b[j]) return j;
      return null;
    },
  };
  for (let n = 0; n < 256; n++) {
    const ref = putItem(delayed, `i${n}`, RID, DIM, MICRO);
    assert.equal(ref?.slotId, n * 27); // 全部成功（直接写槽 0）
  }
  // 256 件 = 256 桶：无虚增、无伪满占位
  assert.equal(record()?.meta.barrelCount, 256);
  assert.equal(usage.get(0)?.length, 256);
  assert.ok((usage.get(0) ?? []).every((u) => u === 1));
  // 第 257 件：真满拒绝
  assert.equal(putItem(delayed, "overflow", RID, DIM, MICRO), null);
});

test("putItem：0 槽瞬满布局 → 直接 null（不空转）", () => {
  const ZERO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 0 };
  const { port, record } = makeWorld(1);
  assert.equal(putItem(port, "a", RID, DIM, ZERO), null);
  assert.equal(record(), undefined); // 无任何副作用
});

test("putItem：超限槽不分配——每桶 2 槽 → 0,1,27,28", () => {
  const TWO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 2 };
  const { port } = makeWorld(1);
  const ids = [0, 1, 27, 28].map((_n) => putItem(port, "x", RID, DIM, TWO)?.slotId);
  assert.deepEqual(ids, [0, 1, 27, 28]);
});

test("putItem：写入失败回滚（计数 2→1）后重试 → 桶内探测槽 0 占用、槽 1 空 → 复用槽 1", () => {
  const { port, barrels, usage } = makeWorld(4);
  putItem(port, "a", RID, DIM, LAYOUT); // slot 0
  putItem(port, "b", RID, DIM, LAYOUT); // slot 1
  assert.deepEqual(usage.get(0), [2]);
  // 模拟写入 slot 1 失败回滚：真值清空 + 计数回滚（与 putItem 内部回滚一致）
  barrels.get("0,120,0")![1] = false;
  decrementUsage(port, 1, LAYOUT);
  assert.deepEqual(usage.get(0), [1]);
  // 重试：桶 0 未满 → 桶内探测槽 0 占用、槽 1 空 → 复用槽 1
  const r = putItem(port, "c", RID, DIM, LAYOUT);
  assert.equal(r?.slotId, 1);
  assert.deepEqual(usage.get(0), [2]);
});
