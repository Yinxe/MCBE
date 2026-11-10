import test from "node:test";
import assert from "node:assert/strict";
import { dimensionFromToken, dimensionToken, parseRegionId, regionId, shortDimension } from "../src/core/keys";

test("shortDimension：剥掉 minecraft: 前缀", () => {
  assert.equal(shortDimension("minecraft:the_end"), "the_end");
  assert.equal(shortDimension("minecraft:overworld"), "overworld");
  assert.equal(shortDimension("minecraft:overworld_caves"), "overworld_caves");
  assert.equal(shortDimension("custom:dim"), "custom:dim"); // 非原版前缀不动
});

test("dimensionToken / dimensionFromToken：三大主维度用枚举 0/1/2，可逆", () => {
  assert.equal(dimensionToken("overworld"), "0");
  assert.equal(dimensionToken("nether"), "1");
  assert.equal(dimensionToken("the_end"), "2");
  assert.equal(dimensionFromToken("0"), "overworld");
  assert.equal(dimensionFromToken("1"), "nether");
  assert.equal(dimensionFromToken("2"), "the_end");
  // 其余维度回退短名，同样可逆
  assert.equal(dimensionToken("overworld_caves"), "overworld_caves");
  assert.equal(dimensionFromToken("overworld_caves"), "overworld_caves");
});

test("regionId：主维度用枚举，同区块同一 ID，跨区块不同", () => {
  assert.equal(regionId("the_end", 0, -64), "2:0:-64");
  assert.equal(regionId("overworld", 3, 5), "0:3:5");
  assert.equal(regionId("nether", -1, -64), "1:-1:-64");
});

test("parseRegionId：往返一致，非法 ID 返回 null", () => {
  assert.deepEqual(parseRegionId("2:0:-64"), { shortDim: "the_end", chunkX: 0, chunkZ: -64 });
  assert.deepEqual(parseRegionId("0:3:5"), { shortDim: "overworld", chunkX: 3, chunkZ: 5 });
  assert.deepEqual(parseRegionId("1:-1:-64"), { shortDim: "nether", chunkX: -1, chunkZ: -64 });
  assert.equal(parseRegionId("bad"), null);
  assert.equal(parseRegionId("2:0"), null);
  assert.equal(parseRegionId(""), null);
});
