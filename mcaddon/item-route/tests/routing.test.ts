import { test } from "node:test";
import assert from "node:assert/strict";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy, admission } from "../scripts/core/routing/RouteStrategy";
import type { RouteContext, CandidateContainer } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { transfer, MoveJournal } from "../scripts/core/routing/Move";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function makeCtx(
  containers: InMemoryContainer[],
  lookup: (typeId: string) => { single: string[]; multi: string[] }
): RouteContext {
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: {
      routingEnabled: true,
      sortingEnabled: true,
      processingSpeed: 8,
      warningThreshold: 0.9,
      autoSortThreshold: 0.4,
      showBoundary: false,
      warningEnabled: true,
      defaultContainerRole: "single" as const,
      defaultContainerEnabled: true,
      enabledFamilies: [],
      blacklist: [],
    },
    containers: new Map(containers.map((c) => [c.id, c])),
    inputs: new Map(),
  };
  return {
    item: new SimpleItemStack("minecraft:stone", 10, 64),
    warehouse,
    lookupIndex: lookup,
    lookupFamily: () => [],
    reconcile: () => {},
    admission,
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
  assert.deepEqual(
    new MultiItemStrategy().findCandidates(ctx).map((c) => c.container.id),
    ["m1"]
  );
  assert.equal(new MiscStrategy().findCandidates(ctx).length, 1); // misc 兜底：全量取 enabled misc 容器
});

