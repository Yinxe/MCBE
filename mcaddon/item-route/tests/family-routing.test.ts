// 同族路由 + 黑白名单：核心机制单测。
// 覆盖（对齐本期目标）：
//   1. FAMILY_BY_ITEM 一致性（一物一族，防重复归纳）
//   2. 同族路由：多物容器实含某族任一成员 → 收族内任意物品（内容派生，复用多物索引族桶）
//   3. 仓库级禁用该族 → 不落族箱
//   4. 容器级黑名单：该族箱亦永收黑名单内物品（准入先于层级）
//   5. 白名单 = 允许（声明式）：空多物/空单物被白名单"预订"，缺物也能收
//   6. 仓库级黑名单：该物品永不进入仓库（Scheduler 遇必阻塞）
import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../scripts/core/routing/Router";
import {
  SingleItemStrategy,
  MultiItemStrategy,
  FamilyStrategy,
  MiscStrategy,
} from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { transfer, MoveJournal } from "../scripts/core/routing/Move";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import { createDefaultSettings, type Warehouse } from "../scripts/core/model/Warehouse";
import { ITEM_FAMILIES, familyOf } from "../scripts/core/data/item-families";
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import { registerContainer } from "../scripts/core/model/ContainerRegistry";

test("FAMILY_BY_ITEM：一物一族，族非空，羊毛含多色", () => {
  // 每个物品只属于一族（Record key 唯一 + 双循环核验互斥）
  const seen = new Map<string, string>();
  for (const f of ITEM_FAMILIES) {
    assert.ok(f.items.length > 0, `族 ${f.id} 不应为空`);
    for (const id of f.items) {
      const prev = seen.get(id);
      assert.equal(prev, undefined, `物品 ${id} 同时属于 ${prev} 与 ${f.id}`);
      seen.set(id, f.id);
    }
  }
  // 反查一致
  for (const f of ITEM_FAMILIES) {
    for (const id of f.items) assert.equal(familyOf(id), f.id);
  }
  // 羊毛族（本案核心）确含白/橙等多色 → 驱动"存白收橙"场景
  const wool = ITEM_FAMILIES.find((f) => f.id === "wool");
  assert.ok(wool !== undefined);
  assert.ok(wool.items.includes("minecraft:white_wool"));
  assert.ok(wool.items.includes("minecraft:orange_wool"));
});

// ── 构建真实索引 + Router（含 FamilyStrategy）的最小可用仓库 ──
function makeRouterWorld(items?: (c: InMemoryContainer) => void) {
  const containers = new Map<string, InMemoryContainer>();
  const index = new ItemIndex();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
    inputs: new Map<string, InMemoryContainer>(),
  };
  const add = (c: InMemoryContainer): InMemoryContainer => {
    containers.set(c.id, c);
    index.onContainerAdded(c);
    return c;
  };
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new FamilyStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const route = (stack: SimpleItemStack): Awaited<ReturnType<Router["routeFrom"]>> => {
    const input = new InMemoryContainer("in", "input", 3);
    containers.set(input.id, input);
    index.onContainerAdded(input);
    input.setItem(0, stack);
    return router.routeFrom(input, 0, warehouse, index);
  };
  return { warehouse, add, route, index, containers };
}

function r(stack: string, amount: number): SimpleItemStack {
  return new SimpleItemStack(stack, amount, 64);
}

test("FamilyStrategy：多物容器装白羊毛（启族）→ 橙羊毛由族桶定位并收（内容派生）", () => {
  const w = makeRouterWorld();
  const famBox = new InMemoryContainer("mF", "multi", 3);
  famBox.familyEnabled = true;
  famBox.setItem(0, r("minecraft:white_wool", 5)); // 启族箱已装白羊毛 → 派生羊毛族桶
  w.add(famBox);
  // 索引族桶应含该箱：复用多物索引派生（white_wool → family wool → 族桶）
  assert.deepEqual(w.index.lookupFamily("wool"), ["mF"]);
  const res = w.route(r("minecraft:orange_wool", 10)); // 橙羊毛，同一羊毛族
  assert.equal(res?.to, "mF");
  // 橙羊毛是新色 → 落不同空槽（白仍在原槽），同族收纳达成
  assert.equal(famBox.getItem(1)?.itemId, "minecraft:orange_wool");
  assert.equal(famBox.getItem(1)?.amount, 10);
});

