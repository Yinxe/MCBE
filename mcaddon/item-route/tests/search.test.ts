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

// ── 索引注入兼容：ItemIndex.lookupSearch 实例方法绑定（P0 回归） ──
import { ItemIndex } from "../scripts/core/index/ItemIndex";
test("searchContainers: 注入 ItemIndex 实例 lookupSearch（含 misc）不炸且 O(1) 命中", () => {
  const containers = [
    box("m1", "multi", [["minecraft:diamond", 3]]),
    box("x1", "misc", [["minecraft:diamond", 7]]),
  ];
  const idx = new ItemIndex();
  for (const c of containers) idx.onContainerAdded(c);
  // 用"实例方法裸引用"的形式模拟 SearchUI 传法——searchContainers 内经 fallback 兜底 & 索引优先
  const lookup: (t: string) => string[] = (t) => idx.lookupSearch(t);
  const hits = searchContainers(containers, "diamond", lookup);
  const d = hits.find((h) => h.typeId === "minecraft:diamond");
  assert.ok(d !== undefined);
  assert.equal(d?.count, 10);
  assert.deepEqual(d?.containerIds.sort(), ["m1", "x1"]);
});

test("searchContainers: 索引 miss（lookup 无结果）→ 实时倒排兜底不漏报", () => {
  const real = new InMemoryContainer("m1", "multi", 4);
  real.setItem(0, new SimpleItemStack("minecraft:netherite_ingot", 4, 64));
  // 假 lookup：声称索引完全没索引到 netherite_ingot → fallback 实时扫描应兜住
  const stub: (t: string) => string[] = () => [];
  const hits = searchContainers([real], "netherite_ingot", stub);
  const n = hits.find((h) => h.typeId === "minecraft:netherite_ingot");
  assert.ok(n !== undefined, "索引 miss 时实时兜底应命中");
  assert.equal(n!.count, 4);
  assert.deepEqual(n!.containerIds, ["m1"]);
});

// ── 并集兜底：索引漏记某容器（stale）→ 实时倒排补齐，搜索不漏报 ──
test("searchContainers: 索引漏记容器（stale）→ 并集实时兜底仍命中", () => {
  const filled = new InMemoryContainer("m2", "multi", 4);
  filled.setItem(0, new SimpleItemStack("minecraft:diamond", 12, 64));
  // lookup 声称索引只记得 m1？——用一个只对 diamond 返回 ["m1"] 的 lookup 模拟"索引漏了 m2"
  const phantom = new InMemoryContainer("m1", "multi", 4) as never; // 只为给 lookup 提供 m1 id
  const idxDict: Record<string, string[]> = { "minecraft:diamond": ["m1"] };
  const stub: (t: string) => string[] = (t) => idxDict[t] ?? [];
  const hits = searchContainers([filled as never, phantom], "diamond", stub);
  const d = hits.find((h) => h.typeId === "minecraft:diamond");
  // 实时倒排（fallback）发现 m2 实际有 diamond → 并集后命中 m2；m1 真实读 0 被跳过
  assert.ok(d !== undefined);
  assert.equal(d!.count, 12);
  assert.deepEqual(d!.containerIds, ["m2"]);
});