test("DefaultCandidateSorter: 未满优先 → 优先级升序 → 使用率降序（满箱靠后作极限堆叠兜底）", () => {
  const sorter = new DefaultCandidateSorter();
  const input = [cand("a", 10, 0.3), cand("full", 10, 1.0, true), cand("b", 5, 0.2), cand("c", 10, 0.9)];
  const sorted = sorter.sort(input);
  assert.deepEqual(
    sorted.map((c) => c.container.id),
    ["b", "c", "a", "full"] // 满箱不跳过，排在最后（仍可并进未满堆叠槽）
  );
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

// 可编程索引 stub：lookup 返回固定结果，reconcile/selfHeal 记录调用（selfHeal 模拟全仓自愈）
function makeIndexStub() {
  const state = {
    byItem: new Map<string, { single: string[]; multi: string[] }>(),
    family: new Map<string, string[]>(),
    moved: [] as string[],
    reconciled: [] as string[],
    selfHealed: [] as string[],
    lookups: 0,
  };
  const stub = {
    lookup: (typeId: string) => {
      state.lookups++;
      return state.byItem.get(typeId) ?? { single: [], multi: [] };
    },
    lookupFamily: (familyId: string) => state.family.get(familyId) ?? [],
    reconcile: (c: unknown) => {
      state.reconciled.push((c as { id: string }).id);
    },
    onItemMoved: (from: unknown, to: unknown, itemId: string) => {
      state.moved.push(`${(from as { id: string }).id}->${(to as { id: string }).id}:${itemId}`);
    },
    // 自愈：扫描存储容器找 hasItem → 记录 + 把该容器加为候选（单物→single / 多物→multi）
    selfHeal: (item: { itemId: string }, containers: Iterable<InMemoryContainer>) => {
      state.selfHealed.push(item.itemId);
      for (const c of containers) {
        if (c.role === "input" || c.role === "misc") continue;
        if (!c.contains(item as never)) continue;
        state.reconciled.push(c.id);
        const e = state.byItem.get(item.itemId) ?? { single: [] as string[], multi: [] as string[] };
        if (c.role === "single") {
          if (!e.single.includes(c.id)) e.single.push(c.id);
        } else if (!e.multi.includes(c.id)) {
          e.multi.push(c.id);
        }
        state.byItem.set(item.itemId, e);
      }
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
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: {
      routingEnabled: true,
      sortingEnabled: true,
      processingSpeed: 8,
      warningThreshold: 0.9,
      autoSortThreshold: 0.4,
      showBoundary: false,
      warningEnabled: true,
      defaultContainerRole: "single" as const,
      defaultContainerEnabled: true,
      enabledFamilies: [],
      blacklist: [],
    },
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

test("Router: stale 候选堵住顶部 selfHeal → 落 misc 前重扫把真持有容器纳入（盲区修复）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:gold_ingot", 10, 64));
  // m1：索引残留 stale 条目（声称装 gold，实际已空——手动清空无内容事件删索引）
  add(new InMemoryContainer("m1", "multi", 3));
  // m2：真持有 gold（玩家 GUI 预放），但索引不知道
  const m2 = add(new InMemoryContainer("m2", "multi", 3));
  m2.setItem(0, new SimpleItemStack("minecraft:gold_ingot", 5, 64));
  const misc = add(new InMemoryContainer("x1", "misc", 3));
  const index = makeIndexStub();
  // 只给 stale 候选：lookup 非空 → 旧实现顶部 selfHeal 被跳过 → 直落 misc
  index.state.byItem.set("minecraft:gold_ingot", { single: [], multi: ["m1"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  // 期望：落 misc 前重扫发现 m2 真含 gold → 进 m2，而非 x1
  assert.equal(result?.to, "m2");
  assert.deepEqual(index.state.selfHealed, ["minecraft:gold_ingot"]);
  assert.equal(m2.getItem(0)?.amount, 15); // 5 + 10 并进
  assert.equal(misc.getItem(0), undefined);
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

test("Router: 满箱容器仍可极限堆叠部分（item 4.6：目标无空槽但同类槽未满）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 64, 64));
  // 目标多物容器 1 格已占满（满箱），但该格是 stone 64/64 未满总量？不——构造：容量 1 满但 stone 未满
  // 用容量 1 的容器：slot0 已有 stone 60/64 → 无空槽（isFull）但可并进 4 个
  const full = add(new InMemoryContainer("full", "multi", 1));
  full.setItem(0, new SimpleItemStack("minecraft:stone", 60, 64));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: [], multi: ["full"] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result?.routed, true);
  assert.equal(result?.amount, 4); // 只移走可堆叠的 4 个
  assert.equal(input.getItem(0)?.amount, 60); // 剩余留在源槽（极限堆叠，不再被误判为整仓堵塞）
  assert.equal(full.getItem(0)?.amount, 64);
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

test("Router: selfHeal 冷却+滑动续期——持续无效流只扫首次，流停到期后恢复自愈", () => {
  let t = 0;
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  add(new InMemoryContainer("x1", "misc", 3)); // 无 single/multi 候选 → 全进 misc
  const index = makeIndexStub(); // 空索引 → lookup 全空，走顶部 selfHeal
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus(),
    admission,
    () => t // 假时钟
  );
  // 连续同 type 路由：第 1 次自愈，之后每次命中都**续期**压住（不重扫）
  for (let i = 0; i < 5; i++) {
    input.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
    router.routeFrom(input, 0, wh, index);
    t += 1000; // 每次隔 1s（< 5s 冷却）
  }
  assert.equal(index.state.selfHealed.length, 1); // 只扫了首次，续期压住后续 4 次
  // 流停 → 冷却到期 → 下一个同 type 恢复自愈（此刻可能已手动放入持有容器，重新感知）
  t += 6000; // 超过 5s 冷却
  input.setItem(0, new SimpleItemStack("minecraft:dirt", 10, 64));
  router.routeFrom(input, 0, wh, index);
  assert.equal(index.state.selfHealed.length, 2);
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

test("Router: 索引无候选 → selfHeal 全仓扫描自愈后路由到手动放入的容器", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:diamond", 5, 64));
  // 用户手动向多物容器放入 diamond（索引不知情 → 该类型无候选）
  add(new InMemoryContainer("m1", "multi", 3)).setItem(0, new SimpleItemStack("minecraft:diamond", 2, 64));
  const index = makeIndexStub(); // byItem 为空 → 索引 miss
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result?.to, "m1"); // selfHeal 扫描到 m1 → 路由到它而非落 misc
  assert.deepEqual(index.state.selfHealed, ["minecraft:diamond"]); // 触发了一次自愈
  assert.ok(index.state.reconciled.includes("m1")); // 自愈重建了 m1 索引条目
});

test("Router: 索引有候选时**不**触发 selfHeal（仅 miss 兜底，不每路由全扫）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const single = add(new InMemoryContainer("s1", "single", 3));
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: ["s1"], multi: [] });
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result?.to, "s1");
  assert.deepEqual(index.state.selfHealed, []); // 有候选 → 不扫描
});

// ── 失联容器（活塞移动/摧毁）：路由层统一门 + 非销毁 + 恢复事件 ─────────
test("Router: 失联候选容器 → 路由层统一跳过 + containerLost（非注销），恢复后路由到 + containerRecovered", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  // s1：已注册、绑定 stone，但底层被活塞移动/摧毁 → 失联
  const lost = add(new InMemoryContainer("s1", "single", 3));
  lost.warehouseId = "w1";
  lost.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  lost.markLost();
  const index = makeIndexStub();
  index.state.byItem.set("minecraft:stone", { single: ["s1"], multi: [] });
  const bus = new EventBus();
  const lostEvts: string[] = [];
  const recoveredEvts: string[] = [];
  bus.containerLost.subscribe((e) => lostEvts.push(e.containerId));
  bus.containerRecovered.subscribe((e) => recoveredEvts.push(e.containerId));
  const router = new Router([new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()], new DefaultCandidateSorter(), bus);
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result, undefined); // 失联容器被路由层跳过 → 不路由
  assert.deepEqual(lostEvts, ["s1"]); // 已发 containerLost（一次）
  assert.deepEqual(recoveredEvts, []); // 尚无恢复
  assert.ok(wh.containers.has("s1")); // 非销毁：容器仍在（临时不可用，等恢复或重载清扫）
  assert.deepEqual(index.state.moved, []); // 未发生任何移动
  // 恢复（活塞推回 / 新放盒到原位）→ 再次路由成功 + 发 containerRecovered
  lost.recoverLost();
  const again = router.routeFrom(input, 0, wh, index);
  assert.equal(again?.to, "s1");
  assert.deepEqual(recoveredEvts, ["s1"]); // 恢复事件已发
});

