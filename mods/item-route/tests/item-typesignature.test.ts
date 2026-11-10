import { test } from "node:test";
import assert from "node:assert/strict";
import { itemTypeSignature } from "../scripts/core/model/ItemTypeSignature";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

test("itemTypeSignature: 空箱 → 空字符串", () => {
  const c = new InMemoryContainer("c1", "multi", 3);
  assert.equal(itemTypeSignature(c), "");
});

test("itemTypeSignature: 去重 + 排序（两箱内容相同顺序不同 → 签名相等）", () => {
  const a = new InMemoryContainer("a", "multi", 3);
  a.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  a.setItem(1, new SimpleItemStack("minecraft:dirt", 5, 64));
  a.setItem(2, new SimpleItemStack("minecraft:stone", 2, 64)); // 同类型多槽 → 去重
  const b = new InMemoryContainer("b", "multi", 3);
  b.setItem(0, new SimpleItemStack("minecraft:dirt", 7, 64));
  b.setItem(1, new SimpleItemStack("minecraft:stone", 3, 64));
  // 内容集合相同（stone|dirt）、摆放顺序不同 → 签名必须相等（开箱/关箱不误判变更）
  assert.equal(itemTypeSignature(a), "minecraft:dirt|minecraft:stone");
  assert.equal(itemTypeSignature(a), itemTypeSignature(b));
});

test("itemTypeSignature: 数量变化不影响签名（索引只关心类型存在性）", () => {
  const a = new InMemoryContainer("a", "multi", 3);
  a.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const b = new InMemoryContainer("b", "multi", 3);
  b.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64)); // 数量不同
  assert.equal(itemTypeSignature(a), itemTypeSignature(b));
});

test("itemTypeSignature: 类型增/减 → 签名变化", () => {
  const c = new InMemoryContainer("c", "multi", 3);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const before = itemTypeSignature(c);
  c.setItem(1, new SimpleItemStack("minecraft:gold_ingot", 3, 64)); // 新增类型
  assert.notEqual(itemTypeSignature(c), before);
  c.setItem(1, undefined); // 删掉该类型
  assert.equal(itemTypeSignature(c), before);
});
