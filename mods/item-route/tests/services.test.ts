import { test } from "node:test";
import assert from "node:assert/strict";
import { MemberService } from "../scripts/core/services/MemberService";
import type { Warehouse } from "../scripts/core/model/Warehouse";
import { createDefaultSettings } from "../scripts/core/model/Warehouse";

function makeWarehouse(): Warehouse {
  return {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [
      { playerName: "p1", role: "owner" },
      { playerName: "p2", role: "member" },
      { playerName: "p3", role: "member" },
    ],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map(),
    inputs: new Map(),
  };
}

test("MemberService: getRole", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.getRole(wh, "p1"), "owner");
  assert.equal(svc.getRole(wh, "p2"), "member");
  assert.equal(svc.getRole(wh, "p3"), "member");
  assert.equal(svc.getRole(wh, "ghost"), undefined);
});

test("MemberService: 权限矩阵", () => {
  const svc = new MemberService();
  const wh = makeWarehouse();
  assert.equal(svc.can(wh, "p1", "owner"), true);
  assert.equal(svc.can(wh, "p2", "owner"), false);
  assert.equal(svc.can(wh, "p2", "member"), true);
  assert.equal(svc.can(wh, "p3", "member"), true);
  assert.equal(svc.can(wh, "ghost", "member"), false);
});

// ── Task 21: WarehouseService ─────────────────────────────
import {
  WarehouseService,
  areaSize,
  areaTooClose,
  areaExceedsLimits,
  DEFAULT_WAREHOUSE_LIMITS,
} from "../scripts/core/services/WarehouseService";
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";
import type { WarehouseArea } from "../scripts/core/model/Warehouse";

const area1: WarehouseArea = {
  dimension: "overworld",
  corner1: { x: 0, y: 0, z: 0 },
  corner2: { x: 10, y: 10, z: 10 },
};
const area2: WarehouseArea = {
  dimension: "overworld",
  corner1: { x: 20, y: 0, z: 0 },
  corner2: { x: 30, y: 10, z: 10 },
};

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

test("WarehouseService: 仓库名去 § 格式码 + 长度上限（防格式注入/刷屏）", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  // § 格式码被剥离
  const r1 = svc.createWarehouse("§c红色名§r", "p1", area1);
  assert.equal(r1.ok, true);
  if (r1.ok) assert.equal(r1.warehouse.displayName, "红色名");
  // 超长被拒
  const tooLong = svc.createWarehouse("啊".repeat(30), "p1", area2);
  assert.equal(tooLong.ok, false);
  assert.match((tooLong as { error: string }).error, /过长/);
  // rename 同样清洗
  const long2 = svc.createWarehouse("合法", "p1", area2);
  assert.equal(long2.ok, true);
  if (long2.ok) {
    const err = svc.rename(long2.warehouse, "§b" + "超".repeat(30));
    assert.match(err ?? "", /过长/);
    const ok = svc.rename(long2.warehouse, "§a短名");
    assert.equal(ok, undefined);
    assert.equal(long2.warehouse.displayName, "短名");
  }
});

test("WarehouseService: 区域重叠拒绝", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r1 = svc.createWarehouse("仓A", "p1", area1);
  assert.equal(r1.ok, true);
  const overlap: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 5, y: 0, z: 5 },
    corner2: { x: 15, y: 10, z: 15 },
  };
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
  svc.setMemberRole(wh, "p2", "member");
  assert.equal(wh.members.find((m) => m.playerName === "p2")?.role, "member");
  svc.removeMember(wh, "p2");
  assert.equal(wh.members.length, 1);
  svc.deleteWarehouse(wh.id);
  assert.equal(svc.loadAll().length, 0);
});

test("WarehouseService: setMemberRole 拒绝提升为 owner（防提权口径不一）", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const r = svc.createWarehouse("仓", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  });
  assert.equal(r.ok, true);
  svc.addMember(r.warehouse, "p2", "member");
  const err = svc.setMemberRole(r.warehouse, "p2", "owner");
  assert.match(err ?? "", /转让/);
  assert.equal(r.warehouse.members.find((m) => m.playerName === "p2")?.role, "member"); // 未被提权
});

