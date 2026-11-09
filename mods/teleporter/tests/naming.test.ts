// ─── 命名映射与格式化的单元测试 ─────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  biomeDisplayName,
  dimensionDisplayName,
  dimensionFullName,
  distanceBetween,
  formatCoordinates,
  formatLocation,
  formatTimeAgo,
  stripNamespace,
} from "../scripts/core/naming";

test("去掉命名空间", () => {
  assert.equal(stripNamespace("minecraft:plains"), "plains");
  assert.equal(stripNamespace("plains"), "plains");
  assert.equal(stripNamespace("custom:foo:bar"), "foo:bar");
});

test("已知群系映射为中文", () => {
  assert.equal(biomeDisplayName("minecraft:plains"), "平原");
  assert.equal(biomeDisplayName("minecraft:deep_dark"), "深暗之域");
  assert.equal(biomeDisplayName("minecraft:nether_wastes"), "下界荒地");
  assert.equal(biomeDisplayName("minecraft:end_highlands"), "末地高地");
});

test("未知群系回落为去掉命名空间的原标识", () => {
  assert.equal(biomeDisplayName("minecraft:custom_biome"), "custom_biome");
  assert.equal(biomeDisplayName("mymod:strange_land"), "strange_land");
});

test("三种原版维度都有短名与全名", () => {
  assert.equal(dimensionDisplayName("minecraft:overworld"), "主世界");
  assert.equal(dimensionDisplayName("minecraft:nether"), "下界");
  assert.equal(dimensionDisplayName("minecraft:the_end"), "末地");

  assert.equal(dimensionFullName("minecraft:nether"), "下界 (Nether)");
  assert.equal(dimensionFullName("minecraft:the_end"), "末地 (The End)");
});

test("自定义维度:短名去命名空间,全名保留原样", () => {
  assert.equal(dimensionDisplayName("mymod:moon"), "moon");
  assert.equal(dimensionFullName("mymod:moon"), "mymod:moon");
});

test("坐标取整后拼接", () => {
  assert.equal(formatCoordinates({ x: 1.9, y: -0.1, z: -30.7 }), "1 -1 -31");
});

test("位置展示包含维度名与坐标", () => {
  assert.equal(formatLocation({ x: 120, y: 64, z: -300 }, "minecraft:overworld"), "§6主世界 §f120 64 -300");
});

test("距离按格取整", () => {
  assert.equal(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }), 5);
  assert.equal(distanceBetween({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }), 2);
  assert.equal(distanceBetween({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }), 0);
});

test("相对时间的各档位", () => {
  const now = 1_000_000_000;
  assert.equal(formatTimeAgo(now - 30 * 1000, now), "刚刚");
  assert.equal(formatTimeAgo(now - 5 * 60 * 1000, now), "5分钟前");
  assert.equal(formatTimeAgo(now - 3 * 60 * 60 * 1000, now), "3小时前");
  assert.equal(formatTimeAgo(now - 2 * 24 * 60 * 60 * 1000, now), "2天前");
});
