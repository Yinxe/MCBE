// ─── 死亡物品生命周期：刷物/丢物防护模拟测试 ───────────
//
// 用 InMemoryBotStore + BotRegistry 模拟"击杀→死亡→掉落→重连恢复"事件序列，
// 验证死亡物品策略（core/service/InventoryLifecycle）在以下组合下物品守恒：
//   - keepInventory（死亡掉落开启/关闭）× 引擎时序（entityDie 时实体背包是否已被清空）
//
// 守恒断言：掉落物 + 持久化 + 实体持有 ≤ 初始总量（无刷物）；
// keepInventory=on 时物品必须保留（无丢物）。
//
// ⚠️ 本测试模拟的是 mc 层 entityDie 的语义复刻（mc 层含 mcapi 不进 node 测试），
//    核心验证对象是纯函数 decideDeathInventoryPolicy 的策略正确性。

import { test } from "node:test";
import assert from "node:assert/strict";

import { decideDeathInventoryPolicy } from "../scripts/core/service/InventoryLifecycle";
import { InMemoryBotStore } from "../scripts/core/storage/BotStore";
import { BotRegistry } from "../scripts/core/service/BotRegistry";
import { makeItem, makeRecord } from "./helpers/factories";

const DIAMOND = "minecraft:diamond";
const INITIAL = 64;

// ─── 模拟世界 ──────────────────────────────────────────

interface SimWorld {
  /** 世界是否开启死亡不掉落 */
  keepInventory: boolean;
  /** entityDie 回调触发时，引擎是否已把实体背包清空（掉落先发生） */
  engineClearedOnDie: boolean;
  /** 玩家捡到的掉落物总量 */
  drops: number;
}

/** 背包数量视图（模拟实体背包：仅统计数量，slot 0 放物品） */
function invOf(amount: number): (ReturnType<typeof makeItem> | null)[] {
  const items = new Array(36).fill(null);
  if (amount > 0) items[0] = makeItem(DIAMOND, amount);
  return items;
}

function countOf(items: (ReturnType<typeof makeItem> | null)[] | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, it) => sum + (it?.typeId === DIAMOND ? it.amount : 0), 0);
}

/** 模拟 entityDie 回调（复刻修复后 mc 逻辑的语义） */
function simulateDie(world: SimWorld, store: InMemoryBotStore, record: ReturnType<typeof makeRecord>, entityInv: number): number {
  // 引擎掉落：若死亡掉落开启且回调时已清空 → 掉落已发生（物品离开实体）
  if (!world.keepInventory && world.engineClearedOnDie) {
    world.drops += entityInv;
    entityInv = 0;
  }

  // mc 决策：以游戏规则为准（不依赖实体背包状态，消除时序依赖）
  const policy = decideDeathInventoryPolicy(world.keepInventory);
  if (policy === "persist") {
    // 死亡不掉落：保存当前背包（物品继续属于假人）
    store.saveInventory(record.name, invOf(entityInv));
  } else {
    // 死亡掉落：清空持久化（掉落物是唯一副本）
    store.removeInventory(record.name);
  }

  // 引擎掉落（回调后）：死亡掉落开启且回调时未清空 → 引擎稍后掉落实体背包
  if (!world.keepInventory && !world.engineClearedOnDie) {
    world.drops += entityInv;
    entityInv = 0;
  }
  return entityInv;
}

/** 模拟重连（playerJoin）：从持久化恢复背包 → 返回实体持有的数量 */
function simulateRejoin(store: InMemoryBotStore, record: ReturnType<typeof makeRecord>): number {
  return countOf(store.loadInventory(record.name));
}

// ─── 用例：单次击杀 → 死亡 → 重连 ─────────────────────

for (const keepInventory of [false, true]) {
  for (const engineCleared of [false, true]) {
    test(`物品守恒：keepInventory=${keepInventory} 引擎时序(die时背包${engineCleared ? "已清空" : "未清空"})`, () => {
      const store = new InMemoryBotStore();
      const registry = new BotRegistry(store);
      const record = makeRecord("bot1");
      registry.save(record);
      // 初始：实体持有 64（持久化同步）
      store.saveInventory("bot1", invOf(INITIAL));

      const world: SimWorld = { keepInventory, engineClearedOnDie: engineCleared, drops: 0 };
      let entityInv = INITIAL;

      // 击杀 → 死亡
      entityInv = simulateDie(world, store, record, entityInv);
      // 重连恢复
      const restored = simulateRejoin(store, record);

      // 守恒：唯一副本 = 掉落物 + 恢复后实体持有（持久化是实体背包的镜像，不独立计数）
      const finalCopies = world.drops + restored;
      assert.ok(finalCopies <= INITIAL, `刷物：总副本 ${finalCopies} > 初始 ${INITIAL}`);

      if (keepInventory) {
        // 死亡不掉落：物品必须保留（恢复后实体仍有全部物品）
        assert.equal(restored, INITIAL, "keepInventory 世界丢物：恢复背包应为 64");
        assert.equal(world.drops, 0);
      } else {
        // 死亡掉落：掉落物是唯一副本，恢复后实体背包为空
        assert.equal(world.drops, INITIAL, "掉落物应为 64");
        assert.equal(restored, 0, "掉落世界恢复后背包应为空（防刷物）");
      }
    });
  }
}

// ─── 用例：重复击杀（刷物经典路径） ────────────────────

test("物品守恒：掉落世界重复击杀不产生额外物品（经典刷物路径）", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);
  store.saveInventory("bot1", invOf(INITIAL));

  const world: SimWorld = { keepInventory: false, engineClearedOnDie: true, drops: 0 };
  let entityInv = INITIAL;

  // 第一次击杀：掉落 64，持久化清空
  entityInv = simulateDie(world, store, record, entityInv);
  assert.equal(world.drops, INITIAL);

  // 击杀后玩家拿走掉落 → 重连恢复（空背包）
  const restored1 = simulateRejoin(store, record);
  assert.equal(restored1, 0);

  // 第二次击杀：背包已空 → 无掉落 → 仍无新增
  entityInv = simulateDie(world, store, record, 0);
  assert.equal(world.drops, INITIAL, "第二次击杀不应产生掉落");
  assert.equal(countOf(store.loadInventory("bot1")), 0);

  // 总副本 = 掉落 64 + 持久化 0 = 64（守恒）
  assert.equal(world.drops + countOf(store.loadInventory("bot1")), INITIAL);
});

// ─── 用例：keepInventory 世界死亡不掉落（防丢物） ──────

test("物品守恒：keepInventory 世界重复击杀物品始终保留", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);
  store.saveInventory("bot1", invOf(INITIAL));

  const world: SimWorld = { keepInventory: true, engineClearedOnDie: false, drops: 0 };
  let entityInv = INITIAL;

  // 第一次击杀：不掉落，持久化保存实体背包（64）
  entityInv = simulateDie(world, store, record, entityInv);
  assert.equal(world.drops, 0);
  assert.equal(countOf(store.loadInventory("bot1")), INITIAL);

  // 重连恢复：背包完整
  assert.equal(simulateRejoin(store, record), INITIAL);

  // 第二次击杀：仍然保留
  entityInv = simulateDie(world, store, record, entityInv);
  assert.equal(countOf(store.loadInventory("bot1")), INITIAL);
  assert.equal(world.drops, 0);
});

// ─── 策略函数直接测试 ──────────────────────────────────

test("decideDeathInventoryPolicy：规则映射", () => {
  assert.equal(decideDeathInventoryPolicy(true), "persist");
  assert.equal(decideDeathInventoryPolicy(false), "clear");
});