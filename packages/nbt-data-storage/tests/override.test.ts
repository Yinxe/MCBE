// ── 测试注册渠道（布局覆盖）单测 ─────────────────────────────────────
// 覆盖 registerTest 的能力面：
//   - 解码恒 27 槽/桶（ID 语义恒定，slotPerBarrel 只约束分配上限）
//   - 微型布局（1 槽/桶 × 1 层 = 256 格）快速满容量 + 每次 put 物化新桶（扩容可见）
//   - 布局参数一致性拒绝（同区块不允许两套分配语义混用）
//   - record 序列化带上 slotPerBarrel
import test from "node:test";
import assert from "node:assert/strict";
import { capacityOf, slotIdToPosition, usableSlotsPerBarrel, validateLayout } from "../src/core/layout";
import { allocateSlotId, createLevelPools, releaseSlotId } from "../src/core/meta";
import { putItem, releaseSlot, type PutPort } from "../src/core/put";
import { assertLayoutConsistent, rebuildPools, resizeLayout, resolveRegistration } from "../src/core/region";
import { createRegionRecord, parseRegionRecord, serializeRegionRecord, type PersistedRegion } from "../src/core/record";

const DIM = "minecraft:the_end";
const RID = "2:0:0";

/** 微型布局：每桶 1 槽 × 1 层（容量 256 格，256 个桶） */
const MICRO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1 };

// ── layout：容量与校验 ────────────────────────────────────────────

test("capacityOf：可用容量 = 层数 × 256 × 每桶可用槽数", () => {
  assert.equal(capacityOf(MICRO), 1 * 256 * 1); // 256
  assert.equal(capacityOf({ ...MICRO, maxLevels: 2 }), 2 * 256 * 1); // 512
  assert.equal(capacityOf({ ...MICRO, slotPerBarrel: 4 }), 1 * 256 * 4); // 1024
  assert.equal(capacityOf({ ...MICRO, slotPerBarrel: 27, maxLevels: 2 }), 2 * 256 * 27); // 与默认一致
});

test("ID 语义恒定：slotPerBarrel 不改变解码——slotId 永远按 27 槽/桶定位", () => {
  // slotPerBarrel=1 时 ID=2 仍指向桶 0 槽 2（而非桶 2 槽 0）——已存数据永不偏移
  assert.deepEqual(slotIdToPosition(2, MICRO), { x: 0, y: 120, z: 0, slotInBarrel: 2 });
  assert.deepEqual(slotIdToPosition(27, MICRO), { x: 1, y: 120, z: 0, slotInBarrel: 0 }); // 桶 1 槽 0（X 先走满）
  assert.deepEqual(slotIdToPosition(54, MICRO), { x: 2, y: 120, z: 0, slotInBarrel: 0 }); // 桶 2 槽 0
  assert.deepEqual(slotIdToPosition(27 * 27, MICRO), { x: 11, y: 120, z: 1, slotInBarrel: 0 }); // 桶 27（X=11,Z=1）
  // 解码上限仍是 27×256×层（层 0 可解到 6912，但分配只用到前 256 个可用槽）
  assert.ok(slotIdToPosition(6900, MICRO)); // 可解码（越界判定用解码容量）
  assert.equal(slotIdToPosition(6912, MICRO), null); // 超出解码上限
});

test("validateLayout：slotPerBarrel 仅接受 0..27 整数（0 = 瞬满测试布局）", () => {
  assert.equal(validateLayout(MICRO), null);
  assert.equal(validateLayout({ ...MICRO, slotPerBarrel: 27 }), null);
  assert.equal(validateLayout({ ...MICRO, slotPerBarrel: 0 }), null); // 0 合法（容量 0）
  assert.ok(validateLayout({ ...MICRO, slotPerBarrel: -1 })?.includes("slotPerBarrel"));
  assert.ok(validateLayout({ ...MICRO, slotPerBarrel: 28 })?.includes("slotPerBarrel"));
  assert.ok(validateLayout({ ...MICRO, slotPerBarrel: 1.5 })?.includes("slotPerBarrel"));
  assert.equal(usableSlotsPerBarrel({ chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 }), 27); // 缺省全可用
});

