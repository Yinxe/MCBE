// 同族 + 黑白名单：边界与可能场景测试（对准机制的正确性）
// 覆盖：族路由边界（无族/显式物化/多族成员/清空自愈/排序/角色变更/旧档缺省）、
//       白名单限定（收紧实含类型/声明式预分配/空白名单不限）、
//       黑名单优先于白名单、Router 不越权处理仓库黑名单。
import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../scripts/core/routing/Router";
import {
  SingleItemStrategy,
  MultiItemStrategy,
  FamilyStrategy,
  MiscStrategy,
} from "../scripts/core/routing/RouteStrategy";
import { admission, AdmissionInterceptor } from "../scripts/core/routing/Admission";
import { DefaultCandidateSorter } from "../scripts/core/routing/CandidateSorter";
import { ItemIndex } from "../scripts/core/index/ItemIndex";
import { EventBus } from "../scripts/core/events/DomainEvents";
import { InMemoryContainer } from "./helpers/InMemoryContainer";
import { SimpleItemStack } from "../scripts/core/model/ItemStack";
import {
  createDefaultSettings,
  isFamilyEnabled,
  type Warehouse,
} from "../scripts/core/model/Warehouse";
import { ITEM_FAMILIES, familyOf, DEFAULT_ENABLED_FAMILIES } from "../scripts/core/data/item-families";

