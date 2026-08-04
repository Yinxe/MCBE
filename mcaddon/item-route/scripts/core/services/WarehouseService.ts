// ─── 仓库服务：CRUD/成员/设置（经 store 持久化） ──────────
import type { Warehouse, WarehouseArea, WarehouseSettings, MemberRole } from "../model/Warehouse";
import { createDefaultSettings } from "../model/Warehouse";
import type { PlayerId, WarehouseId } from "../model/types";
import type { WarehouseStore, WarehouseSnapshot } from "../storage/Stores";
import type { EventBus } from "../events/DomainEvents";

export type CreateResult = { ok: true; warehouse: Warehouse } | { ok: false; error: string };

/** 建仓限制（v1 沉淀：防超大区域拖垮扫描/刷仓） */
export interface WarehouseLimits {
  /** 单轴最大边长 */
  maxEdgeLength: number;
  /** 与其他仓库最小间距 */
  minSpacing: number;
  /** 最大体积（格数） */
  maxVolume: number;
  /** 每玩家最多仓库数 */
  maxWarehousesPerPlayer: number;
}

export const DEFAULT_WAREHOUSE_LIMITS: WarehouseLimits = {
  maxEdgeLength: 64,
  minSpacing: 4,
  maxVolume: 262_144,
  maxWarehousesPerPlayer: 8,
};

/** 区域尺寸（各轴归一化边长 + 体积） */
export function areaSize(area: WarehouseArea): { x: number; y: number; z: number; volume: number } {
  const x = Math.abs(area.corner1.x - area.corner2.x) + 1;
  const y = Math.abs(area.corner1.y - area.corner2.y) + 1;
  const z = Math.abs(area.corner1.z - area.corner2.z) + 1;
  return { x, y, z, volume: x * y * z };
}

/** 两区域是否过于接近（各自外扩 minSpacing 后相交） */
export function areaTooClose(a: WarehouseArea, b: WarehouseArea, minSpacing: number): boolean {
  if (a.dimension !== b.dimension) return false;
  const pad = Math.max(0, minSpacing - 1);
  const expanded: WarehouseArea = {
    dimension: a.dimension,
    corner1: {
      x: Math.min(a.corner1.x, a.corner2.x) - pad,
      y: Math.min(a.corner1.y, a.corner2.y) - pad,
      z: Math.min(a.corner1.z, a.corner2.z) - pad,
    },
    corner2: {
      x: Math.max(a.corner1.x, a.corner2.x) + pad,
      y: Math.max(a.corner1.y, a.corner2.y) + pad,
      z: Math.max(a.corner1.z, a.corner2.z) + pad,
    },
  };
  return areaOverlaps(expanded, b);
}

/** 区域是否超限；超限返回中文错误消息，否则 undefined */
export function areaExceedsLimits(area: WarehouseArea, limits: WarehouseLimits): string | undefined {
  const size = areaSize(area);
  if (size.x > limits.maxEdgeLength || size.y > limits.maxEdgeLength || size.z > limits.maxEdgeLength) {
    return `区域单轴边长超限（最大 ${limits.maxEdgeLength} 格）`;
  }
  if (size.volume > limits.maxVolume) {
    return `区域体积超限（最大 ${limits.maxVolume} 格）`;
  }
  return undefined;
}

export class WarehouseService {
  constructor(
    private readonly store: WarehouseStore,
    private readonly bus: EventBus,
    private readonly limits: WarehouseLimits = DEFAULT_WAREHOUSE_LIMITS
  ) {}

  /** 启动加载全部仓库（容器由 mc 层按 containerIds 补注册） */
  loadAll(): Warehouse[] {
    return this.store.list().map((s) => this.buildWarehouse(s));
  }

  createWarehouse(displayName: string, ownerId: PlayerId, area: WarehouseArea): CreateResult {
    const name = displayName.trim();
    if (name.length === 0) return { ok: false, error: "仓库名不能为空" };
    const sizeLimitError = areaExceedsLimits(area, this.limits);
    if (sizeLimitError !== undefined) return { ok: false, error: sizeLimitError };
    const existing = this.store.list();
    if (existing.some((w) => w.displayName === name)) {
      return { ok: false, error: "存在同名仓库" };
    }
    if (existing.some((w) => areaOverlaps(w.area, area))) {
      return { ok: false, error: "区域与已有仓库重叠" };
    }
    if (existing.some((w) => areaTooClose(w.area, area, this.limits.minSpacing))) {
      return { ok: false, error: `区域与其他仓库过于接近（最小间距 ${this.limits.minSpacing} 格）` };
    }
    const ownedCount = existing.filter((w) => w.ownerId === ownerId).length;
    if (ownedCount >= this.limits.maxWarehousesPerPlayer) {
      return { ok: false, error: `每个玩家最多创建 ${this.limits.maxWarehousesPerPlayer} 个仓库` };
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

  /** 调整仓库区域（resize 命令）：改区域并持久化 */
  updateArea(warehouse: Warehouse, area: WarehouseArea): void {
    warehouse.area = { ...area };
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