// ── meta：分配跳过不可用槽 ─────────────────────────────────────────

test("allocateSlotId：每桶 1 槽 → ID 只落在桶内槽 0（0, 27, 54, …）", () => {
  const meta = { v: 2 as const, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools = createLevelPools(1);
  const ids = [0, 27, 54, 81].map(() => allocateSlotId(meta, pools, 6912, 1));
  assert.deepEqual(ids, [0, 27, 54, 81]);
  assert.equal(meta.nextFree, 82); // 水印只推进到最后一个可用 ID+1（余下不可用槽由下轮循环跳过）
  assert.equal(allocateSlotId(meta, pools, 108, 1), null); // 触顶（0,27,54,81 已用，108 起全跳过）
});

test("allocateSlotId：每桶 2 槽 → 0,1,27,28（跳过桶内槽 2..26）", () => {
  const meta = { v: 2 as const, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools = createLevelPools(1);
  const ids = [0, 1, 27, 28].map(() => allocateSlotId(meta, pools, 6912, 2));
  assert.deepEqual(ids, [0, 1, 27, 28]);
});

test("allocateSlotId/releaseSlotId：微型布局的空洞复用只回收到可用槽", () => {
  const meta = { v: 2 as const, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools = createLevelPools(1);
  assert.equal(allocateSlotId(meta, pools, 6912, 1), 0);
  assert.equal(allocateSlotId(meta, pools, 6912, 1), 27);
  releaseSlotId(meta, pools, 27); // 回收桶 1 槽 0（local=27，解码恒按 6912 折算）
  assert.equal(meta.holeCount, 1);
  assert.equal(allocateSlotId(meta, pools, 6912, 1), 27); // 复用空洞
  assert.equal(meta.nextFree, 28); // 水印不受影响（第二次分配已推进到 28）
});

test("releaseSlotId：重复回收同一槽 → 幂等忽略（防洞池重复项/统计虚高）", () => {
  const meta = { v: 2 as const, nextFree: 10, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools = createLevelPools(4);
  releaseSlotId(meta, pools, 5);
  releaseSlotId(meta, pools, 5); // 重复 take 同一空槽
  assert.equal(meta.holeCount, 1);
  assert.deepEqual(pools.byLevel[0], [5]);
  assert.equal(allocateSlotId(meta, pools, 6912), 5); // 洞只被分配一次
  assert.equal(meta.holeCount, 0);
});

test("空槽回收：take 发现槽空 → 回收进洞池且可复用（重复 take 幂等）", () => {
  const world = makeWorld(4);
  const L = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  putItem(world.port, "a", RID, DIM, L); // slotId 0（桶 0 槽 0）
  // 外部取走物品（模拟 take 发现槽空）
  const b0 = world.barrels.get("0,120,0");
  assert.ok(b0);
  b0[0] = false;
  // take 空槽路径 = releaseSlot 回收（重复两次验证幂等）
  releaseSlot(world.port, 0, DIM, L);
  releaseSlot(world.port, 0, DIM, L);
  assert.equal(world.record()?.meta.holeCount, 1);
  assert.deepEqual(world.pools.get(0), [0]);
  // 槽容量恢复可复用
  const ref = putItem(world.port, "b", RID, DIM, L);
  assert.equal(ref?.slotId, 0);
  assert.equal(world.record()?.meta.nextFree, 1); // 水印不变（复用洞）
});

// ── put：微型桶世界（快速满容量 + 扩容见证） ─────────────────────────

/** 内存世界替身：同 put.test.ts 的 makeWorld（木桶恒 27 槽物理容器，前 N 个可分配） */
function makeWorld(_maxLevels = 1) {
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

test("putItem（1 槽/桶 × 1 层）：256 次填满，每次物化新桶（扩容可见），第 257 次拒绝", () => {
  const { port, record } = makeWorld();
  const barrelCounts: number[] = [];
  for (let n = 0; n < 256; n++) {
    const ref = putItem(port, `i${n}`, RID, DIM, MICRO);
    assert.equal(ref?.slotId, n * 27); // ID 按 27 桶语义分布
    barrelCounts.push(record()?.meta.barrelCount ?? 0);
  }
  // 扩容见证：每次 put 都物化一个新桶（桶数 1 → 256 单调递增）
  assert.equal(barrelCounts[0], 1);
  assert.equal(barrelCounts[255], 256);
  assert.equal(record()?.meta.nextFree, 6886); // 水印止于最后可用 ID 6885+1，余下不可用槽由下轮跳过
  // 第 257 次：无空洞且水印触顶 → 拒绝
  assert.equal(putItem(port, "overflow", RID, DIM, MICRO), null);
  assert.equal(record()?.meta.barrelCount, 256); // 绝不建第 257 桶
});

test("putItem（1 槽/桶）：take 回收后空洞复用同一槽", () => {
  const { port, barrels, record } = makeWorld();
  const ref = putItem(port, "a", RID, DIM, MICRO);
  assert.equal(ref?.slotId, 0);
  // 模拟 take：清世界槽位（真值）+ 回收元数据空洞
  const b0 = barrels.get("0,120,0");
  assert.ok(b0);
  b0[0] = false;
  releaseSlot(port, 0, DIM, MICRO);
  assert.equal(record()?.meta.holeCount, 1);
  const ref2 = putItem(port, "b", RID, DIM, MICRO);
  assert.equal(ref2?.slotId, 0); // 复用空洞，不推进水印
  assert.equal(record()?.meta.nextFree, 1);
});

// ── region：布局一致性拒绝规则 ─────────────────────────────────────

test("resolveRegistration：已有记录 + 传入不一致的 slotPerBarrel/maxLevels → 抛错（拒绝混用）", () => {
  const persisted = createRegionRecord(DIM, { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64 });
  assert.throws(
    () => resolveRegistration(persisted, { dimensionId: DIM, slotPerBarrel: 1 }, { cx: 0, cz: 0 }),
    /更换锚点/
  );
  assert.throws(() => resolveRegistration(persisted, { dimensionId: DIM, maxLevels: 1 }, { cx: 0, cz: 0 }), /更换锚点/);
});

test("resolveRegistration：已有记录 + 参数一致（含默认 27/64）→ 采纳共享，不抛错", () => {
  const persisted = createRegionRecord(DIM, { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64 });
  const r1 = resolveRegistration(persisted, { dimensionId: DIM, slotPerBarrel: 27, maxLevels: 64 }, { cx: 0, cz: 0 });
  assert.equal(r1.layout.maxLevels, 64);
  // 正式渠道不传布局参数 → 不校验，采纳（现有行为不变）
  const r2 = resolveRegistration(persisted, { dimensionId: DIM }, { cx: 0, cz: 0 });
  assert.equal(r2.layout.maxLevels, 64);
});

test("resolveRegistration：微型区域已有记录 → 只有相同微型参数可共享", () => {
  const persisted = createRegionRecord(DIM, MICRO);
  assert.throws(
    () => resolveRegistration(persisted, { dimensionId: DIM, slotPerBarrel: 27 }, { cx: 0, cz: 0 }),
    /每桶 1 槽/
  );
  const r = resolveRegistration(persisted, { dimensionId: DIM, slotPerBarrel: 1, maxLevels: 1 }, { cx: 0, cz: 0 });
  assert.equal(r.layout.slotPerBarrel, 1);
});

test("resolveRegistration：全新区域 → 按传入参数创建（缺省 27 槽/64 层）", () => {
  const r1 = resolveRegistration(undefined, { dimensionId: DIM, slotPerBarrel: 1, maxLevels: 1 }, { cx: 0, cz: 0 });
  assert.equal(r1.layout.slotPerBarrel, 1);
  assert.equal(r1.layout.maxLevels, 1);
  const r2 = resolveRegistration(undefined, { dimensionId: DIM }, { cx: 0, cz: 0 });
  assert.equal(r2.layout.slotPerBarrel, 27);
  assert.equal(r2.layout.maxLevels, 64);
});

// ── assertLayoutConsistent：注册缓存路径的布局一致性（mc 层缓存命中时调用） ──

const LAYOUT_27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64, slotPerBarrel: 27 };

test("assertLayoutConsistent：参数一致（含未显式传入）→ 不抛错", () => {
  assert.doesNotThrow(() =>
    assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM, slotPerBarrel: 27, maxLevels: 64 }, 0, 0)
  );
  // 正式 register 不传布局参数 → 不校验不抛错
  assert.doesNotThrow(() => assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM }, 0, 0));
});

