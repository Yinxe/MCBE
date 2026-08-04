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
    settings: { sortingEnabled: true, processingSpeed: 8, warningThreshold: 0.9, autoSortThreshold: 3 },
    containers: new Map(containers.map((c) => [c.id, c])),
  };
  return {
    item: new SimpleItemStack("minecraft:stone", 10, 64),
    warehouse,
    lookupIndex: lookup,
    verifyCandidate: () => true,
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

test("MultiItemStrategy / MiscStrategy: 按索引返回", () => {
  const multi = new InMemoryContainer("m1", "multi", 3);
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