test("Router: 兜底 misc 候选失联 → 转移前统一门跳过 + 发 containerLost（全仓扫描来源路径）", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const misc = add(new InMemoryContainer("x1", "misc", 3));
  misc.warehouseId = "w1";
  misc.setItem(0, new SimpleItemStack("minecraft:dirt", 2, 64));
  misc.markLost(); // 失联（活塞摧毁）
  const index = makeIndexStub(); // 无候选（stone 不在任何桶）
  const bus = new EventBus();
  const lostEvts: string[] = [];
  bus.containerLost.subscribe((e) => lostEvts.push(e.containerId));
  const router = new Router([new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()], new DefaultCandidateSorter(), bus);
  const result = router.routeFrom(input, 0, wh, index);
  assert.equal(result, undefined); // 失联 misc 被跳过 → 不路由
  assert.deepEqual(lostEvts, ["x1"]); // 已发 containerLost（attempt 统一门覆盖全仓扫描候选）
  assert.ok(wh.containers.has("x1")); // 非销毁
  assert.deepEqual(index.state.moved, []);
});

// ── hasItemType 原生 O(1) 快判优先 + 遍历兜底 ──────────
import { hasItemType } from "../scripts/core/routing/helpers";

test("hasItemType: 原生 hasItemType 优先（命中直返免遍历）；未实现回退线性遍历", () => {
  // ① 原生快判 true → 直返（不依赖内容遍历）
  const FastYes = class extends InMemoryContainer {
    hasItemType(): boolean | undefined {
      return true;
    }
  };
  assert.equal(hasItemType(new FastYes("f1", "multi", 3), "minecraft:stone"), true);
  // ② 原生快判 false → 直返
  const FastNo = class extends InMemoryContainer {
    hasItemType(): boolean | undefined {
      return false;
    }
  };
  assert.equal(hasItemType(new FastNo("f2", "multi", 3), "minecraft:stone"), false);
  // ③ 未实现（InMemoryContainer 无 hasItemType）→ core 遍历兜底：装有 stone 即 true，空即 false
  const plain = new InMemoryContainer("p1", "multi", 3);
  plain.setItem(0, new SimpleItemStack("minecraft:stone", 3, 64));
  assert.equal(hasItemType(plain, "minecraft:stone"), true);
  const empty = new InMemoryContainer("p2", "multi", 3);
  assert.equal(hasItemType(empty, "minecraft:stone"), false);
  // ④ 原生命中可信；未命中返回 undefined（NBT/data 差异假阴性）→ core 线性遍历兜底确定
  const NativeMiss = class extends InMemoryContainer {
    hasItemType(): boolean | undefined {
      return undefined;
    }
  };
  const miss = new NativeMiss("p3", "multi", 3);
  miss.setItem(0, new SimpleItemStack("minecraft:stone", 3, 64));
  assert.equal(hasItemType(miss, "minecraft:stone"), true); // 遍历兜底兜出
  const missEmpty = new NativeMiss("p4", "multi", 3);
  assert.equal(hasItemType(missEmpty, "minecraft:stone"), false);
});

