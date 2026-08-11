import test from "node:test";
import assert from "node:assert/strict";
import { SLOTS_PER_LEVEL } from "../src/core/layout";
import { allocateSlotId, createLevelPools, createRegionMeta, releaseSlotId } from "../src/core/meta";

test("跨层：空洞按层存放，level-local 索引与全局 slotId 互转", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  const capacity = 4 * SLOTS_PER_LEVEL;
  // 推进水印到第 1 层中部，模拟已分配大量槽位
  meta.nextFree = SLOTS_PER_LEVEL + 10;

  // 释放第 1 层的 6913（= 6912 + 1）→ 存进 level 1 的 local 1
  releaseSlotId(meta, pools, SLOTS_PER_LEVEL + 1);
  assert.deepEqual(meta.holeLevels, [1]);
  assert.deepEqual(pools.byLevel[1], [1]);

  // 释放第 0 层的 1 → level 0 的 local 1
  releaseSlotId(meta, pools, 1);
  assert.deepEqual(meta.holeLevels, [0, 1]); // 升序
  assert.deepEqual(pools.byLevel[0], [1]);
  assert.equal(meta.holeCount, 2);

  // 优先复用最低层（0 层）洞 → 全局 slotId 1
  assert.equal(allocateSlotId(meta, pools, capacity), 1);
  // 再复用 1 层洞 → 全局 slotId 6913
  assert.equal(allocateSlotId(meta, pools, capacity), SLOTS_PER_LEVEL + 1);
  assert.deepEqual(meta.holeLevels, []);
  assert.equal(meta.holeCount, 0);
  // 无洞后回水印（nextFree 保持 6922）
  assert.equal(allocateSlotId(meta, pools, capacity), SLOTS_PER_LEVEL + 10);
});

test("顺序分配：水印逐槽推进，跨过一层边界自然进入下一层", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(4);
  for (let i = 0; i < SLOTS_PER_LEVEL + 2; i++) {
    assert.equal(allocateSlotId(meta, pools, 4 * SLOTS_PER_LEVEL), i);
  }
  assert.equal(meta.nextFree, SLOTS_PER_LEVEL + 2);
});

test("64 层：空洞只存 level-local，单层池大小不随层数膨胀", () => {
  const meta = createRegionMeta();
  const pools = createLevelPools(64);
  const highSlot = 63 * SLOTS_PER_LEVEL + 5; // 第 63 层 local 5
  meta.nextFree = highSlot + 1; // 模拟水印已推进到 63 层

  releaseSlotId(meta, pools, highSlot);
  assert.deepEqual(meta.holeLevels, [63]);
  assert.deepEqual(pools.byLevel[63], [5]); // level-local，而非 435461
  assert.equal(meta.holeCount, 1);

  // 复用回来：全局 slotId 还原为 highSlot
  assert.equal(allocateSlotId(meta, pools, 64 * SLOTS_PER_LEVEL), highSlot);
  assert.deepEqual(meta.holeLevels, []);
  assert.equal(meta.holeCount, 0);
});