test("assertLayoutConsistent：slotPerBarrel/maxLevels 任一不一致 → 抛错提示更换锚点", () => {
  assert.throws(() => assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM, slotPerBarrel: 2 }, 0, 0), /每桶 27 槽/);
  assert.throws(() => assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM, maxLevels: 1 }, 0, 0), /更换锚点/);
  // 缺省字段的既有布局按 27 归一化比较
  const legacy = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64 };
  assert.doesNotThrow(() => assertLayoutConsistent(legacy, { dimensionId: DIM, slotPerBarrel: 27 }, 0, 0));
  assert.throws(() => assertLayoutConsistent(legacy, { dimensionId: DIM, slotPerBarrel: 2 }, 0, 0), /每桶 27 槽/);
});

// ── resizeLayout：测试区域布局动态调整（层 + 每桶槽数） ───────────────
// 直接用 makeWorld 的 PutPort 充当 ResizePort（结构兼容：readRecord/writeRecord 同签名）。
// 注意：resizeLayout 仅 test:true 区域可用，测试布局统一带 test: true。

test("resizeLayout：增大层数 → 记录更新，水印不变，后续分配进入新层", () => {
  const world = makeWorld();
  const L1 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1, test: true };
  for (let n = 0; n < 256; n++) putItem(world.port, `i${n}`, RID, DIM, L1);
  assert.equal(putItem(world.port, "overflow", RID, DIM, world.record()!.layout), null); // 1 层已满
  assert.equal(world.record()?.meta.nextFree, 6886);

  assert.equal(resizeLayout(world.port, world.record()!.layout, { maxLevels: 2 }), null);
  assert.equal(world.record()?.layout.maxLevels, 2);
  assert.equal(world.record()?.layout.slotPerBarrel, 1);
  assert.equal(world.record()?.meta.nextFree, 6886); // 水印不变，已存数据不动

  // 扩容后层 1 可用：第 257 件进入层 1（y=121，桶 0 槽 0，slotId=6912）
  const ref = putItem(world.port, "new", RID, DIM, world.record()!.layout);
  assert.equal(ref?.slotId, 6912);
  assert.equal(world.record()?.meta.nextFree, 6913);
});

