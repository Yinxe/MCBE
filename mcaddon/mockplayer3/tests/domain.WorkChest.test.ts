// ─── 工作箱 domain 测试：原点归一/注册形状守卫/搬运计划/各模式产物判据 ──
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chestOrigin,
  dropAcceptMatch,
  isPlainChestType,
  isWorkChestShape,
  MAX_CHEST_NAME_LENGTH,
  minedProductSet,
  normalizeChestName,
  planWorkTransfer,
  workChestId,
  workProductMatcher,
  type HarvestDropRule,
  type InventorySlotProbe,
} from "../scripts/domain/WorkChest";

// ─── 箱原点与 id ──

test("chestOrigin：两半逐轴取最小（大箱两半点击归同原点）", () => {
  assert.deepEqual(chestOrigin({ x: 10, y: 64, z: 20 }, { x: 11, y: 64, z: 20 }), { x: 10, y: 64, z: 20 });
  assert.deepEqual(chestOrigin({ x: 11, y: 64, z: 20 }, { x: 10, y: 64, z: 20 }), { x: 10, y: 64, z: 20 });
  assert.deepEqual(chestOrigin({ x: -5, y: 70, z: 3 }, { x: -5, y: 70, z: 2 }), { x: -5, y: 70, z: 2 });
  // 向下取整后再比：小数坐标与整数格同结果
  assert.deepEqual(chestOrigin({ x: 10.7, y: 64.2, z: 20.9 }, { x: 10, y: 64, z: 20 }), { x: 10, y: 64, z: 20 });
});

test("workChestId：维度+原点三分量单串；两半归一后同串", () => {
  assert.equal(workChestId("minecraft:overworld", { x: 10, y: 64, z: 20 }), "minecraft:overworld:10,64,20");
  const a = chestOrigin({ x: 11, y: 64, z: 20 }, { x: 10, y: 64, z: 20 });
  const b = chestOrigin({ x: 10, y: 64, z: 20 }, { x: 11, y: 64, z: 20 });
  assert.equal(workChestId("o", a), workChestId("o", b));
});

test("isPlainChestType：仅 minecraft:chest（陷阱箱/木桶不算）", () => {
  assert.equal(isPlainChestType("minecraft:chest"), true);
  assert.equal(isPlainChestType("minecraft:trapped_chest"), false);
  assert.equal(isPlainChestType("minecraft:barrel"), false);
});

// ─── 名称与注册表形状守卫 ──

test("normalizeChestName：trim+截上限；非字符串回空串", () => {
  assert.equal(normalizeChestName("  门口箱  "), "门口箱");
  assert.equal(normalizeChestName("x".repeat(MAX_CHEST_NAME_LENGTH + 10)), "x".repeat(MAX_CHEST_NAME_LENGTH));
  assert.equal(normalizeChestName(42), "");
  assert.equal(normalizeChestName(undefined), "");
});

const goodChest = { id: "o:10,64,20", dimId: "o", origin: { x: 10, y: 64, z: 20 }, name: "矿箱" };

test("isWorkChestShape：id 必须由 dimId+origin 生成，坏条目一律拒入", () => {
  assert.equal(isWorkChestShape(goodChest), true);
  assert.equal(isWorkChestShape({ ...goodChest, id: "o:11,64,20" }), false, "id 与原点不一致");
  assert.equal(isWorkChestShape({ ...goodChest, origin: { x: 10.5, y: 64, z: 20 } }), false, "原点须整数格");
  assert.equal(isWorkChestShape({ ...goodChest, name: 3 }), false);
  assert.equal(isWorkChestShape(null), false);
  assert.equal(isWorkChestShape("x"), false);
});

// ─── 搬运计划 ──

const probe = (slot: number, typeId: string, amount: number): InventorySlotProbe => ({ slot, typeId, amount });

test("planWorkTransfer：主手 0 格/非产物/保护件/空数量全部排除，余按格号升序", () => {
  const product = new Set(["minecraft:cod"]);
  const plan = planWorkTransfer(
    [
      probe(0, "minecraft:cod", 5), // 命中产物但在主手保护格
      probe(9, "minecraft:cod", 3),
      probe(3, "minecraft:bone", 2), // 非产物
      probe(7, "minecraft:cod", 0), // 数量非法
      probe(5, "minecraft:bow", 1), // 产物但在保护名单（工具）
    ],
    (id) => product.has(id),
    new Set(["minecraft:bow"])
  );
  assert.deepEqual(plan, [{ slot: 9, amount: 3 }]);
});

// ─── 各模式产物判据 ──

test("workProductMatcher fishing：白名单命中，名单外拒绝", () => {
  const m = workProductMatcher("fishing", [], null);
  assert.equal(m("minecraft:cod"), true);
  assert.equal(m("minecraft:leather_boots"), true);
  assert.equal(m("minecraft:diamond"), false);
});

test("minedProductSet：方块自身+原生掉落双收；表外方块只收自身", () => {
  const s = minedProductSet(["minecraft:iron_ore", "minecraft:oak_planks"]);
  assert.equal(s.has("minecraft:iron_ore"), true);
  assert.equal(s.has("minecraft:raw_iron"), true);
  assert.equal(s.has("minecraft:oak_planks"), true);
  assert.equal(s.has("minecraft:cobblestone"), false, "未挖过的掉落不入集");
});

test("workProductMatcher mine：以本会话挖过的方块台账为唯一依据", () => {
  const m = workProductMatcher("mine", ["minecraft:deepslate_gold_ore"], null);
  assert.equal(m("minecraft:raw_gold"), true);
  assert.equal(m("minecraft:deepslate_gold_ore"), true);
  assert.equal(m("minecraft:diamond"), false);
});

const woodRule: HarvestDropRule = {
  exact: ["minecraft:log", "minecraft:log2"],
  suffixes: ["_log", "_stem", "_sapling"],
  excludePrefixes: ["minecraft:stripped_"],
};

test("dropAcceptMatch：排除前缀先判，再 exact，后 suffixes", () => {
  assert.equal(dropAcceptMatch(woodRule, "minecraft:log"), true);
  assert.equal(dropAcceptMatch(woodRule, "minecraft:oak_log"), true);
  assert.equal(dropAcceptMatch(woodRule, "minecraft:stripped_oak_log"), false, "排除前缀压过 suffixes");
  assert.equal(dropAcceptMatch(woodRule, "minecraft:stick"), false);
});

test("workProductMatcher harvest：有规则按规则，无规则一律拒", () => {
  const withRule = workProductMatcher("harvest_wood", [], woodRule);
  assert.equal(withRule("minecraft:oak_log"), true);
  assert.equal(withRule("minecraft:cod"), false);
  assert.equal(workProductMatcher("harvest_wood", [], null)("minecraft:oak_log"), false);
});

test("workProductMatcher 表外模式（wander/attack/none 等）不产搬运", () => {
  for (const mode of ["wander", "attack", "raid", "follow", "place", "vault", "none"]) {
    assert.equal(workProductMatcher(mode, ["minecraft:iron_ore"], woodRule)("minecraft:raw_iron"), false, mode);
  }
});
