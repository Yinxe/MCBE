import { test } from "node:test";
import assert from "node:assert/strict";
import { MemberService } from "../scripts/core/services/MemberService";
import type { Warehouse } from "../scripts/core/model/Warehouse";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse(): Warehouse {
  return {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [
      { playerId: "p1", role: "owner" },
      { playerId: "p2", role: "member" },
      { playerId: "p3", role: "visitor" },
    ],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map(),
  };
}

test("MemberService: getRole", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.getRole(wh, "p1"), "owner");
  assert.equal(svc.getRole(wh, "p2"), "member");
  assert.equal(svc.getRole(wh, "p3"), "visitor");
  assert.equal(svc.getRole(wh, "ghost"), undefined);
});

test("MemberService: 权限矩阵", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.can(wh, "p1", "owner"), true);
  assert.equal(svc.can(wh, "p2", "owner"), false);
  assert.equal(svc.can(wh, "p2", "member"), true);
  assert.equal(svc.can(wh, "p3", "member"), false);
  assert.equal(svc.can(wh, "p3", "visitor"), true);
  assert.equal(svc.can(wh, "ghost", "visitor"), false);
});

// ── Task 21: WarehouseService ─────────────────────────────
import { WarehouseService } from "../scripts/core/services/WarehouseService";
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";

const area1: WarehouseArea = { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } };
const area2: WarehouseArea = { dimension: "overworld", corner1: { x: 20, y: 0, z: 0 }, corner2: { x: 30, y: 10, z: 10 } };

test("WarehouseService: 创建/重载/重名拒绝", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r1 = svc.createWarehouse("主仓库", "p1", area1);
  assert.equal(r1.ok, true);
  const r2 = svc.createWarehouse("主仓库", "p1", area2); // 重名
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /同名/);
  const r3 = svc.createWarehouse("  ", "p1", area2); // 空名
  assert.equal(r3.ok, false);
  const reloaded = svc.loadAll();
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0]?.displayName, "主仓库");
});

test("WarehouseService: 区域重叠拒绝", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r1 = svc.createWarehouse("仓A", "p1", area1);
  assert.equal(r1.ok, true);
  const overlap: WarehouseArea = { dimension: "overworld", corner1: { x: 5, y: 0, z: 5 }, corner2: { x: 15, y: 10, z: 15 } };
  const r2 = svc.createWarehouse("仓B", "p1", overlap);
  assert.equal(r2.ok, false);
  assert.match((r2 as { error: string }).error, /重叠/);
  const r3 = svc.createWarehouse("仓C", "p1", area2); // 不重叠 → 成功
  assert.equal(r3.ok, true);
});

test("WarehouseService: 删除/重命名/成员管理", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r = svc.createWarehouse("主仓库", "p1", area1);
  assert.equal(r.ok, true);
  if (!r.ok) return; // 类型收窄
  const wh = r.warehouse;
  svc.rename(wh, "新名字");
  assert.equal(wh.displayName, "新名字");
  const dup = svc.rename(wh, "主仓库"); // 重名但排除自身 id → 成功
  assert.equal(dup, undefined);
  svc.addMember(wh, "p2", "member");
  assert.equal(wh.members.length, 2);
  const dupMember = svc.addMember(wh, "p2", "member");
  assert.match(dupMember ?? "", /已是成员/);
  svc.setMemberRole(wh, "p2", "visitor");
  assert.equal(wh.members.find((m) => m.playerId === "p2")?.role, "visitor");
  svc.removeMember(wh, "p2");
  assert.equal(wh.members.length, 1);
  svc.deleteWarehouse(wh.id);
  assert.equal(svc.loadAll().length, 0);
});

// ── Task 22: RouteService ────────────────────────────────
import { RouteService } from "../scripts/core/services/RouteService";
import { Scheduler } from "../scripts/core/scheduling/Scheduler";
import { Router } from "../scripts/core/routing/Router";
import { SingleItemStrategy, MultiItemStrategy, MiscStrategy } from "../scripts/core/routing/RouteStrategy";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { MemoryIntervalScheduler } from "../scripts/core/scheduling/IntervalScheduler";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";

function makeRouteService() {
  const intervals = new MemoryIntervalScheduler();
  const proximity = {
    hasNearbyPlayer: () => true,
  };
  const index = new ItemIndex();
  const bus = new EventBus();
  const router = new Router(
    [new SingleItemStrategy(), new MultiItemStrategy(), new MiscStrategy()],
    new DefaultCandidateSorter(),
    index,
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus);
  const service = new RouteService(scheduler);
  const containers = new Map<string, InMemoryContainer>();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  return { service, scheduler, intervals, index, bus, warehouse, containers };
}

test("RouteService: 全局开关停/恢复", () => {
  const w = makeRouteService();
  w.service.setGlobalEnabled(false);
  w.scheduler.registerWarehouse(w.warehouse);
  w.scheduler.tick(); // 全局关 → 不激活
  assert.equal(w.scheduler.getLifecycle("w1"), "inactive");
  w.service.setGlobalEnabled(true);
  w.scheduler.tick();
  assert.equal(w.scheduler.getLifecycle("w1"), "active");
});

test("RouteService: 容器开关禁用输入容器后不处理", () => {
  const w = makeRouteService();
  const input = new InMemoryContainer("in", "input", 3);
  input.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const target = new InMemoryContainer("m1", "multi", 3);
  target.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64)); // 需已含 stone 才成为候选
  w.containers.set("in", input);
  w.containers.set("m1", target);
  w.index.onContainerAdded(input);
  w.index.onContainerAdded(target);
  w.scheduler.registerWarehouse(w.warehouse);
  w.service.setContainerEnabled(w.warehouse, "in", false);
  w.scheduler.tick();
  w.intervals.advance(8);
  assert.equal(input.getItem(0)?.amount, 10); // 未处理
  w.service.setContainerEnabled(w.warehouse, "in", true);
  w.intervals.advance(8);
  assert.equal(input.getItem(0), undefined); // 恢复后处理
});

// ── Task 23: OrganizeService ─────────────────────────────
import { OrganizeService } from "../scripts/core/services/OrganizeService";
import { Organizer } from "../scripts/core/organizing/Organizer";
import { MoveJournal } from "../scripts/core/routing/Move";

test("OrganizeService: organize 合并后索引更新", () => {
  const bus = new EventBus();
  const index = new ItemIndex();
  const organizer = new Organizer(new DefaultCandidateSorter());
  const svc = new OrganizeService(organizer, index, bus);
  const misc = new InMemoryContainer("x", "misc", 4);
  misc.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  const multi = new InMemoryContainer("m1", "multi", 4);
  multi.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  index.onContainerAdded(misc);
  index.onContainerAdded(multi);
  const containers = new Map([[misc.id, misc], [multi.id, multi]]);
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerId: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers,
  };
  const ok = svc.organize(warehouse, new MoveJournal());
  assert.equal(ok, true);
  assert.equal(misc.getItem(0), undefined);
  assert.equal(multi.getItem(0)?.amount, 15);
  // 索引已更新：misc 不再命中 stone
  const lookup = index.lookup("minecraft:stone");
  assert.deepEqual(lookup.multi, ["m1"]);
});