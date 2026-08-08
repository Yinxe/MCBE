// 仓库内物品搜索：O(1) 索引命中、中文/typeId 模糊、全命中不截断、数量汇总。
// 覆盖：倒排命中、misc 参与、中文子串（"金" → 下界合金系列）、不截断、多容器、验证跳过空容器。
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchContainers, buildSearchLookup } from "../scripts/core/search/WarehouseSearch";
import type { ContainerRole } from "../scripts/core/model/Container";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function box(id: string, role: ContainerRole, items: [string, number][]): InMemoryContainer {
  const c = new InMemoryContainer(id, role, 8);
  items.forEach(([itemId, amount], i) => c.setItem(i, new SimpleItemStack(itemId, amount, 64)));
  return c;
}

test("searchContainers: 中文子串命中（'金' → 含下界合金系，不截断）", () => {
  const containers = [
    box("m1", "multi", [["minecraft:gold_ingot", 3]]),
    box("m2", "multi", [["minecraft:netherite_scrap", 2]]),
    box("m3", "multi", [["minecraft:netherite_ingot", 5]]),
    box("m4", "multi", [["minecraft:netherite_sword", 1]]),
  ];
  const hits = searchContainers(containers, "金");
  // "下界合金"含"金" → netherite_* 均应命中（不因字母序被金系截断）
  const byId = new Map(hits.map((h) => [h.typeId, h]));
  assert.ok(byId.has("minecraft:gold_ingot"), "金锭命中");
  assert.ok(byId.has("minecraft:netherite_scrap"), "下界合金碎片命中（修复截断）");
  assert.ok(byId.has("minecraft:netherite_ingot"), "下界合金锭命中");
  assert.ok(byId.has("minecraft:netherite_sword"), "下界合金剑命中");
  assert.equal(byId.get("minecraft:netherite_ingot")?.count, 5);
});

test("searchContainers: 本地倒排兜底（无注入 lookup）也含 misc 容器", () => {
  const containers = [
    box("s1", "single", [["minecraft:diamond", 2]]),
    box("mx", "misc", [["minecraft:diamond", 9]]), // misc 兜底层应可搜到
  ];
  const hits = searchContainers(containers, "diamond");
  const d = hits.find((h) => h.typeId === "minecraft:diamond");
  assert.ok(d !== undefined);
  assert.equal(d?.count, 11); // single 2 + misc 9
  assert.deepEqual(d?.containerIds.sort(), ["mx", "s1"]);
});

test("buildSearchLookup: 倒排索引 O(1)（typeId → 容器）且跳过 input 源", () => {
  const containers = [
    box("in", "input", [["minecraft:stone", 1]]), // input 不参与
    box("m1", "multi", [["minecraft:stone", 2]]),
    box("m2", "multi", [["minecraft:stone", 3]]),
  ];
  const lookup = buildSearchLookup(containers);
  assert.deepEqual(lookup("minecraft:stone").sort(), ["m1", "m2"]);
  assert.deepEqual(lookup("minecraft:dirt"), []);
});

test("searchContainers: 多容器数量汇总 + 验证（索引 miss 跳过空容器）", () => {
  const containers = [
    box("m1", "multi", [["minecraft:stone", 10]]),
    box("m2", "multi", [["minecraft:stone", 5]]),
  ];
  // 注入一个"撒谎"的 lookup（声称还有个空容器 m3）→ 真实读取 0 被跳过（验证）
  const hits = searchContainers(containers, "stone", () => ["m1", "m2", "m3"]);
  const s = hits.find((h) => h.typeId === "minecraft:stone");
  assert.equal(s?.count, 15);
  assert.deepEqual(s?.containerIds.sort(), ["m1", "m2"]); // m3 空 → 不列入
});

test("searchContainers: 无命中返回空", () => {
  const containers = [box("m1", "multi", [["minecraft:diamond", 1]])];
  assert.deepEqual(searchContainers(containers, "不存在的词xyz"), []);
});
