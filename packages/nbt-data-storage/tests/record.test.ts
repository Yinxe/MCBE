import test from "node:test";
import assert from "node:assert/strict";
import { parseRegionKey, regionKey, shortDimension } from "../src/core/keys";
import { allocateSlotId, createRegionMeta, releaseSlotId } from "../src/core/meta";
import { createRegionRecord, parseRegionRecord, serializeRegionRecord } from "../src/core/record";
import { regionStats } from "../src/core/stats";

test("shortDimension：剥掉 minecraft: 前缀", () => {
  assert.equal(shortDimension("minecraft:the_end"), "the_end");
  assert.equal(shortDimension("minecraft:overworld"), "overworld");
  assert.equal(shortDimension("custom:dim"), "custom:dim"); // 非原版前缀不动
});

test("regionKey / parseRegionKey：往返一致，非法键返回 null", () => {
  const key = regionKey("the_end", 0, -64);
  assert.equal(key, "the_end:0:-64");
  assert.deepEqual(parseRegionKey(key), { shortDim: "the_end", chunkX: 0, chunkZ: -64 });
  assert.equal(parseRegionKey("bad"), null);
  assert.equal(parseRegionKey("the_end:0"), null);
});

test("serializeRegionRecord / parseRegionRecord：往返保留 layout + meta", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 4 });
  allocateSlotId(rec.meta, 100);
  allocateSlotId(rec.meta, 100);
  releaseSlotId(rec.meta, 0);
  const parsed = parseRegionRecord(serializeRegionRecord(rec));
  assert.ok(parsed);
  assert.equal(parsed.dimensionId, "minecraft:the_end");
  assert.deepEqual(parsed.layout, rec.layout);
  assert.equal(parsed.meta.nextFree, 2);
  assert.deepEqual(parsed.meta.freePool, [0]);
});

test("parseRegionRecord：垃圾/版本不符返回 undefined", () => {
  assert.equal(parseRegionRecord("not-json"), undefined);
  assert.equal(parseRegionRecord("{}"), undefined);
  assert.equal(parseRegionRecord('{"v":2}'), undefined);
  assert.equal(parseRegionRecord('{"v":1}'), undefined); // 缺 layout/meta
});

test("regionStats：统计快照计算正确", () => {
  const rec = createRegionRecord("minecraft:the_end", { chunkX: 0, chunkZ: -64, baseY: 120, maxLevels: 2 });
  for (let i = 0; i < 5; i++) allocateSlotId(rec.meta, 1000);
  releaseSlotId(rec.meta, 1);
  const stats = regionStats("the_end:0:-64", rec.dimensionId, rec.layout, rec.meta);
  assert.equal(stats.capacity, 2 * 256 * 27);
  assert.equal(stats.used, 4);
  assert.equal(stats.nextFree, 5);
  assert.equal(stats.freePoolSize, 1);
  assert.equal(stats.baseY, 120);
  assert.equal(stats.maxLevels, 2);
});