test("WarehouseService: updateArea 校验体积/重叠/间距（resize 与 create 同口径）", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const a = svc.createWarehouse("仓A", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  });
  assert.equal(a.ok, true);
  // 扩到与自身重叠（排除自身）→ 允许
  assert.equal(
    svc.updateArea(a.warehouse, {
      dimension: "overworld",
      corner1: { x: -5, y: 0, z: -5 },
      corner2: { x: 15, y: 10, z: 15 },
    }),
    undefined
  );
  const b = svc.createWarehouse("仓B", "p2", {
    dimension: "overworld",
    corner1: { x: 100, y: 0, z: 100 },
    corner2: { x: 110, y: 10, z: 110 },
  });
  assert.equal(b.ok, true);
  // 与另一仓库重叠 → 拒绝
  const errOverlap = svc.updateArea(a.warehouse, {
    dimension: "overworld",
    corner1: { x: 105, y: 0, z: 105 },
    corner2: { x: 120, y: 10, z: 120 },
  });
  assert.match(errOverlap ?? "", /重叠/);
  // 超规格（任一轴超限）→ 拒绝
  const errBig = svc.updateArea(a.warehouse, {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 500, y: 500, z: 500 },
  });
  assert.match(errBig ?? "", /规格/);
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
import { SimpleItemStack, type ItemStack } from "../scripts/core/model/ItemStack";

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
    bus
  );
  const scheduler = new Scheduler(router, intervals, proximity, bus, 8, 40, { fallbackIndex: index });
  const service = new RouteService(scheduler);
  const containers = new Map<string, InMemoryContainer>();
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
  registerContainer(w.warehouse, input);
  registerContainer(w.warehouse, target);
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
import { registerContainer } from "../scripts/core/model/ContainerRegistry";

test("OrganizeService: organizeContainer 单容器合并可堆叠堆并排序，发 container-changed", () => {
  const bus = new EventBus();
  const organizer = new Organizer();
  const svc = new OrganizeService(organizer, bus);
  const changed: string[] = [];
  bus.containerChanged.subscribe((e) => changed.push(e.containerId));
  const c = new InMemoryContainer("c1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(2, new SimpleItemStack("minecraft:stone", 5, 64)); // 同型两堆 → 合并
  c.setItem(3, new SimpleItemStack("minecraft:dirt", 7, 64));
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map([["c1", c]]),
    inputs: new Map<string, InMemoryContainer>(),
  };
  const res = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res.ok, true);
  assert.equal(res.moves, 1); // stone 2 堆 → 1 堆
  assert.equal(res.beforeStacks, 3);
  assert.equal(res.afterStacks, 2);
  assert.equal(res.beforeTypes, 2);
  assert.equal(res.afterTypes, 2); // 种类守恒（就地整理不跨容器）
  assert.equal(res.totalSlots, 4);
  assert.equal(res.usedSlots, 2);
  assert.deepEqual(res.perType["minecraft:stone"], { stacks: 1, total: 15 });
  assert.deepEqual(res.perType["minecraft:dirt"], { stacks: 1, total: 7 });
  // 数据一致性：清空+重放后数量守恒（不丢失/不重复）
  assert.equal(c.getItem(0)!.amount + c.getItem(1)!.amount, 10 + 5 + 7);
  // 排序重放：dirt 先于 stone（typeId 升序）
  assert.equal(c.getItem(0)?.itemId, "minecraft:dirt");
  assert.equal(c.getItem(1)?.itemId, "minecraft:stone");
  assert.equal(c.getItem(1)?.amount, 15);
  assert.deepEqual(changed, ["c1"]); // 单容器 container-changed
});

test("OrganizeService: 空/已整齐容器 → 无需整理（moves=0）", () => {
  const bus = new EventBus();
  const svc = new OrganizeService(new Organizer(), bus);
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map<string, InMemoryContainer>(),
    inputs: new Map<string, InMemoryContainer>(),
  };
  const empty = new InMemoryContainer("e", "multi", 4);
  const r1 = svc.organizeContainer(warehouse, empty, new MoveJournal());
  assert.equal(r1.ok, true);
  assert.equal(r1.moves, 0);
  assert.equal(r1.messiness.total, 0);
  const single = new InMemoryContainer("s", "multi", 4);
  single.setItem(0, new SimpleItemStack("minecraft:stone", 5, 64));
  const r2 = svc.organizeContainer(warehouse, single, new MoveJournal());
  assert.equal(r2.ok, true);
  assert.equal(r2.moves, 0);
  assert.equal(single.getItem(0)?.amount, 5); // 未变
});