test("FamilyStrategy：族被仓库禁用 → 不落族箱（misc 兜底）", () => {
  const w = makeRouterWorld();
  // 仓库只启用 carpet，禁用 wool
  w.warehouse.settings.enabledFamilies = ["carpet"];
  const famBox = new InMemoryContainer("mF", "multi", 3);
  famBox.familyEnabled = true;
  famBox.setItem(0, r("minecraft:white_wool", 5));
  w.add(famBox);
  const out = new InMemoryContainer("x1", "misc", 3);
  w.add(out);
  const res = w.route(r("minecraft:orange_wool", 10));
  assert.equal(res?.to, "x1"); // 族禁用 → 落杂项，不进族箱
  assert.equal(famBox.getItem(0)?.amount, 5);
});

test("容器级黑名单：族箱黑名单含该物品 → 永不收入（准入先于层级）", () => {
  const w = makeRouterWorld();
  const famBox = new InMemoryContainer("mF", "multi", 3);
  famBox.familyEnabled = true;
  famBox.blacklist = ["minecraft:orange_wool"];
  famBox.setItem(0, r("minecraft:white_wool", 5));
  w.add(famBox);
  const out = new InMemoryContainer("m1", "misc", 3);
  w.add(out);
  const res = w.route(r("minecraft:orange_wool", 10));
  // 黑名单命中 → 族箱被准入拒绝 → 直落 misc（不进族箱的家也不进）
  assert.equal(res?.to, "m1");
  assert.equal(famBox.getItem(0)?.amount, 5);
});

test("白名单 = 允许式：缺多物容器白名单含 X → 空箱也收（缺物允许）", () => {
  const w = makeRouterWorld();
  const box = new InMemoryContainer("m1", "multi", 3);
  box.whitelist = ["minecraft:stone"]; // 未装 stone，但声明允许
  w.add(box);
  const res = w.route(r("minecraft:stone", 8));
  assert.equal(res?.to, "m1"); // 白名单声明 → 空箱也接收
  assert.equal(box.getItem(0)?.itemId, "minecraft:stone");
});

test("白名单 = 允许式：空单物被白名单预订 → 预分配分类", () => {
  const w = makeRouterWorld();
  const single = new InMemoryContainer("s1", "single", 3);
  single.whitelist = ["minecraft:diamond"]; // 空单物，白名单声明要 diamond
  w.add(single);
  const res = w.route(r("minecraft:diamond", 6));
  assert.equal(res?.to, "s1");
  assert.equal(single.getItem(0)?.itemId, "minecraft:diamond");
});

test("Scheduler：仓库级黑名单物品 → 输入遇必阻塞，永不路由", () => {
  const intervals = new MemoryIntervalScheduler();
  const proximity = { hasNearbyPlayer: () => true };
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new FamilyStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus, 8, 40, { fallbackIndex: index });
  const containers = new Map<string, InMemoryContainer>();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "W1",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { ...createDefaultSettings(), blacklist: ["minecraft:bedrock"] },
    containers,
    inputs: new Map<string, InMemoryContainer>(),
  };
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, r("minecraft:bedrock", 3));
  registerContainer(warehouse, input);
  index.onContainerAdded(input);
  // 给个能收 bedrock 的目标，验证仓库黑名单仍一刀切阻塞
  const target = new InMemoryContainer("m1", "misc", 3);
  registerContainer(warehouse, target);
  index.onContainerAdded(target);

  let blocked = 0;
  bus.inputBlocked.subscribe(() => blocked++);

  scheduler.registerWarehouse(warehouse);
  scheduler.tick(); // active
  intervals.advance(40);
  assert.equal(input.getItem(0)?.amount, 3); // 物品留在源
  assert.equal(target.getItem(0), undefined); // 目标未被放入
  assert.equal(blocked, 1); // 进入阻塞态触发一次
  assert.ok([...scheduler.blockedInputIds("w1")].includes("in"));
});