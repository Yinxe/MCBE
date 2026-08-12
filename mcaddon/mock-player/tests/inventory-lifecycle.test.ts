// ─── 死亡物品生命周期：存储时机点语义模拟测试 ───────────
//
// 语义（用户约定）：entityDie 回调时实体已处于死亡最终状态——
//   普通物品已按游戏规则掉落（掉落物是物品离开假人的唯一副本），
//   keepOnDeath（自带死亡不掉落）的物品仍在背包中。
//   死亡事件 = 数据存储时机点：直接读实体背包/装备/经验，有什么存什么。
//
// 本测试用 InMemoryBotStore 模拟"击杀→引擎掉落→死亡存储→重连恢复"序列，
// 验证该语义下物品守恒（无刷物）且 keepOnDeath 物品不丢（无丢物）：
//   - keepInventory=false（死亡掉落）：普通物品掉落、keepOnDeath 保留并如实存储
//   - keepInventory=true（死亡不掉落）：全部保留
//
// ⚠️ 正确性前提：entityDie 时实体背包 = 引擎掉落后的最终状态。
//    若实测发现引擎在 entityDie 之后才执行掉落（时序差异），需重新评估。

import { test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryBotStore } from "../scripts/core/storage/BotStore";
import { BotRegistry } from "../scripts/core/service/BotRegistry";
import type { SerializedItemStack } from "../scripts/core/model/Types";
import { makeItem, makeRecord } from "./helpers/factories";

const DIAMOND = "minecraft:diamond";
const ORDINARY = 64;       // 普通钻石（死亡掉落）
const KOD_AMOUNT = 1;      // 死亡不掉落钻石（keepOnDeath）

type ItemView = SerializedItemStack | null;

// ─── 模拟世界 ──────────────────────────────────────────

interface SimWorld {
  /** 世界是否开启死亡不掉落 */
  keepInventory: boolean;
  /** 玩家捡到的掉落物总量 */
  drops: number;
}

/** 背包数量视图（slot 0 放物品） */
function invOf(items: ItemView[]): ItemView[] {
  const arr: ItemView[] = new Array(36).fill(null);
  for (let i = 0; i < Math.min(items.length, 36); i++) arr[i] = items[i] ?? null;
  return arr;
}

/** 统计视图中的普通（非 keepOnDeath）钻石数量 */
function countOrdinary(items: ItemView[] | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, it) => sum + (it?.typeId === DIAMOND && !it.keepOnDeath ? it.amount : 0), 0);
}

/** 统计视图中的 keepOnDeath 物品数量 */
function countKeepOnDeath(items: ItemView[] | undefined): number {
  if (!items) return 0;
  return items.reduce((sum, it) => sum + (it?.keepOnDeath ? it.amount : 0), 0);
}

/**
 * 引擎死亡处理：按游戏规则生成掉落物。
 * @returns 实体死亡最终状态（entityDie 回调时实体背包的内容）
 */
function simulateEngineDeath(world: SimWorld, entityInv: ItemView[]): ItemView[] {
  if (world.keepInventory) return [...entityInv]; // 死亡不掉落：全部保留
  const kept: ItemView[] = new Array(entityInv.length).fill(null);
  for (let i = 0; i < entityInv.length; i++) {
    const it = entityInv[i];
    if (it?.keepOnDeath) {
      kept[i] = it; // 自带死亡不掉落：不掉落，留在背包
    } else if (it) {
      world.drops += it.amount; // 普通物品：掉落（离开假人）
    }
  }
  return kept;
}

/** mc entityDie 存储：有什么存什么（保存实体当前状态） */
function simulateDieStore(store: InMemoryBotStore, record: ReturnType<typeof makeRecord>, entityFinalInv: ItemView[]): void {
  store.saveInventory(record.name, entityFinalInv);
}

/** 模拟重连（playerJoin）：从持久化恢复背包 → 返回恢复的视图 */
function simulateRejoin(store: InMemoryBotStore, record: ReturnType<typeof makeRecord>): ItemView[] | undefined {
  return store.loadInventory(record.name);
}

// ─── 用例 ──────────────────────────────────────────────

