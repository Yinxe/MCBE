import test from "node:test";
import assert from "node:assert/strict";
import { allocateSlotId, createLevelPools, releaseSlotId } from "../src/core/meta";
import { createRegionRecord, parseRegionRecord, serializeRegionRecord } from "../src/core/record";
import { regionStats } from "../src/core/stats";

test("serializeRegionRecord / parseRegionRecord：往返保留 layout + meta（空洞按层）", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 4 });
  const pools = createLevelPools(rec.layout.maxLevels);
  allocateSlotId(rec.meta, pools, 100);
  allocateSlotId(rec.meta, pools, 100);
  releaseSlotId(rec.meta, pools, 0);
  const parsed = parseRegionRecord(serializeRegionRecord(rec));
  assert.ok(parsed);
  assert.equal(parsed.dimensionId, "minecraft:the_end");
  assert.deepEqual(parsed.layout, rec.layout);
  assert.equal(parsed.meta.nextFree, 2);
  assert.deepEqual(parsed.meta.holeLevels, [0]);
  assert.equal(parsed.meta.holeCount, 1);
  assert.equal(parsed.meta.barrelCount, 0);
});

test("parseRegionRecord：垃圾/版本不符返回 undefined", () => {
  assert.equal(parseRegionRecord("not-json"), undefined);
  assert.equal(parseRegionRecord("{}"), undefined);
  assert.equal(parseRegionRecord('{"v":1}'), undefined); // 旧版本（freePool 时代）
  assert.equal(parseRegionRecord('{"v":3}'), undefined); // 未来版本
  assert.equal(parseRegionRecord('{"v":2}'), undefined); // 缺 layout/meta
});

test("parseRegionRecord：字段损坏的记录返回 undefined（防巡检/重建按坏水印空转卡死）", () => {
  const base = (patch: string) =>
    `{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":4},"meta":{"v":2,"nextFree":0,"holeLevels":[],"holeCount":0,"barrelCount":0}${patch}}`;
  assert.equal(
    parseRegionRecord(base(',"meta":{"v":2,"nextFree":1e15,"holeLevels":[],"holeCount":0,"barrelCount":0}')),
    undefined
  ); // nextFree 巨大
  assert.equal(
    parseRegionRecord(base(',"meta":{"v":2,"nextFree":-5,"holeLevels":[],"holeCount":0,"barrelCount":0}')),
    undefined
  ); // nextFree 负数
  assert.equal(
    parseRegionRecord(base(',"meta":{"v":2,"nextFree":0,"holeLevels":[9],"holeCount":0,"barrelCount":0}')),
    undefined
  ); // holeLevels 越界层号（超 maxLevels）
  assert.equal(
    parseRegionRecord(base(',"meta":{"v":2,"nextFree":0,"holeLevels":[],"holeCount":-1,"barrelCount":0}')),
    undefined
  ); // holeCount 负数
  assert.equal(
    parseRegionRecord(
      '{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":65},"meta":{"v":2,"nextFree":0,"holeLevels":[],"holeCount":0,"barrelCount":0}}'
    ),
    undefined
  ); // maxLevels 超 64
  assert.equal(
    parseRegionRecord(
      '{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":4,"slotPerBarrel":28},"meta":{"v":2,"nextFree":0,"holeLevels":[],"holeCount":0,"barrelCount":0}}'
    ),
    undefined
  ); // slotPerBarrel 超 27
});

test("regionStats：统计快照计算正确", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 2 });
  const pools = createLevelPools(rec.layout.maxLevels);
  for (let i = 0; i < 5; i++) allocateSlotId(rec.meta, pools, 1000);
  releaseSlotId(rec.meta, pools, 1);
  const stats = regionStats("2:0:-64", rec.dimensionId, rec.layout, rec.meta);
  assert.equal(stats.capacity, 2 * 256 * 27);
  assert.equal(stats.totalBarrels, 2 * 256);
  assert.equal(stats.barrels, 0);
  assert.equal(stats.used, 4);
  assert.equal(stats.nextFree, 5);
  assert.equal(stats.freePoolSize, 1);
  assert.equal(stats.baseY, 120);
  assert.equal(stats.maxLevels, 2);
});