test("OrganizeService: 单物品但空槽前置 → 也强制整理归位（混乱度归 0，item 单物品整理修复）", () => {
  const bus = new EventBus();
  const svc = new OrganizeService(new Organizer(), bus);
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map<string, InMemoryContainer>(),
    inputs: new Map<string, InMemoryContainer>(),
  };
  // [空, 钻石, 空, 空]：单物品但空槽前置 → 混乱度 >0（原 `beforeStacks<=1` 短路不整理）
  const c = new InMemoryContainer("c", "multi", 4);
  c.setItem(1, new SimpleItemStack("minecraft:diamond", 12, 64));
  assert.ok(new Organizer().chaosScore(c) > 0); // 空槽错位 → 混乱度非 0
  const res = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res.ok, true);
  assert.equal(c.getItem(0)?.itemId, "minecraft:diamond"); // 物品归位到首位
  assert.equal(c.getItem(1), undefined);
  assert.equal(res.chaosAfter, 0); // 混乱度归 0
  // 已归位（混乱度 0）→ 再次整理为 no-op（不重复搬移）
  const res2 = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res2.chaosAfter, 0);
  assert.equal(c.getItem(0)?.itemId, "minecraft:diamond");
});

test("OrganizeService: 手动整理强制——低混乱度（>0 但 <0.05）也清空重排，仅归 0 才跳过", () => {
  const bus = new EventBus();
  const svc = new OrganizeService(new Organizer(), bus);
  const changed: string[] = [];
  bus.containerChanged.subscribe((e) => changed.push(e.containerId));
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map<string, InMemoryContainer>(),
    inputs: new Map<string, InMemoryContainer>(),
  };
  // 16 个不同种类 + 1 处相邻逆序（g/f 互换）→ 顺序分 1/15×0.7≈0.047（>0 且 <0.05，旧阈值会跳过）
  const c = new InMemoryContainer("c", "multi", 40);
  const types = "abcdefghijklmnop".split("").map((ch) => `minecraft:${ch}`);
  for (let i = 0; i < types.length; i++) c.setItem(i, new SimpleItemStack(types[i]!, 1, 64));
  c.setItem(5, new SimpleItemStack("minecraft:g", 1, 64)); // 第 6 个字母
  c.setItem(6, new SimpleItemStack("minecraft:f", 1, 64)); // 第 5 个字母（相邻逆序）
  const before = new Organizer().chaosScore(c);
  assert.ok(before > 0 && before < 0.05, `low messiness, got ${before}`);
  const res = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res.ok, true);
  // 强制整理：即使混乱度 < 0.05 也清空重排 → 槽位按序、chaosAfter=0、触发 container-changed
  assert.equal(c.getItem(5)?.itemId, "minecraft:f");
  assert.equal(c.getItem(6)?.itemId, "minecraft:g");
  assert.equal(res.chaosAfter, 0);
  assert.equal(changed.length, 1); // 强制执行（非跳过）
});

// 模拟生产适配器"清空槽位静默失败"（setItem(undefined) 被吞掉）→ 必须回滚而非重复物品
class FailingClearContainer extends InMemoryContainer {
  setItem(slot: number, item?: ItemStack): void {
    if (item === undefined) return; // 清空失败：不清除该槽
    super.setItem(slot, item);
  }
}

test("OrganizeService: 清空失败 → 回滚且不整理（数据一致性）", () => {
  const bus = new EventBus();
  const svc = new OrganizeService(new Organizer(), bus);
  const c = new FailingClearContainer("c1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(2, new SimpleItemStack("minecraft:stone", 5, 64));
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map([["c1", c]]),
    inputs: new Map<string, InMemoryContainer>(),
  };
  const res = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res.ok, false); // 清空校验失败 → 整体回滚
  assert.equal(c.getItem(0)?.amount, 10); // 回滚：恢复整理前
  assert.equal(c.getItem(2)?.amount, 5);
});
// ── 建仓限制（v1 沉淀：边界/间距/体积/每玩家数量） ─────────
test("areaSize: 归一化尺寸与体积", () => {
  const area: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 10, y: 10, z: 10 },
    corner2: { x: 0, y: 0, z: 0 },
  };
  const size = areaSize(area);
  assert.deepEqual(size, { x: 11, y: 11, z: 11, volume: 1331 });
});

test("areaExceedsLimits: 规格限制（任一轴边长超限）", () => {
  const small: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  };
  assert.equal(areaExceedsLimits(small, DEFAULT_WAREHOUSE_LIMITS), undefined);
  const long: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 100, y: 5, z: 5 },
  };
  assert.match(areaExceedsLimits(long, DEFAULT_WAREHOUSE_LIMITS) ?? "", /规格/);
});

