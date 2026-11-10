import { test } from "node:test";
import assert from "node:assert/strict";
import { areaFromPoints, handleCornerClick } from "../scripts/mc/interaction/interactionLogic";
import { SelectionSessionStore } from "../scripts/mc/interaction/SelectionSessionStore";
import { WarehouseService } from "../scripts/core/services/WarehouseService";
import { warehouseIdOf } from "../scripts/core/model/ContainerId";
import { InMemoryWarehouseStore } from "../scripts/core/storage/Stores";
import { EventBus } from "../scripts/core/events/DomainEvents";

function makeCtx() {
  const warehouses = new WarehouseService(new InMemoryWarehouseStore(), new EventBus());
  const session = new SelectionSessionStore();
  const bus = new EventBus();
  return {
    warehouses,
    session,
    bus,
    resolveWarehouse: (id: string) => warehouses.loadAll().find((w) => w.id === id ?? "") ?? undefined,
  };
}

test("areaFromPoints: 两点归一化为区域（乱序纠正）", () => {
  const area = areaFromPoints("overworld", { x: 10, y: 0, z: 20 }, { x: 0, y: 10, z: 5 });
  assert.deepEqual(area, {
    dimension: "overworld",
    corner1: { x: 0, y: 0, z: 5 },
    corner2: { x: 10, y: 10, z: 20 },
  });
});

test("handleCornerClick: 无会话返回空；首选角点记录 corner1", () => {
  const ctx = makeCtx();
  assert.equal(handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld"), "");
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "single", defaultEnabled: true });
  const msg = handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  assert.match(msg, /第一个对角点/);
  assert.deepEqual(ctx.session.get("p1")?.corner1, { x: 0, y: 64, z: 0 });
});

test("handleCornerClick: 两个对角点完成建仓", () => {
  const ctx = makeCtx();
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "single", defaultEnabled: true });
  handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  const msg = handleCornerClick(ctx, "p1", { x: 10, y: 70, z: 10 }, "overworld");
  assert.match(msg, /创建成功/);
  assert.equal(ctx.session.get("p1"), undefined); // 会话清除
  const created = ctx.warehouses.loadAll();
  assert.equal(created.length, 1);
  assert.equal(created[0]?.displayName, "仓A");
});

test("handleCornerClick: 同名仓库建仓被拒（中文错误）且会话被清除（流程结束）", () => {
  const ctx = makeCtx();
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "single", defaultEnabled: true });
  handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  handleCornerClick(ctx, "p1", { x: 10, y: 70, z: 10 }, "overworld"); // 建第一个
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓A", defaultRole: "single", defaultEnabled: true });
  handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  const msg = handleCornerClick(ctx, "p1", { x: 20, y: 74, z: 20 }, "overworld");
  assert.match(msg, /同名/);
  assert.equal(ctx.session.get("p1"), undefined); // 失败 → 会话结束（不再滞留选点模式）
});

test("handleCornerClick: 建仓失败（规格/数量等）→ 会话清除，流程结束", () => {
  const ctx = makeCtx();
  // 通过 setLimits 收紧建仓限制，制造必然失败
  ctx.warehouses.setLimits({ maxSpec: { x: 8, y: 8, z: 8 } });
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓大", defaultRole: "single", defaultEnabled: true });
  handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  const msg = handleCornerClick(ctx, "p1", { x: 30, y: 70, z: 30 }, "overworld"); // 超规格 → 拒
  assert.match(msg, /规格/);
  assert.equal(ctx.session.get("p1"), undefined); // 失败 → 会话结束
});

test("handleCornerClick: 调区失败（重叠）→ 会话清除，流程结束", () => {
  const ctx = makeCtx();
  const a = ctx.warehouses.createWarehouse("仓A", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 60, z: 0 },
    corner2: { x: 5, y: 64, z: 5 },
  });
  ctx.warehouses.createWarehouse("仓B", "p1", {
    dimension: "overworld",
    corner1: { x: 100, y: 60, z: 100 },
    corner2: { x: 105, y: 64, z: 105 },
  });
  if (!a.ok) throw new Error("建仓失败");
  ctx.session.set("p1", { kind: "resizeWarehouse", warehouseId: a.warehouse.id });
  handleCornerClick(ctx, "p1", { x: 98, y: 61, z: 98 }, "overworld");
  const msg = handleCornerClick(ctx, "p1", { x: 110, y: 70, z: 110 }, "overworld"); // 与 B 重叠 → 拒
  assert.match(msg, /重叠/);
  assert.equal(ctx.session.get("p1"), undefined); // 失败 → 会话结束
});

test("handleCornerClick: resize 调整区域（仓库 ID 随区域重算迁移）", () => {
  const ctx = makeCtx();
  const created = ctx.warehouses.createWarehouse("仓A", "p1", {
    dimension: "overworld",
    corner1: { x: 0, y: 60, z: 0 },
    corner2: { x: 5, y: 64, z: 5 },
  });
  if (!created.ok) throw new Error("建仓失败");
  const oldId = created.warehouse.id;
  ctx.session.set("p1", { kind: "resizeWarehouse", warehouseId: oldId });
  handleCornerClick(ctx, "p1", { x: 1, y: 61, z: 1 }, "overworld");
  const msg = handleCornerClick(ctx, "p1", { x: 9, y: 70, z: 9 }, "overworld");
  assert.match(msg, /已调整/);
  // 区域变化 → 仓库 ID 重算（w@(min)-(max)@dim），旧 id 不再存在
  const newId = warehouseIdOf({
    dimension: "overworld",
    corner1: { x: 1, y: 61, z: 1 },
    corner2: { x: 9, y: 70, z: 9 },
  });
  assert.notEqual(newId, oldId);
  const wh = ctx.warehouses.loadAll().find((w) => w.id === newId);
  assert.equal(wh !== undefined, true);
  assert.deepEqual(wh?.area.corner1, { x: 1, y: 61, z: 1 });
});
test("handleCornerClick: 建仓完成触发 boundary-glow 视觉事件", () => {
  const ctx = makeCtx();
  const glows: string[] = [];
  ctx.bus.visualEffect.subscribe((e) => glows.push(`${e.kind}:${e.warehouseId}`));
  ctx.session.set("p1", { kind: "createWarehouse", name: "仓B", defaultRole: "single", defaultEnabled: true });
  handleCornerClick(ctx, "p1", { x: 0, y: 64, z: 0 }, "overworld");
  handleCornerClick(ctx, "p1", { x: 5, y: 70, z: 5 }, "overworld");
  assert.equal(glows.length, 1);
  assert.match(glows[0] ?? "", /^boundary-glow:/);
});
