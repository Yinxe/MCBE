// ── 测试注册渠道（布局覆盖）单测 ─────────────────────────────────────
// 覆盖 registerTest 的能力面：
//   - 解码恒 27 槽/桶（ID 语义恒定，slotPerBarrel 只约束分配上限）
//   - 微型布局（1 槽/桶 × 1 层 = 256 格）快速满容量 + 每次 put 物化新桶（扩容可见）
//   - 布局参数一致性拒绝（同区块不允许两套分配语义混用）
//   - record 序列化带上 slotPerBarrel
import test from "node:test";
import assert from "node:assert/strict";
import { capacityOf, slotIdToPosition, usableSlotsPerBarrel, validateLayout } from "../src/core/layout";
import { putItem, type PutPort } from "../src/core/put";
import { assertLayoutConsistent, rebuildUsage, resizeLayout, resolveRegistration } from "../src/core/region";
import { createRegionRecord, parseRegionRecord, serializeRegionRecord, type PersistedRegion } from "../src/core/record";

const DIM = "minecraft:the_end";
const RID = "2:0:0";

/** 微型布局：每桶 1 槽 × 1 层（容量 256 格，256 个桶） */
const MICRO = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1 };

/**
 * 内存世界替身：DP 记录（读改写）+ 木桶阵列（世界真值）+ 按层桶水位。
 * 物品用字符串代指（不透明引用）。
 */
function makeWorld(_maxLevels = 1) {
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

// ── put：微型桶世界（快速满容量 + 扩容见证）─────────────────────────

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
  // 第 257 次：256 桶水位全部满 → 拒绝
  assert.equal(putItem(port, "overflow", RID, DIM, MICRO), null);
  assert.equal(record()?.meta.barrelCount, 256); // 绝不建第 257 桶
});

test("putItem（1 槽/桶）：take 回滚计数后空槽复用同一槽", () => {
  const { port, barrels, usage } = makeWorld();
  const ref = putItem(port, "a", RID, DIM, MICRO);
  assert.equal(ref?.slotId, 0);
  // 模拟 take：清世界槽位（真值）+ 回滚桶水位
  barrels.get("0,120,0")![0] = false;
  // take 路径 = putItem 的 decrementUsage（这里直接操作水位验证）
  const u = usage.get(0) ?? [];
  u[0] -= 1;
  usage.set(0, u);
  assert.deepEqual(usage.get(0), [0]);
  const ref2 = putItem(port, "b", RID, DIM, MICRO);
  assert.equal(ref2?.slotId, 0); // 桶 0 未满 → 探测复用同一槽
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

test("assertLayoutConsistent：测试区域仅测试渠道可用（正式 register 拒绝进入）", () => {
  const TEST_LAYOUT = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 64, slotPerBarrel: 27, test: true };
  // 正式 register（不传 test）注册测试区域 → 拒绝
  assert.throws(() => assertLayoutConsistent(TEST_LAYOUT, { dimensionId: DIM }, 0, 0), /测试区域/);
  // 测试渠道（传 test:true）→ 允许
  assert.doesNotThrow(() => assertLayoutConsistent(TEST_LAYOUT, { dimensionId: DIM, test: true }, 0, 0));
  // 测试渠道注册无标记区域 → 允许（共享正式区）
  assert.doesNotThrow(() => assertLayoutConsistent(LAYOUT_27, { dimensionId: DIM, test: true }, 0, 0));
});

// ── resizeLayout：测试区域布局动态调整（层 + 每桶槽数） ───────────────

test("resizeLayout：增大层数 → 记录更新，后续分配进入新层", () => {
  const world = makeWorld();
  const L1 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 1, slotPerBarrel: 1, test: true };
  for (let n = 0; n < 256; n++) putItem(world.port, `i${n}`, RID, DIM, L1);
  assert.equal(putItem(world.port, "overflow", RID, DIM, world.record()!.layout), null); // 1 层已满

  assert.equal(resizeLayout(world.port, world.record()!.layout, { maxLevels: 2 }), null);
  assert.equal(world.record()?.layout.maxLevels, 2);
  assert.equal(world.record()?.layout.slotPerBarrel, 1);

  // 扩容后层 1 可用：第 257 件进入层 1（y=121，桶 0 槽 0，slotId=6912）
  const ref = putItem(world.port, "new", RID, DIM, world.record()!.layout);
  assert.equal(ref?.slotId, 6912);
});