test("resizeLayout：减小层数 → 高层仍有物品时拒绝（防孤儿），水印未触达时成功", () => {
  // 层 0 有物品（水印 100 < 6912）→ 缩到 1 层成功
  const world = makeWorld(4);
  const L4 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  for (let n = 0; n < 100; n++) putItem(world.port, `i${n}`, RID, DIM, L4);
  assert.equal(world.record()?.meta.nextFree, 100);
  assert.equal(resizeLayout(world.port, world.record()!.layout, { maxLevels: 1 }), null);
  assert.equal(world.record()?.layout.maxLevels, 1);

  // 高层有数据（水印越过 6912）→ 缩到 1 层拒绝，记录原样
  const w2 = makeWorld(2);
  const L2 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 2, test: true };
  for (let n = 0; n < 7000; n++) putItem(w2.port, `i${n}`, RID, DIM, L2);
  assert.ok((w2.record()?.meta.nextFree ?? 0) > 6912);
  const err = resizeLayout(w2.port, w2.record()!.layout, { maxLevels: 1 });
  assert.ok(err?.includes("无法缩减层数"));
  assert.equal(w2.record()?.layout.maxLevels, 2); // 原样保留
});

test("resizeLayout：调整每桶槽数 → 缩小后新 put 只分配可用槽，旧超限槽物品仍可读可 take", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  // 用 27 槽全量存 7 件（桶 0 槽 0..6）
  for (let n = 0; n < 7; n++) putItem(world.port, `i${n}`, RID, DIM, L27);
  assert.equal(world.record()?.meta.nextFree, 7);

  // 缩到每桶 2 槽
  assert.equal(resizeLayout(world.port, world.record()!.layout, { slotPerBarrel: 2 }), null);
  assert.equal(world.record()?.layout.slotPerBarrel, 2);

  // 新 put 只落在桶内槽 0/1：slotId 0..6 已占用但 2..6 是"超限旧占位"→ 新分配从 27（桶 1 槽 0）开始
  const ref = putItem(world.port, "new", RID, DIM, world.record()!.layout);
  assert.equal(ref?.slotId, 27); // 桶 1 槽 0（桶 0 只有槽 0/1 可用且已占用）
  // 旧超限槽（slotId 2 → 桶 0 槽 2）的物品仍可读
  const pos = slotIdToPosition(2, world.record()!.layout);
  assert.ok(pos);
  assert.equal(world.barrels.get(`${pos.x},${pos.y},${pos.z}`)?.[pos.slotInBarrel], true);
});