function makeWorld() {
  const containers = new Map<string, InMemoryContainer>();
  const index = new ItemIndex();
  const warehouse: Warehouse = {
    id: "w1",
    displayName: "w",
    ownerName: "p1",
    members: [],
    area: { dimension: "overworld", corner1: { x: 0, y: 0, z: 0 }, corner2: { x: 5, y: 5, z: 5 } },
    settings: { ...createDefaultSettings(), enabledFamilies: ITEM_FAMILIES.map((f) => f.id) }, // 机制测试默认全族启用
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

function r(id: string, amount: number): SimpleItemStack {
  return new SimpleItemStack(id, amount, 64);
}

function makeFamBox(id = "mF"): InMemoryContainer {
  const c = new InMemoryContainer(id, "multi", 4);
  c.familyEnabled = true;
  return c;
}

// ── 准入（Admission）拦截器边界 ─────────────────────────────
test("admission: 黑名单优先——白名单是允许非限定，黑名单命中才拒", () => {
  const c = new InMemoryContainer("m1", "multi", 3);
  c.whitelist = ["minecraft:redstone"];
  c.blacklist = ["minecraft:redstone"];
  assert.equal(admission.accepts(c, "minecraft:redstone"), false); // 黑名单拦截一票否决（即使白名单含）
  c.blacklist = [];
  assert.equal(admission.accepts(c, "minecraft:redstone"), true); // 白名单含 → 允许
  // 白名单是"允许"非"限定"：未白名单物品也不被白名单拒绝（仅黑名单拒）
  assert.equal(admission.accepts(c, "minecraft:stone"), true);
});

// ── 白名单 = 允许（加法，不收紧）────────────────────────────
test("白名单 = 允许非限定：多物箱白名单 stone 仍收实装 dirt + 预分配 stone", () => {
  const w = makeWorld();
  const box = new InMemoryContainer("m1", "multi", 3);
  box.whitelist = ["minecraft:stone"]; // 声明允许 stone（即使空槽也能进）
  box.setItem(0, r("minecraft:dirt", 4)); // 实含 dirt（索引候选）
  w.add(box);
  // dirt（实装内容）照常收——白名单不收紧实装类型
  const resDirt = w.route(r("minecraft:dirt", 5));
  assert.equal(resDirt?.to, "m1");
  assert.equal(box.getItem(0)?.amount, 9);
  // stone（白名单声明、空槽）→ 预分配收
  const resStone = w.route(r("minecraft:stone", 3));
  assert.equal(resStone?.to, "m1");
  assert.equal(box.getItem(1)?.itemId, "minecraft:stone");
});

test("白名单 = 允许式（缺省）不影响未白名单容器：普通多物箱照常收同型", () => {
  const w = makeWorld();
  const box = new InMemoryContainer("m1", "multi", 3);
  box.setItem(0, r("minecraft:stone", 5)); // whitelist 默认空 = 不限
  w.add(box);
  const res = w.route(r("minecraft:stone", 10));
  assert.equal(res?.to, "m1");
  assert.equal(box.getItem(0)?.amount, 15);
});

// ── 族路由边界 ─────────────────────────────────────────
test("族路由：物品不在任何族（bedrock 被精简剔除）→ 无族候选直落 misc", () => {
  assert.equal(familyOf("minecraft:bedrock"), undefined); // 精简后 bedrock 无族归属
  const w = makeWorld();
  const famBox = makeFamBox("mF");
  famBox.setItem(0, r("minecraft:white_wool", 5)); // 羊毛族桶（与 bedrock 无关）
  w.add(famBox);
  const other = new InMemoryContainer("m1", "multi", 3);
  other.setItem(0, r("minecraft:bedrock", 2)); // 装 bedrock 的普通多物箱（含 bedrock → 索引候选）
  w.add(other);
  const out = new InMemoryContainer("x1", "misc", 3);
  w.add(out);
  const res = w.route(r("minecraft:bedrock", 7));
  assert.equal(res?.to, "m1"); // 多物有 bedrock 实箱 → 走多物（不落族，也不落 misc）
});

test("启用族类：默认启用 DEFAULT_ENABLED_FAMILIES；空数组=全关（旧档缺省）", () => {
  const s = createDefaultSettings();
  // 新默认：常用族默认启用（羊毛/地毯等）
  assert.equal(isFamilyEnabled(s, "wool"), true);
  assert.equal(isFamilyEnabled(s, "carpet"), true);
  // 非默认族（如头颅 heads）默认关
  assert.equal(isFamilyEnabled(s, "heads"), false);
  // 旧档缺省语义：显式空数组 = 全关
  s.enabledFamilies = [];
  assert.equal(isFamilyEnabled(s, "wool"), false);
  s.enabledFamilies = ["wool"];
  assert.equal(isFamilyEnabled(s, "wool"), true);
  assert.equal(isFamilyEnabled(s, "carpet"), false); // 未写入 → 关
});

test("DEFAULT_ENABLED_FAMILIES：每个 id 都是真实存在的族，无重复", () => {
  const ids = ITEM_FAMILIES.map((f) => f.id);
  const defaultIds = DEFAULT_ENABLED_FAMILIES;
  assert.ok(defaultIds.length > 0);
  assert.equal(new Set(defaultIds).size, defaultIds.length, "默认清单不应有重复族");
  for (const id of defaultIds) {
    assert.ok(ids.includes(id), `默认清单含不存在族 ${id}`);
  }
});

test("同族多候选按优先级排序（priority 小者先）", () => {
  const w = makeWorld();
  const fa = makeFamBox("fa");
  fa.priority = 5;
  fa.setItem(0, r("minecraft:white_wool", 5));
  w.add(fa);
  const fb = makeFamBox("fb");
  fb.priority = 15;
  fb.setItem(0, r("minecraft:red_wool", 5));
  w.add(fb);
  const res = w.route(r("minecraft:orange_wool", 10));
  assert.equal(res?.to, "fa"); // 优先级 5 先收
});

test("族容器装两族成员（羊毛+地毯）→ 落两个族桶，各收各自族内新成员", () => {
  const w = makeWorld();
  const box = makeFamBox("mF");
  box.setItem(0, r("minecraft:white_wool", 5));
  box.setItem(1, r("minecraft:white_carpet", 5));
  w.add(box);
  assert.deepEqual(w.index.lookupFamily("wool"), ["mF"]);
  assert.deepEqual(w.index.lookupFamily("carpet"), ["mF"]);
  // 地毯族新色 → 仍入族箱
  const res = w.route(r("minecraft:red_carpet", 6));
  assert.equal(res?.to, "mF");
  assert.equal(box.getItem(2)?.itemId, "minecraft:red_carpet");
});

test("族箱内容清空（reconcile 漂移自愈）→ 族桶移除，后续同族不再收", () => {
  const w = makeWorld();
  const box = makeFamBox("mF");
  box.setItem(0, r("minecraft:white_wool", 5));
  w.add(box);
  assert.deepEqual(w.index.lookupFamily("wool"), ["mF"]);
  box.setItem(0, undefined); // 玩家清空（无事件）
  w.index.reconcile(box); // 三层兜底：按真实内容重建 → 族桶移除
  assert.deepEqual(w.index.lookupFamily("wool"), []);
  const out = new InMemoryContainer("x1", "misc", 3);
  w.add(out);
  const res = w.route(r("minecraft:orange_wool", 4));
  assert.equal(res?.to, "x1"); // 不再被空族箱族收，落 misc
});

test("多物→单物角色变更 → 清族桶（familyEnabled 仅多物有意义）", () => {
  const w = makeWorld();
  const box = makeFamBox("mF");
  box.setItem(0, r("minecraft:white_wool", 5));
  w.add(box);
  assert.deepEqual(w.index.lookupFamily("wool"), ["mF"]);
  box.role = "single";
  w.index.onContainerRoleChanged(box, "multi");
  assert.deepEqual(w.index.lookupFamily("wool"), []);
});

// ── 族桶恢复（旧档缺省）────────────────────────────
test("restoreFromEntries 旧档缺 familyEnabled → 默认关，不入族桶", () => {
  const index = new ItemIndex();
  const c = new InMemoryContainer("m", "multi", 3);
  c.familyEnabled = false; // 旧档缺字段 → 载入默认为 false
  c.setItem(0, r("minecraft:white_wool", 5));
  assert.equal(
    index.restoreFromEntries(new Map([[c.id, { items: ["minecraft:white_wool"] }]]), [c]),
    true
  );
  assert.deepEqual(index.lookupFamily("wool"), []); // 未启族 → 不入族桶
});

// ── 白名单声明式 × 同族 ─────────────────────────────
test("白名单声明：EMP队列族箱白名单含某族成员 → 空箱也能收（经多物层白名单）", () => {
  const w = makeWorld();
  const box = makeFamBox("mF");
  box.whitelist = ["minecraft:orange_wool"]; // 空箱 whitelist 声明要橙羊毛
  w.add(box); // 无内容 → 不在族桶，亦无索引
  const res = w.route(r("minecraft:orange_wool", 8));
  assert.equal(res?.to, "mF");
  assert.equal(box.getItem(0)?.itemId, "minecraft:orange_wool");
});

// ── Router 不越权仓库黑名单 ───────────────────────────
test("Router 不处理仓库黑名单（那是 Scheduler 职责）——路由照常进行", () => {
  const w = makeWorld();
  w.warehouse.settings.blacklist = ["minecraft:stone"]; // 仓库黑名单 stone
  const box = new InMemoryContainer("m1", "multi", 3);
  box.setItem(0, r("minecraft:stone", 5));
  w.add(box);
  // 若 Router 也拦，stone 将无处可去；正确地，仓库黑名单只在 Scheduler.processOnce 拦截
  const res = w.route(r("minecraft:stone", 10));
  assert.equal(res?.to, "m1");
});
// ── 族箱满态兜底 ───────────────────────────────────────
test("族候选满箱（无空槽放新色）→ 转移失败跳过 → 降级 misc", () => {
  const w = makeWorld();
  const full = new InMemoryContainer("full", "multi", 1);
  full.familyEnabled = true;
  full.setItem(0, r("minecraft:white_wool", 64)); // 满、无空槽
  w.containers.set(full.id, full);
  w.index.onContainerAdded(full); // 白色 → 羊毛族桶
  const out = new InMemoryContainer("x1", "misc", 3);
  w.add(out);
  const res = w.route(r("minecraft:orange_wool", 6));
  assert.equal(res?.to, "x1"); // 满箱放不下新色 → 跳过 → 落杂项
  assert.equal(full.getItem(0)?.amount, 64); // 满箱原样
});

// ── 空值防护（旧档缺新字段不崩）────────────────────────────
test("isFamilyEnabled 旧档缺 enabledFamilies → 空=全关，不崩", () => {
  const s = { routingEnabled: true } as unknown as Parameters<typeof isFamilyEnabled>[0]; // 无 enabledFamilies
  assert.equal(isFamilyEnabled(s, "wool"), false); // 缺字段 → 空 = 全关
});

test("admission.accepts 容器缺 blacklist/whitelist（旧数据）→ 不崩", () => {
  const c = { id: "m1", blacklist: undefined, whitelist: undefined } as never;
  assert.equal(admission.accepts(c as never, "minecraft:stone"), true); // 无黑名单 → 收
});

test("白名单空箱（有配置）→ 允许进入（允许式，缺物也能进）", () => {
  const w = makeWorld();
  const box = new InMemoryContainer("m1", "multi", 3);
  box.whitelist = ["minecraft:stone"]; // 空箱白名单配置 stone
  w.add(box);
  const res = w.route(r("minecraft:stone", 7));
  assert.equal(res?.to, "m1"); // 空箱 + 白名单 → 能进（容器准入不拦截 + 白名单声明候选）
  assert.equal(box.getItem(0)?.itemId, "minecraft:stone");
});

// ── 工作方块族：村民职业台 + 通用工作/存储方块 ──────────
test("workstations 族：村民职业方块 + 箱子/熔炉/工作台齐全", () => {
  const w = ITEM_FAMILIES.find((f) => f.id === "workstations");
  assert.ok(w !== undefined);
  // 通用工作台
  for (const id of [
    "minecraft:crafting_table",
    "minecraft:furnace",
    "minecraft:chest",
    "minecraft:barrel",
    "minecraft:composter",
  ]) {
    assert.equal(familyOf(id), "workstations", `${id} 应属工作方块`);
  }
  // 村民职业方块
  for (const id of [
    "minecraft:blast_furnace",
    "minecraft:smoker",
    "minecraft:smithing_table",
    "minecraft:grindstone",
    "minecraft:cartography_table",
    "minecraft:fletching_table",
    "minecraft:lectern",
    "minecraft:loom",
  ]) {
    assert.equal(familyOf(id), "workstations", `${id} 应属工作方块`);
  }
  // 酿造台/炼药锅从 tools 移出，归工作方块（村民职业）
  assert.equal(familyOf("minecraft:brewing_stand"), "workstations");
  assert.equal(familyOf("minecraft:cauldron"), "workstations");
});

test("tools 拆分：镐/铲/斧归 mining_tools，锄等留 tools", () => {
  assert.equal(familyOf("minecraft:copper_pickaxe"), "mining_tools");
  assert.equal(familyOf("minecraft:iron_axe"), "mining_tools");
  assert.equal(familyOf("minecraft:golden_shovel"), "mining_tools");
  assert.equal(familyOf("minecraft:diamond_hoe"), "tools");
  assert.equal(familyOf("minecraft:shears"), "tools");
});

test("光源/植物边界：火把灯笼归光源，海泡菜发光地衣归植物", () => {
  assert.equal(familyOf("minecraft:torch"), "light_sources");
  assert.equal(familyOf("minecraft:lantern"), "light_sources");
  assert.equal(familyOf("minecraft:sea_pickle"), "plants");
  assert.equal(familyOf("minecraft:glow_lichen"), "plants");
});

test("下界/植物/海龟边界：nether 更名下界方块，海龟掉落入友好，种子回作物", () => {
  const nether = ITEM_FAMILIES.find((f) => f.id === "nether");
  assert.ok(nether !== undefined);
  assert.equal(nether.displayName, "下界方块");
  assert.equal(familyOf("minecraft:blackstone"), "nether");
  assert.equal(familyOf("minecraft:glowstone"), "light_sources"); // 萤石出下界进光源
  assert.equal(familyOf("minecraft:turtle_helmet"), "friendly_drops");
  assert.equal(familyOf("minecraft:sea_pickle"), "plants");
});