test("areaTooClose: 间距不足判定", () => {
  const a: WarehouseArea = { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 10, y: 10, z: 10 } };
  const close: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 12, y: 0, z: 0 },
    corner2: { x: 15, y: 10, z: 10 },
  };
  const far: WarehouseArea = {
    dimension: "overworld",
    corner1: { x: 30, y: 0, z: 0 },
    corner2: { x: 40, y: 10, z: 10 },
  };
  assert.equal(areaTooClose(a, close, 4), true);
  assert.equal(areaTooClose(a, far, 4), false);
  assert.equal(areaTooClose(a, close, 0), false); // 零间距即仅重叠判定
});

test("createWarehouse: 超大区域被拒 / 过于接近被拒", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const ok = svc.createWarehouse("仓A", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  });
  assert.equal(ok.ok, true);
  const huge = svc.createWarehouse("仓B", "p1", {
    dimension: "overworld",
    corner1: { x: 100, y: 0, z: 0 },
    corner2: { x: 200, y: 10, z: 10 },
  });
  assert.equal(huge.ok, false);
  assert.match((huge as { error: string }).error, /规格/);
  const close = svc.createWarehouse("仓C", "p1", {
    dimension: "overworld",
    corner1: { x: 13, y: 0, z: 0 },
    corner2: { x: 18, y: 10, z: 10 },
  });
  assert.equal(close.ok, false);
  assert.match((close as { error: string }).error, /间距|接近/);
});

test("createWarehouse: 每玩家数量上限", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus(), {
    ...DEFAULT_WAREHOUSE_LIMITS,
    maxWarehousesPerPlayer: 2,
  });
  svc.createWarehouse("仓1", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  });
  svc.createWarehouse("仓2", "p2", {
    dimension: "overworld",
    corner1: { x: 50, y: 0, z: 0 },
    corner2: { x: 60, y: 10, z: 10 },
  }); // 不同玩家不受限
  svc.createWarehouse("仓3", "p1", {
    dimension: "overworld",
    corner1: { x: 100, y: 0, z: 0 },
    corner2: { x: 110, y: 10, z: 10 },
  }); // p1 第 2 个（达上限）
  const fourth = svc.createWarehouse("仓4", "p1", {
    dimension: "overworld",
    corner1: { x: 150, y: 0, z: 0 },
    corner2: { x: 160, y: 10, z: 10 },
  });
  assert.equal(fourth.ok, false);
  assert.match((fourth as { error: string }).error, /最多/);
});

test("WarehouseService: setLimits 运行时更新建仓限制（OPConfigUI/Phase 4 重应用）", () => {
  const svc = new WarehouseService(new InMemoryWarehouseStore(), new EventBus(), {
    ...DEFAULT_WAREHOUSE_LIMITS,
    maxWarehousesPerPlayer: 1,
  });
  svc.createWarehouse("仓A", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 0 },
    corner2: { x: 10, y: 10, z: 10 },
  });
  // 上限 1 → 第二个被拒
  const blocked = svc.createWarehouse("仓B", "p1", {
    dimension: "overworld",
    corner1: { x: 50, y: 0, z: 0 },
    corner2: { x: 60, y: 10, z: 10 },
  });
  assert.equal(blocked.ok, false);
  // 放宽上限 → 允许
  svc.setLimits({ maxWarehousesPerPlayer: 2 });
  const allowed = svc.createWarehouse("仓B", "p1", {
    dimension: "overworld",
    corner1: { x: 50, y: 0, z: 0 },
    corner2: { x: 60, y: 10, z: 10 },
  });
  assert.equal(allowed.ok, true);
  // 缩小规格限制 → 超限被拒（覆盖原限制而非叠加）
  svc.setLimits({ maxSpec: { x: 5, y: 5, z: 5 } });
  const oversized = svc.createWarehouse("仓C", "p2", {
    dimension: "overworld",
    corner1: { x: 100, y: 0, z: 0 },
    corner2: { x: 200, y: 10, z: 10 },
  });
  assert.equal(oversized.ok, false);
});

// ── 领域事件（集成测试可订阅观察） ──────────────────────
test("WarehouseService: 仓库 CRUD 触发领域事件", () => {
  const bus = new EventBus();
  const events: string[] = [];
  bus.warehouseCreated.subscribe((e) => events.push(`create:${e.warehouseId}:${e.displayName}`));
  bus.warehouseRenamed.subscribe((e) => events.push(`rename:${e.displayName}`));
  bus.warehouseDeleted.subscribe((e) => events.push(`delete:${e.warehouseId}`));
  const svc = new WarehouseService(new InMemoryWarehouseStore(), bus);
  const r = svc.createWarehouse("仓A", "p1", area1);
  if (!r.ok) return;
  svc.rename(r.warehouse, "新名");
  svc.deleteWarehouse(r.warehouse.id);
  assert.deepEqual(events, [`create:${r.warehouse.id}:仓A`, "rename:新名", `delete:${r.warehouse.id}`]);
});

