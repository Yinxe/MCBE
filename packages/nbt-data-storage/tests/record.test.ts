import test from "node:test";
import assert from "node:assert/strict";
import { createRegionRecord, parseRegionRecord, serializeRegionRecord } from "../src/core/record";
import { regionStats } from "../src/core/stats";

test("serializeRegionRecord / parseRegionRecord：往返保留 layout + meta（v3 桶水位）", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 4 });
  rec.meta.barrelCount = 3;
  const parsed = parseRegionRecord(serializeRegionRecord(rec));
  assert.ok(parsed);
  assert.equal(parsed.dimensionId, "minecraft:the_end");
  assert.deepEqual(parsed.layout, rec.layout);
  assert.deepEqual(parsed.meta, { v: 3, barrelCount: 3 });
});

test("parseRegionRecord：v2 旧记录（洞池时代）兼容读取 → meta 迁移 v3，洞信息丢弃", () => {
  const legacy = `{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":-64,"baseY":120,"maxLevels":4},"meta":{"v":2,"nextFree":100,"holeLevels":[0,2],"holeCount":34,"barrelCount":7}}`;
  const parsed = parseRegionRecord(legacy);
  assert.ok(parsed);
  assert.equal(parsed.meta.barrelCount, 7); // 洞信息丢弃，桶数保留
  assert.equal(parsed.layout.maxLevels, 4);
});

test("parseRegionRecord：垃圾/版本不符返回 undefined", () => {
  assert.equal(parseRegionRecord("not-json"), undefined);
  assert.equal(parseRegionRecord("{}"), undefined);
  assert.equal(parseRegionRecord('{"v":1}'), undefined); // 旧版本（freePool 时代）
  assert.equal(parseRegionRecord('{"v":3}'), undefined); // 记录版本不符
  assert.equal(parseRegionRecord('{"v":2}'), undefined); // 缺 layout/meta
});

test("parseRegionRecord：字段损坏的记录返回 undefined（防巡检/重建按坏数据空转卡死）", () => {
  const base = (metaPatch: string) =>
    `{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":4},"meta":${metaPatch}}`;
  assert.equal(parseRegionRecord(base('{"v":3,"barrelCount":-1}')), undefined); // barrelCount 负数
  assert.equal(parseRegionRecord(base('{"v":3,"barrelCount":1.5}')), undefined); // 非整数
  assert.equal(parseRegionRecord(base('{"v":9,"barrelCount":0}')), undefined); // meta 未知版本
  assert.equal(
    parseRegionRecord(
      '{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":65},"meta":{"v":3,"barrelCount":0}}'
    ),
    undefined
  ); // maxLevels 超 64
  assert.equal(
    parseRegionRecord(
      '{"v":2,"dimensionId":"minecraft:the_end","layout":{"chunkX":0,"chunkZ":0,"baseY":120,"maxLevels":4,"slotPerBarrel":28},"meta":{"v":3,"barrelCount":0}}'
    ),
    undefined
  ); // slotPerBarrel 超 27
});

test("regionStats：统计快照计算正确（used 来自桶水位遍历）", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 2 });
  rec.meta.barrelCount = 3; // 已物化 3 桶
  // 层 0：桶 0 占 5、桶 1 占 2；层 1：桶 0 占 0（空桶）
  const usageOf = (level: number) =>
    level === 0 ? [5, 2] : level === 1 ? [0] : [];
  const stats = regionStats("2:0:-64", rec.dimensionId, rec.layout, rec.meta, usageOf);
  assert.equal(stats.capacity, 2 * 256 * 27);
  assert.equal(stats.totalBarrels, 2 * 256);
  assert.equal(stats.barrels, 3);
  assert.equal(stats.used, 7);
  assert.equal(stats.freeSlots, 2 * 256 * 27 - 7);
  assert.equal(stats.baseY, 120);
  assert.equal(stats.maxLevels, 2);
  assert.equal(stats.slotPerBarrel, 27);
});

test("regionStats：测试布局每桶 2 槽 → 容量按可用槽计，used 按水位 clamp", () => {
  const rec = createRegionRecord("minecraft:the_end", {
    chunkX: 0,
    chunkZ: 0,
    baseY: 120,
    maxLevels: 1,
    slotPerBarrel: 2,
  });
  rec.meta.barrelCount = 1;
  const stats = regionStats("2:0:0", rec.dimensionId, rec.layout, rec.meta, (level) => (level === 0 ? [2] : []));
  assert.equal(stats.capacity, 1 * 256 * 2); // 512
  assert.equal(stats.used, 2);
  assert.equal(stats.freeSlots, 510);
});