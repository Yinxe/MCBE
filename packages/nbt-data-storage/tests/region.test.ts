import test from "node:test";
import assert from "node:assert/strict";
import { regionId } from "../src/core/keys";
import { DEFAULT_BASE_Y, resolveRegistration } from "../src/core/region";
import { createRegionRecord } from "../src/core/record";

test("register 决策：已有记录 → 采纳首个注册者布局（后注册者传不同 baseY 被忽略）", () => {
  const persisted = createRegionRecord("minecraft:the_end", {
    chunkX: 0,
    chunkZ: -64,
    baseY: 120,
    maxLevels: 64,
  });
  const r = resolveRegistration(persisted, { dimensionId: "minecraft:the_end", baseY: 100 }, { cx: 0, cz: -64 });
  assert.equal(r.layout.baseY, 120); // 采纳首个，而非传入的 100
  assert.equal(r.layout.maxLevels, 64);
  assert.equal(r.dimensionId, "minecraft:the_end");
  assert.equal(r.layout.chunkX, 0);
});

test("register 决策：无记录 → 用传入 baseY；未传 → 默认 120 + 固定 64 层", () => {
  const r1 = resolveRegistration(undefined, { dimensionId: "minecraft:the_end", baseY: 100 }, { cx: 0, cz: -64 });
  assert.equal(r1.layout.baseY, 100);
  assert.equal(r1.layout.maxLevels, 64);

  const r2 = resolveRegistration(undefined, { dimensionId: "minecraft:the_end" }, { cx: 3, cz: 5 });
  assert.equal(r2.layout.baseY, DEFAULT_BASE_Y);
  assert.equal(r2.layout.chunkX, 3);
  assert.equal(r2.layout.chunkZ, 5);
  assert.equal(r2.layout.maxLevels, 64);
});

test("区域 ID 由维度枚举+区块决定，与高度无关（同区块不同 baseY 共享同一区域）", () => {
  // baseY 不是 regionId 的输入：无论哪个高度，同维度同区块都归到同一区域 ID
  assert.equal(regionId("the_end", 0, -64), "2:0:-64");
});

test("采纳路径：测试区域记录 + 测试标记 → 正常采纳（getRegion 还原句柄不误拒）", () => {
  // 回归：demo 的 applyConfig 用 getRegion 探测**自己刚注册的测试区域**，
  // 采纳路径必须带 test:true（还原句柄 ≠ 注册），否则一致抛"正式渠道注册被拒绝"
  const persisted = createRegionRecord("minecraft:the_end", {
    chunkX: 1,
    chunkZ: 1,
    baseY: 120,
    maxLevels: 8,
    slotPerBarrel: 5,
    test: true,
  });
  const r = resolveRegistration(
    persisted,
    { dimensionId: "minecraft:the_end", test: true },
    { cx: 1, cz: 1 }
  );
  assert.equal(r.layout.maxLevels, 8); // 采纳记录布局（含测试参数）
  assert.equal(r.layout.slotPerBarrel, 5);
  assert.equal(r.layout.test, true);

  // 防线仍在注册路径：正式渠道（无测试标记）进测试阵列 → 拒绝
  assert.throws(
    () => resolveRegistration(persisted, { dimensionId: "minecraft:the_end" }, { cx: 1, cz: 1 }),
    /正式渠道注册被拒绝/
  );
});