test("存储时机：击杀后实体最终状态被如实保存（有什么存什么，不增不减）", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);

  const world: SimWorld = { keepInventory: false, drops: 0 };
  const initial: ItemView[] = invOf([
    makeItem(DIAMOND, ORDINARY),
    makeItem(DIAMOND, KOD_AMOUNT, { keepOnDeath: true }),
  ]);

  // 击杀 → 引擎掉落 → 实体最终状态
  const finalState = simulateEngineDeath(world, initial);
  assert.equal(world.drops, ORDINARY, "普通物品应掉落");
  assert.equal(countKeepOnDeath(finalState), KOD_AMOUNT, "keepOnDeath 物品应留在实体");

  // entityDie：有什么存什么
  simulateDieStore(store, record, finalState);
  const persisted = store.loadInventory("bot1")!;
  assert.equal(countOrdinary(persisted), 0, "普通物品不应出现在持久化（已掉落）");
  assert.equal(countKeepOnDeath(persisted), KOD_AMOUNT, "keepOnDeath 物品应如实保存");

  // 重连恢复：只恢复 keepOnDeath 物品 → 无刷物（掉落物是唯一副本）也无丢物
  const restored = simulateRejoin(store, record)!;
  assert.equal(countOrdinary(restored), 0);
  assert.equal(countKeepOnDeath(restored), KOD_AMOUNT);
  assert.equal(world.drops + countOrdinary(restored) + countKeepOnDeath(restored), ORDINARY + KOD_AMOUNT, "守恒");
});

test("存储时机：掉落世界纯普通物品 → 实体最终状态为空，持久化如实保存空", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);

  const world: SimWorld = { keepInventory: false, drops: 0 };
  const initial: ItemView[] = invOf([makeItem(DIAMOND, ORDINARY)]);

  const finalState = simulateEngineDeath(world, initial);
  simulateDieStore(store, record, finalState);
  const restored = simulateRejoin(store, record) ?? [];

  assert.equal(world.drops, ORDINARY);
  assert.equal(countOrdinary(restored), 0, "恢复应为空（防刷物）");
  assert.equal(world.drops + countOrdinary(restored), ORDINARY, "守恒");
});

test("存储时机：keepInventory 世界全部保留（不掉落不丢物）", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);

  const world: SimWorld = { keepInventory: true, drops: 0 };
  const initial: ItemView[] = invOf([
    makeItem(DIAMOND, ORDINARY),
    makeItem(DIAMOND, KOD_AMOUNT, { keepOnDeath: true }),
  ]);

  const finalState = simulateEngineDeath(world, initial);
  simulateDieStore(store, record, finalState);
  const restored = simulateRejoin(store, record)!;

  assert.equal(world.drops, 0, "不掉落");
  assert.equal(countOrdinary(restored), ORDINARY, "普通物品保留");
  assert.equal(countKeepOnDeath(restored), KOD_AMOUNT, "keepOnDeath 物品保留");
});

test("重复击杀（经典刷物路径）：第二次击杀不掉落、不新增副本", () => {
  const store = new InMemoryBotStore();
  const registry = new BotRegistry(store);
  const record = makeRecord("bot1");
  registry.save(record);

  const world: SimWorld = { keepInventory: false, drops: 0 };
  let entityInv: ItemView[] = invOf([
    makeItem(DIAMOND, ORDINARY),
    makeItem(DIAMOND, KOD_AMOUNT, { keepOnDeath: true }),
  ]);

  // 第一次击杀：普通掉落，实体只剩 keepOnDeath
  entityInv = simulateEngineDeath(world, entityInv);
  simulateDieStore(store, record, entityInv);
  assert.equal(world.drops, ORDINARY);

  // 重连恢复：只有 keepOnDeath
  let restored = simulateRejoin(store, record)!;
  assert.equal(countKeepOnDeath(restored), KOD_AMOUNT);

  // 第二次击杀：实体只剩 keepOnDeath（不掉落）→ 无新掉落
  entityInv = simulateEngineDeath(world, entityInv);
  simulateDieStore(store, record, entityInv);
  assert.equal(world.drops, ORDINARY, "第二次击杀不应产生掉落");

  restored = simulateRejoin(store, record)!;
  assert.equal(countKeepOnDeath(restored), KOD_AMOUNT, "keepOnDeath 物品持续保留");
  assert.equal(world.drops + countKeepOnDeath(restored), ORDINARY + KOD_AMOUNT, "守恒");
});