test("resizeLayout：每桶槽数 0 → 容量 0，put 全拒（瞬见已满），旧物品仍可取", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  putItem(world.port, "keep", RID, DIM, L27);
  assert.equal(world.record()?.meta.nextFree, 1);

  assert.equal(resizeLayout(world.port, world.record()!.layout, { slotPerBarrel: 0 }), null);
  assert.equal(world.record()?.layout.slotPerBarrel, 0);
  assert.equal(putItem(world.port, "blocked", RID, DIM, world.record()!.layout), null); // 瞬满
  // 已存物品不受影响（解码恒 27）
  const pos = slotIdToPosition(0, world.record()!.layout);
  assert.ok(pos);
  assert.equal(world.barrels.get(`${pos.x},${pos.y},${pos.z}`)?.[pos.slotInBarrel], true);
});

test("resizeLayout：非测试区域 → 拒绝调整", () => {
  const world = makeWorld(4);
  const L = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4 }; // 无 test 标记（正式区域）
  putItem(world.port, "a", RID, DIM, L);
  const err = resizeLayout(world.port, world.record()!.layout, { maxLevels: 2 });
  assert.ok(err?.includes("非测试区域"));
  assert.equal(world.record()?.layout.maxLevels, 4); // 原样
});

test("resizeLayout：非法参数 / 超世界上限 → 拒绝；相同参数 → 无操作", () => {
  const world = makeWorld(4);
  const L4 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  putItem(world.port, "a", RID, DIM, L4);
  const layout = world.record()!.layout;
  assert.ok(resizeLayout(world.port, layout, { maxLevels: 65 })?.includes("1..64"));
  assert.ok(resizeLayout(world.port, layout, { maxLevels: 0 })?.includes("1..64"));
  assert.ok(resizeLayout(world.port, layout, { slotPerBarrel: -1 })?.includes("0..27"));
  assert.ok(resizeLayout(world.port, layout, { slotPerBarrel: 28 })?.includes("0..27"));
  assert.equal(resizeLayout(world.port, layout, {}), null); // 无变化 → 无操作

  // 世界上限：baseY 280 + 64 层 → 顶部 343 > 320
  const wHigh = makeWorld(1);
  const LHigh = { chunkX: 0, chunkZ: 0, baseY: 280, maxLevels: 1, test: true };
  putItem(wHigh.port, "a", RID, DIM, LHigh);
  assert.ok(resizeLayout(wHigh.port, wHigh.record()!.layout, { maxLevels: 64 })?.includes("320"));
});

// ── rebuildPools：调整后重扫容器重建洞池（对齐世界真值） ─────────────

