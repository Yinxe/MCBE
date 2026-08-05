import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SingleItemStrategy,
  MultiItemStrategy,
  MiscStrategy,
} from "../scripts/core/routing/RouteStrategy";
import type { RouteContext, CandidateContainer } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { transfer, MoveJournal } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function makeCtx(containers: InMemoryContainer[], lookup: (typeId: string) => { single: string[]; multi: string[] }): RouteContext {
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { routingEnabled: true, sortingEnabled: true, processingSpeed: 8, warningThreshold: 0.9, autoSortThreshold: 0.4, defaultContainerRole: "single" as const, defaultContainerEnabled: true },
    containers: new Map(containers.map((c) => [c.id, c])),
    inputs: new Map(),
  };
  return {
    item: new SimpleItemStack("minecraft:stone", 10, 64),
    warehouse,
    lookupIndex: lookup,
    reconcile: () => {},
  };
}

test("SingleItemStrategy: 只返回绑定匹配的单物容器", () => {
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const ctx = makeCtx([single], () => ({ single: ["s1"], multi: [] }));
  const got = new SingleItemStrategy().findCandidates(ctx);
  assert.equal(got.length, 1);
  assert.equal(got[0]?.container.id, "s1");
});

test("SingleItemStrategy: 绑定不匹配则不返回（索引与实际绑定一致时）", () => {
  const single = new InMemoryContainer("s1", "single", 3);
  single.setItem(0, new SimpleItemStack("minecraft:dirt", 5, 64)); // 绑定 dirt
  const ctx = makeCtx([single], () => ({ single: ["s1"], multi: [] }));
  const got = new SingleItemStrategy().findCandidates(ctx);
  assert.equal(got.length, 0); // stone 与 dirt 不匹配
});

test("MultiItemStrategy / MiscStrategy: 按索引返回（多物须实际含该型）", () => {
  const multi = new InMemoryContainer("m1", "multi", 3);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64)); // 空多物不是候选
  const misc = new InMemoryContainer("x1", "misc", 3);
  const ctx = makeCtx([multi, misc], () => ({ single: [], multi: ["m1"] }));
  assert.deepEqual(new MultiItemStrategy().findCandidates(ctx).map((c) => c.container.id), ["m1"]);
  assert.equal(new MiscStrategy().findCandidates(ctx).length, 1); // misc 兜底：全量取 enabled misc 容器
});

test("DefaultCandidateSorter: 满箱跳过 → 优先级升序 → 使用率降序", () => {
  const sorter = new DefaultCandidateSorter();
  const input = [
    cand("a", 10, 0.3),
    cand("full", 10, 1.0, true),
    cand("b", 5, 0.2),
    cand("c", 10, 0.9),
  ];
  const sorted = sorter.sort(input);
  assert.deepEqual(sorted.map((c) => c.container.id), ["b", "c", "a"]);
});

test("transfer: 全部移走（源清空，目标放入）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = new InMemoryContainer("t", "multi", 3);
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining, undefined);
  assert.equal(from.getItem(0), undefined);
  assert.equal(to.getItem(0)?.itemId, "minecraft:stone");
});

test("transfer: 部分堆叠（剩余放回源槽）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  const to = new InMemoryContainer("t", "multi", 1); // 单槽：只能堆叠，剩余放回源
  to.setItem(0, new SimpleItemStack("minecraft:stone", 60, 64));
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining?.amount, 60); // 64 - 4 放入
  assert.equal(from.getItem(0)?.amount, 60);
  assert.equal(to.getItem(0)?.amount, 64);
});

test("transfer: 完全放不下（源不动，返回原堆）", () => {
  const from = new InMemoryContainer("f", "input", 3);
  from.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const to = new InMemoryContainer("t", "multi", 1);
  to.setItem(0, new SimpleItemStack("minecraft:dirt", 64, 64)); // 占满且不匹配
  const remaining = transfer({ container: from, slot: 0 }, to);
  assert.equal(remaining?.amount, 10);
  assert.equal(from.getItem(0)?.amount, 10);
});