test("resizeLayout：减小层数 → 高层仍有物化桶时拒绝（防孤儿），无桶层成功", () => {
  // 层 0 有物品 → 缩到 1 层成功（层 1..3 无物化桶）
  const world = makeWorld(4);
  const L4 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  for (let n = 0; n < 100; n++) putItem(world.port, `i${n}`, RID, DIM, L4);
  assert.equal(resizeLayout(world.port, world.record()!.layout, { maxLevels: 1 }), null);
  assert.equal(world.record()?.layout.maxLevels, 1);

  // 高层有物化桶（层 1 有桶）→ 缩到 1 层拒绝，记录原样
  const w2 = makeWorld(2);
  const L2 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 2, test: true };
  for (let n = 0; n < 7000; n++) putItem(w2.port, `i${n}`, RID, DIM, L2); // 层 1 已物化
  const err = resizeLayout(w2.port, w2.record()!.layout, { maxLevels: 1 });
  assert.ok(err?.includes("无法缩减层数"));
  assert.equal(w2.record()?.layout.maxLevels, 2); // 原样保留
});

test("resizeLayout：调整每桶槽数 → 缩小后新 put 只分配可用槽，旧超限槽物品仍可读可 take", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  // 用 27 槽全量存 7 件（桶 0 槽 0..6）
  for (let n = 0; n < 7; n++) putItem(world.port, `i${n}`, RID, DIM, L27);
  assert.deepEqual(world.usage.get(0), [7]);

  // 缩到每桶 2 槽
  assert.equal(resizeLayout(world.port, world.record()!.layout, { slotPerBarrel: 2 }), null);
  assert.equal(world.record()?.layout.slotPerBarrel, 2);

  // 新 put 只落在桶内槽 0/1：桶 0 计数 7（≥2 视为满）→ 物化桶 1 → slotId 27（桶 1 槽 0）
  const ref = putItem(world.port, "new", RID, DIM, world.record()!.layout);
  assert.equal(ref?.slotId, 27); // 桶 1 槽 0（桶 0 超出新上限不再分配）
  // 旧超限槽（slotId 2 → 桶 0 槽 2）的物品仍可读
  const pos = slotIdToPosition(2, world.record()!.layout);
  assert.ok(pos);
  assert.equal(world.barrels.get(`${pos.x},${pos.y},${pos.z}`)?.[pos.slotInBarrel], true);
});

test("resizeLayout：每桶槽数 0 → 容量 0，put 全拒（瞬见已满），旧物品仍可取", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  putItem(world.port, "keep", RID, DIM, L27);

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

  // 世界上限按维度（makeWorld 的 DIM=末地）：baseY 280 + 64 层 → 顶部 343 > 末地上限 256
  const wHigh = makeWorld(1);
  const LHigh = { chunkX: 0, chunkZ: 0, baseY: 280, maxLevels: 1, test: true };
  putItem(wHigh.port, "a", RID, DIM, LHigh);
  assert.ok(resizeLayout(wHigh.port, wHigh.record()!.layout, { maxLevels: 64 })?.includes("世界高度上限"));
});

// ── rebuildUsage：调整后重扫容器重建桶水位（对齐世界真值） ─────────────

test("rebuildUsage：重扫容器后桶水位与实际占用对齐（含超限槽不计入、外部分岐修正）", () => {
  const world = makeWorld(4);
  const L27 = { chunkX: 0, chunkZ: 0, baseY: 120, maxLevels: 4, test: true };
  // 27 槽全量填满桶 0（slotId 0..26），再模拟外部取走 1 件（槽 5 空，计数仍 27）
  for (let n = 0; n < 27; n++) putItem(world.port, `i${n}`, RID, DIM, L27);
  world.barrels.get("0,120,0")![5] = false;
  assert.deepEqual(world.usage.get(0), [27]);

  const NEW_L = { ...L27, slotPerBarrel: 2 };
  rebuildUsage(
    {
      readRecord: world.port.readRecord,
      writeRecord: world.port.writeRecord,
      readLevelUsage: world.port.readLevelUsage,
      writeLevelUsage: world.port.writeLevelUsage,
      probeSlot: (slotId) => {
        const p = slotIdToPosition(slotId, NEW_L);
        return p ? (world.barrels.get(`${p.x},${p.y},${p.z}`)?.[p.slotInBarrel] ?? false) : false;
      },
    },
    NEW_L
  );
  // 新布局每桶 2 槽：桶 0 槽 0/1 占用 → 计数 2（外部取走的槽 5 与超限槽不计入）
  assert.deepEqual(world.usage.get(0), [2]);
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