test("rebuildPools：每桶槽数调小后重扫，清除超限遗留洞；可用空槽正确入池", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  // 27 槽全量填满桶 0（slotId 0..26），释放可用槽 0 与超限槽 26 → 洞池 [0, 26]
  for (let n = 0; n < 27; n++) putItem(world.port, `i${n}`, RID, DIM, L27);
  const b0 = world.barrels.get("0,120,0");
  assert.ok(b0);
  b0[0] = false;
  b0[26] = false;
  releaseSlot(world.port, 0, DIM, L27);
  releaseSlot(world.port, 26, DIM, L27);
  assert.equal(world.record()?.meta.holeCount, 2);

  const NEW_L = { ...L27, slotPerBarrel: 2 };
  rebuildPools(
    {
      readRecord: world.port.readRecord,
      writeRecord: world.port.writeRecord,
      readLevelPool: world.port.readLevelPool,
      writeLevelPool: world.port.writeLevelPool,
      probeSlot: (slotId) => {
        const p = slotIdToPosition(slotId, NEW_L);
        return p ? (world.barrels.get(`${p.x},${p.y},${p.z}`)?.[p.slotInBarrel] ?? false) : false;
      },
    },
    NEW_L
  );
  // 超限洞 local 26 被清除（新布局下不可再分配）；可用空槽 0 保留为洞
  assert.equal(world.record()?.meta.holeCount, 1);
  assert.deepEqual(world.record()?.meta.holeLevels, [0]);
  assert.deepEqual(world.pools.get(0), [0]);
  assert.equal(world.record()?.meta.nextFree, 27); // 水印不动
});

// ── assertLayoutConsistent：test 特权标记 ───────────────────────────

test("assertLayoutConsistent：测试区域仅测试渠道可用（正式 register 拒绝进入）", () => {
  const TEST_LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64, slotPerBarrel: 27, test: true };
  // 正式 register（不传 test）注册测试区域 → 拒绝
  assert.throws(() => assertLayoutConsistent(TEST_LAYOUT, { dimensionId: DIM }, 0, 0), /测试区域/);
  // 测试渠道（传 test:true）→ 允许
  assert.doesNotThrow(() => assertLayoutConsistent(TEST_LAYOUT, { dimensionId: DIM, test: true }, 0, 0));
  // 测试渠道注册无标记区域 → 允许（共享正式区）
  assert.doesNotThrow(() => assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM, test: true }, 0, 0));
});

// ── record：布局覆盖参数随记录持久化 ───────────────────────────────

test("serializeRegionRecord：带 slotPerBarrel 的布局往返一致（记录自含解码约束）", () => {
  const rec = createRegionRecord(DIM, MICRO);
  const parsed = parseRegionRecord(serializeRegionRecord(rec));
  assert.ok(parsed);
  assert.deepEqual(parsed.layout, rec.layout);
  assert.equal(parsed.layout.slotPerBarrel, 1);
  assert.equal(parsed.layout.maxLevels, 1);
});

// ── 审查修复回归：超限洞过滤 / 脏索引循环 / 0 槽瞬满 ────────────────

test("审查回归：布局收缩后 take 超限旧槽 → 不入池、不再分配（0 槽瞬满不被绕过）", () => {
  const meta = { v: 2 as const, nextFree: 30, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools = createLevelPools(4);
  // 27 槽时代占用过桶 0 槽 2（超限：新布局每桶 2 槽）
  releaseSlotId(meta, pools, 2, 2); // usable=2：local 2 ≥ 2 → 不入池
  assert.equal(meta.holeCount, 0);
  assert.deepEqual(meta.holeLevels, []);
  // 0 槽布局：allocate 直接 null（不空转水印、不被洞绕过）
  const meta0 = { v: 2 as const, nextFree: 0, holeLevels: [], holeCount: 0, barrelCount: 0 };
  const pools0 = createLevelPools(4);
  assert.equal(allocateSlotId(meta0, pools0, 6912, 0), null);
  assert.equal(meta0.nextFree, 0); // 未空转
});

test("审查回归：最低洞层池为空（脏索引）→ 循环丢弃并分配高层洞（不误报真满）", () => {
  const meta = { v: 2 as const, nextFree: 100, holeLevels: [0, 1], holeCount: 1, barrelCount: 0 };
  const pools = createLevelPools(4);
  pools.byLevel[1] = [3]; // 层 0 池丢失（脏索引），层 1 有洞 local=3
  const slotId = allocateSlotId(meta, pools, 6912);
  assert.equal(slotId, 1 * 6912 + 3); // 分配到层 1 的洞
  assert.deepEqual(meta.holeLevels, []); // 脏索引 0 与空层 1 都已清
  assert.equal(meta.holeCount, 0);
});