// ── 潜影盒防套娃：潜影盒物品不能路由进潜影盒容器 ───────────
import { containerCanAcceptItem } from "../scripts/core/model/Container";

test("containerCanAcceptItem: 潜影盒→潜影盒禁用；潜影盒→普通箱允许；非潜影物品不限制", () => {
  const shulker = new InMemoryContainer("a", "misc", 27);
  shulker.blockType = "minecraft:black_shulker_box";
  const chest = new InMemoryContainer("b", "misc", 27);
  chest.blockType = "minecraft:chest";
  const unknown = new InMemoryContainer("u", "misc", 27); // 缺省 blockType（旧测试容器）
  // BE 潜影盒物品 id：未染色=undyed_shulker_box（无 java 的 bare shulker_box）
  assert.equal(containerCanAcceptItem(shulker, "minecraft:undyed_shulker_box"), false);
  assert.equal(containerCanAcceptItem(shulker, "minecraft:white_shulker_box"), false); // 染色同样
  assert.equal(containerCanAcceptItem(chest, "minecraft:undyed_shulker_box"), true);
  assert.equal(containerCanAcceptItem(unknown, "minecraft:undyed_shulker_box"), true); // 未知方块不误伤
  assert.equal(containerCanAcceptItem(shulker, "minecraft:diamond"), true); // 非潜影物品不限
});

test("Router: 潜影盒物品路由——传输前拒绝潜影盒容器目标，普通箱子仍可进", () => {
  const { wh, add } = makeWarehouse();
  const input = add(new InMemoryContainer("in", "input", 3));
  input.setItem(0, new SimpleItemStack("minecraft:undyed_shulker_box", 1, 64));
  // 唯一候选是潜影盒容器 → 被过滤 → 无处可去
  const shulkerTarget = add(new InMemoryContainer("s1", "misc", 27));
  shulkerTarget.blockType = "minecraft:white_shulker_box";
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    new EventBus()
  );
  const blocked = router.routeFrom(input, 0, wh, makeIndexStub());
  assert.equal(blocked, undefined); // 潜影盒不能进潜影盒 → 不路由
  assert.equal(input.getItem(0)?.itemId, "minecraft:undyed_shulker_box"); // 物品留在输入
  assert.equal(shulkerTarget.getItem(0), undefined); // 目标未接受

  // 再加一个普通箱子候选 → 传输前判断跳过潜影盒、落到箱子
  const chest = add(new InMemoryContainer("c1", "misc", 27));
  chest.blockType = "minecraft:chest";
  const ok = router.routeFrom(input, 0, wh, makeIndexStub());
  assert.equal(ok?.to, "c1");
  assert.equal(chest.getItem(0)?.itemId, "minecraft:undyed_shulker_box");
  assert.equal(shulkerTarget.getItem(0), undefined); // 潜影盒目标仍被排除
});