test("WarehouseService: 删除事件在 meta 移除**前**触发（订阅者仍可读 cids/注册表做清理）", () => {
  const bus = new EventBus();
  const svc = new WarehouseService(new InMemoryWarehouseStore(), bus);
  const r = svc.createWarehouse("仓A", "p1", area1);
  if (!r.ok) return;
  let storeStillHasIt = false;
  // 订阅者（mc 层清索引/统计键）需要在该事件回调里读到仓库（cids 索引仍存在）
  bus.warehouseDeleted.subscribe((e) => {
    storeStillHasIt = svc.loadAll().some((w) => w.id === e.warehouseId);
  });
  svc.deleteWarehouse(r.warehouse.id);
  assert.equal(storeStillHasIt, true); // 事件先于 store.remove → 订阅者可枚举容器清理
  assert.equal(svc.loadAll().length, 0); // 最终 meta 已移除
});

test("WarehouseService: resize 迁移时 area-changed 事件在旧 meta 移除前触发（订阅者可迁移 cids）", () => {
  const bus = new EventBus();
  const svc = new WarehouseService(new InMemoryWarehouseStore(), bus);
  const r = svc.createWarehouse("仓A", "p1", area1);
  if (!r.ok) return;
  const oldId = r.warehouse.id;
  let newIdAtEvent: string | undefined;
  let oldMetaStillPresent = false;
  bus.warehouseAreaChanged.subscribe((e) => {
    newIdAtEvent = e.warehouseId;
    oldMetaStillPresent = svc.loadAll().some((w) => w.id === e.oldId);
  });
  const changed = svc.updateArea(r.warehouse, {
    dimension: "overworld",
    corner1: { x: 200, y: 0, z: 200 },
    corner2: { x: 210, y: 10, z: 210 },
  });
  assert.equal(changed, undefined);
  assert.equal(newIdAtEvent, r.warehouse.id); // 新 id 已在事件时可见
  assert.equal(oldMetaStillPresent, true); // 旧 meta 尚未移除 → 订阅者可迁移旧 cids 键
  assert.notEqual(r.warehouse.id, oldId);
});

test("OrganizeService: 整理成功触发 organize-completed", () => {
  const bus = new EventBus();
  const organizer = new Organizer();
  const svc = new OrganizeService(organizer, bus);
  const moves: number[] = [];
  bus.organizeCompleted.subscribe((e) => moves.push(e.moves));
  const c = new InMemoryContainer("c1", "multi", 4);
  c.setItem(0, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(2, new SimpleItemStack("minecraft:stone", 5, 64)); // 两堆 → 合并 1 组
  const warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: createDefaultSettings(),
    containers: new Map([["c1", c]]),
    inputs: new Map<string, InMemoryContainer>(),
  };
  const res = svc.organizeContainer(warehouse, c, new MoveJournal());
  assert.equal(res.ok, true);
  assert.equal(res.moves, 1);
  assert.deepEqual(moves, [1]); // organize-completed 报合并数
});

test("OrganizeService: organizeStandalone 就地整理但不发任何领域事件（背包整理用）", () => {
  const bus = new EventBus();
  const events: string[] = [];
  bus.containerChanged.subscribe((e) => events.push(`changed:${e.containerId}`));
  bus.organizeCompleted.subscribe((e) => events.push(`completed:${e.moves}`));
  const svc = new OrganizeService(new Organizer(), bus);

  const c = new InMemoryContainer("c1", "misc", 6);
  c.setItem(0, new SimpleItemStack("minecraft:dirt", 3, 64));
  c.setItem(2, new SimpleItemStack("minecraft:stone", 10, 64));
  c.setItem(4, new SimpleItemStack("minecraft:stone", 5, 64)); // 与槽2同型可合并
  const res = svc.organizeStandalone(c, new MoveJournal());

  assert.equal(res.ok, true);
  assert.equal(res.moves, 1); // 两堆 stone → 合并 1 组
  assert.deepEqual(events, []); // 无事件（背包不属于任何仓库）
  // 数量守恒 + 排序：dirt 在前、stone 合并为 15
  const items = [0, 1, 2, 3, 4, 5].map((i) => c.getItem(i)).filter((s) => s !== undefined);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.itemId, "minecraft:dirt");
  assert.equal(items[1]!.itemId, "minecraft:stone");
  assert.equal(items[1]!.amount, 15);
});