test("MoveJournal: 快照回滚恢复原状", () => {
  const journal = new MoveJournal();
  const c = new InMemoryContainer("c", "multi", 3);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  journal.snapshot(c);
  c.setItem(0, undefined);
  c.setItem(1, new SimpleItemStack("minecraft:dirt", 9, 64));
  journal.rollback();
  assert.equal(c.getItem(0)?.itemId, "minecraft:stone");
  assert.equal(c.getItem(1), undefined);
});

function cand(id: string, priority: number, usage: number, full = false): CandidateContainer {
  return {
    container: { id } as never,
    priority,
    usageRatio: usage,
    isFull: full,
  };
}

// ── Task 14: Router ─────────────────────────────────────
import { Router } from "../scripts/core/routing/Router";
import { EventBus } from "../scripts/core/events/DomainEvents";

// 可编程索引 stub：lookup 返回固定结果，reconcile 记录调用
function makeIndexStub() {
  const state = {
    byItem: new Map<string, { single: string[]; multi: string[] }>(),
    moved: [] as string[],
    reconciled: [] as string[],
    lookups: 0,
  };
  const stub = {
    lookup: (typeId: string) => {
      state.lookups++;
      return state.byItem.get(typeId) ?? { single: [], multi: [] };
    },
    reconcile: (c: unknown) => {
      state.reconciled.push((c as { id: string }).id);
    },
    onItemMoved: (from: string, to: string, itemId: string) => {
      state.moved.push(`${from}->${to}:${itemId}`);
    },
    state,
  };
  return stub;
}

function makeWarehouse() {
  const containers = new Map<string, InMemoryContainer>();
  const wh = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { routingEnabled: true, sortingEnabled: true, processingSpeed: 8, warningThreshold: 0.9, autoSortThreshold: 0.4, defaultContainerRole: "single" as const, defaultContainerEnabled: true },
    containers,
    inputs: new Map<string, InMemoryContainer>(),
  };
  const add = (c: InMemoryContainer) => {
    containers.set(c.id, c);
    return c;
  };
  return { wh, add };
}

test("Router: 单物优先于多物（stone 进 single 容器）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const single = add(new InMemoryContainer("s1", "single", 3));
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const multi = add(new InMemoryContainer("m1", "multi", 3));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: ["s1"], multi: ["m1"] });
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    bus
  );
  let routed: string | undefined;
  bus.itemRouted.subscribe((e) => (routed = `${e.from}->${e.to}`));
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result?.to, "s1");
  assert.equal(routed, "in->s1");
  assert.deepEqual(index.state.moved, ["in->s1:minecraft:stone"]);
});

test("Router: 优先级/使用率排序决定目标（priority 5 先于 10）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
  const a = add(new InMemoryContainer("a", "multi", 3));
  a.setItem(0, new SimpleItemStack("minecraft:dirt", 1, 64));
  a.priority = 5;
  const b = add(new InMemoryContainer("b", "multi", 3));
  b.setItem(0, new SimpleItemStack("minecraft:dirt", 1, 64));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:dirt", { single: [], multi: ["a", "b"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result?.to, "a");
});

test("Router: 全部候选失败 → 物品留在源", () => {
  const wh2 = makeWarehouse();
  const input2 = wh2.add(new InMemoryContainer("in", "input", 3));
  input2.setItem(0, new SimpleItemStack("minecraft:bedrock", 10, 64));
  const index = makeIndexStub();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input2, 0, wh2.wh, index);
  assert.equal(result, undefined);
  assert.equal(input2.getItem(0)?.amount, 10);
});

test("Router: 候选容器已不含该类型（漂移）→ 策略重建条目并跳过", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("m1", "multi", 3)); // 空多物：无 stone（索引过期）
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: [], multi: ["m1"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result, undefined); // 过期候选被跳过，物品留在源
  assert.deepEqual(index.state.reconciled, ["m1"]); // 策略自持校验 → reconcile 重建条目
});

test("Router: 同一次路由招索引 lookup 只调用一次（缓存）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  add(new InMemoryContainer("s1", "single", 3)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  add(new InMemoryContainer("m1", "multi", 3)).setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: ["s1"], multi: ["m1"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  router.routeFrom(input, 0, wh, index);
  // single + multi 两个策略都查同一 itemId，但一次路由只真正 look up 一次
  assert.equal(index.state.lookups, 1);
});
