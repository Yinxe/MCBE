// ─── 仓库服务：CRUD/成员/设置（经 store 持久化） ──────────
import type { Warehouse, WarehouseArea, WarehouseSettings, MemberRole } from "../model/Warehouse";
import { createDefaultSettings } from "../model/Warehouse";
import type { PlayerId, WarehouseId } from "../model/types";
import type { WarehouseStore, WarehouseSnapshot } from "../storage/Stores";
import type { EventBus } from "../events/DomainEvents";

export type CreateResult = { ok: true; warehouse: Warehouse } | { ok: false; error: string };

export class WarehouseService {
  constructor(
    private readonly store: WarehouseStore,
    private readonly bus: EventBus
  ) {}

  /** 启动加载全部仓库（容器由 mc 层按 containerIds 补注册） */
  loadAll(): Warehouse[] {
    return this.store.list().map((s) => this.buildWarehouse(s));
  }

  createWarehouse(displayName: string, ownerId: PlayerId, area: WarehouseArea): CreateResult {
    const name = displayName.trim();
    if (name.length === 0) return { ok: false, error: "仓库名不能为空" };
    const existing = this.store.list();
    if (existing.some((w) => w.displayName === name)) {
      return { ok: false, error: "存在同名仓库" };
    }
    if (existing.some((w) => areaOverlaps(w.area, area))) {
      return { ok: false, error: "区域与已有仓库重叠" };
    }
    const warehouse: Warehouse = {
      id: `wh-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      displayName: name,
      ownerId,
      members: [{ playerId: ownerId, role: "owner" }],
      area,
      settings: createDefaultSettings(),
      containers: new Map(),
    };
    this.persist(warehouse);
    return { ok: true, warehouse };
  }

  deleteWarehouse(id: WarehouseId): void {
    this.store.remove(id);
  }

  rename(warehouse: Warehouse, newName: string): string | undefined {
    const name = newName.trim();
    if (name.length === 0) return "仓库名不能为空";
    if (this.store.list().some((w) => w.id !== warehouse.id && w.displayName === name)) {
      return "存在同名仓库";
    }
    warehouse.displayName = name;
    this.persist(warehouse);
    return undefined;
  }

  addMember(warehouse: Warehouse, playerId: PlayerId, role: MemberRole): string | undefined {
    if (role === "owner") return "owner 只能通过转让设置";
    if (warehouse.members.some((m) => m.playerId === playerId)) return "该玩家已是成员";
    warehouse.members.push({ playerId, role });
    this.persist(warehouse);
    return undefined;
  }

  setMemberRole(warehouse: Warehouse, playerId: PlayerId, role: MemberRole): string | undefined {
    if (playerId === warehouse.ownerId) return "不能修改 owner 的角色";
    const member = warehouse.members.find((m) => m.playerId === playerId);
    if (!member) return "该玩家不是成员";
    member.role = role;
    this.persist(warehouse);
    return undefined;
  }

  removeMember(warehouse: Warehouse, playerId: PlayerId): string | undefined {
    if (playerId === warehouse.ownerId) return "不能移除 owner";
    const before = warehouse.members.length;
    warehouse.members = warehouse.members.filter((m) => m.playerId !== playerId);
    if (warehouse.members.length === before) return "该玩家不是成员";
    this.persist(warehouse);
    return undefined;
  }

  updateSettings(warehouse: Warehouse, patch: Partial<WarehouseSettings>): void {
    warehouse.settings = { ...warehouse.settings, ...patch };
    this.persist(warehouse);
  }

  persist(warehouse: Warehouse): void {
    this.store.save(this.toSnapshot(warehouse));
  }

  // ── 私有方法 ───────────────────────────────────────────
  private toSnapshot(warehouse: Warehouse): WarehouseSnapshot {
    return {
      id: warehouse.id,
      displayName: warehouse.displayName,
      ownerId: warehouse.ownerId,
      members: warehouse.members.map((m) => ({ ...m })),
      area: { ...warehouse.area },
      settings: { ...warehouse.settings },
      containerIds: [...warehouse.containers.keys()],
    };
  }

  private buildWarehouse(snapshot: WarehouseSnapshot): Warehouse {
    return {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerId: snapshot.ownerId,
      members: snapshot.members.map((m) => ({ ...m })),
      area: { ...snapshot.area },
      settings: { ...snapshot.settings },
      containers: new Map(),
    };
  }
}

/** 区域相交判定（同维度且三轴区间均重叠） */
export function areaOverlaps(a: WarehouseArea, b: WarehouseArea): boolean {
  if (a.dimension !== b.dimension) return false;
  const axes = ["x", "y", "z"] as const;
  return axes.every((axis) => {
    const amin = Math.min(a.corner1[axis], a.corner2[axis]);
    const amax = Math.max(a.corner1[axis], a.corner2[axis]);
    const bmin = Math.min(b.corner1[axis], b.corner2[axis]);
    const bmax = Math.max(b.corner1[axis], b.corner2[axis]);
    return amin <= bmax && bmin <= amax;
  });
}