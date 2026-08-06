// ─── 仓库服务：CRUD/成员/设置/建仓限制（经 store 持久化） ──
// 仓库生命周期管理中枢。`loadAll()` 返回的 Warehouse 仅含元数据与空容器表
// （容器适配器由 mc 层按 containerIds 重建/事件注册，见 main.ts Phase 4）。
//
// 建仓限制（v1 沉淀，`WarehouseLimits` 构造注入）：
//   · 单轴边长 ≤ maxEdgeLength、体积 ≤ maxVolume —— 防超大区域拖垮扫描
//   · 与其他仓库间距 ≥ minSpacing（areaTooClose：外扩后相交判定）
//   · 每玩家仓库数 ≤ maxWarehousesPerPlayer —— 防刷仓
// 以上任一不满足 → 返回中文错误（CreateResult.ok=false）。
import type { Warehouse, WarehouseArea, WarehouseSettings, MemberRole } from "../model/Warehouse";
import { createDefaultSettings } from "../model/Warehouse";
import type { ContainerRole } from "../model/Container";
import type { PlayerName, WarehouseId } from "../model/types";
import type { WarehouseStore, WarehouseSnapshot } from "../storage/Stores";
import type { EventBus } from "../events/DomainEvents";
import { warehouseIdOf } from "../model/ContainerId";

export type CreateResult = { ok: true; warehouse: Warehouse } | { ok: false; error: string };

/** 仓库规格：各轴最大边长（v1 口径——用**规格限制**而非体积格数，如 32×16×32） */
export interface WarehouseSpec {
  x: number;
  y: number;
  z: number;
}

/** 建仓限制（v1 沉淀：防超大区域拖垮扫描/刷仓） */
export interface WarehouseLimits {
  /** 最大仓库规格（各轴最大边长；**任一轴超限即拒绝**，不按体积计） */
  maxSpec: WarehouseSpec;
  /** 与其他仓库最小间距 */
  minSpacing: number;
  /** 每玩家最多仓库数 */
  maxWarehousesPerPlayer: number;
}

export const DEFAULT_WAREHOUSE_LIMITS: WarehouseLimits = {
  maxSpec: { x: 32, y: 16, z: 32 },
  minSpacing: 4,
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

/** 区域是否超限（任一轴边长 > 规格对应最大值）；超限返回中文错误消息，否则 undefined */
export function areaExceedsLimits(area: WarehouseArea, limits: WarehouseLimits): string | undefined {
  const size = areaSize(area);
  const spec = limits.maxSpec;
  if (size.x > spec.x || size.y > spec.y || size.z > spec.z) {
    return `区域规格超限（最大 ${spec.x}×${spec.y}×${spec.z} 格/轴）`;
  }
  return undefined;
}

/**
 * 仓库服务：仓库 CRUD / 成员 / 设置 / 建仓限制，是仓库生命周期管理中枢。
 * 所有写操作经 store 持久化并触发领域事件（mc 层订阅做内存/存储副作用，见 events/Subscriptions.ts）。
 * `loadAll()` 返回的 Warehouse 仅含元数据与空容器表（容器适配器由 mc 层按需加载，见 WarehouseLoader）。
 * 实例化时注入 { store, bus, limits }，可测（InMemoryStore + 假 bus）。
 */
export class WarehouseService {
  constructor(
    private readonly store: WarehouseStore,
    private readonly bus: EventBus,
    private limits: WarehouseLimits = DEFAULT_WAREHOUSE_LIMITS
  ) {}

  /** 启动加载全部仓库（容器由 mc 层按 containerIds 补注册） */
  loadAll(): Warehouse[] {
    return this.store.list().map((s) => this.buildWarehouse(s));
  }

  /**
   * 运行时更新建仓限制（ConfigUI 改 maxVolume/maxWarehousesPerPlayer 后调用）。
   * Phase 4 config.refresh() 读持久化值后也应重应用——服务在 Phase 2 用 config 默认值构造，
   * 持久化值须刷新后覆盖（否则启动后建仓仍按默认值校验）。
   */
  setLimits(partial: Partial<WarehouseLimits>): void {
    this.limits = { ...this.limits, ...partial };
  }

  /**
   * 创建仓库：跑全部建仓限制（名非空/超限/同名/重叠/间距/每玩家上限），
   * 通过则落 meta 并触发 warehouse-created（mc 层激活/扫描容器）。可选 defaults 覆盖默认容器角色/启用。
   * 返回 discriminated union：`{ok:true, warehouse}` 或 `{ok:false, error}`（中文错误，调用方可直接播报）。
   */
  createWarehouse(
    displayName: string,
    ownerName: PlayerName,
    area: WarehouseArea,
    defaults?: { role: ContainerRole; enabled: boolean }
  ): CreateResult {
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
    const ownedCount = existing.filter((w) => w.ownerName === ownerName).length;
    if (ownedCount >= this.limits.maxWarehousesPerPlayer) {
      return { ok: false, error: `每个玩家最多创建 ${this.limits.maxWarehousesPerPlayer} 个仓库` };
    }
    const settings = createDefaultSettings();
    if (defaults !== undefined) {
      settings.defaultContainerRole = defaults.role;
      settings.defaultContainerEnabled = defaults.enabled;
    }
    const warehouse: Warehouse = {
      id: warehouseIdOf(area),
      displayName: name,
      ownerName,
      members: [{ playerName: ownerName, role: "owner" }],
      area,
      settings,
      containers: new Map(),
      inputs: new Map(),
    };
    this.persist(warehouse);
    this.bus.warehouseCreated.trigger({ type: "warehouse-created", warehouseId: warehouse.id, displayName: name });
    return { ok: true, warehouse };
  }

  /** 删除仓库：清 meta/注册表键（store.remove），并触发 warehouse-deleted（mc 层清索引/统计键 + 停调度） */
  deleteWarehouse(id: WarehouseId): void {
    this.store.remove(id);
    this.bus.warehouseDeleted.trigger({ type: "warehouse-deleted", warehouseId: id });
  }

  /** 改名：非空 + 全局唯一；成功落 meta + 触发 warehouse-renamed；失败返回中文错误 */
  rename(warehouse: Warehouse, newName: string): string | undefined {
    const name = newName.trim();
    if (name.length === 0) return "仓库名不能为空";
    if (this.store.list().some((w) => w.id !== warehouse.id && w.displayName === name)) {
      return "存在同名仓库";
    }
    warehouse.displayName = name;
    this.persist(warehouse);
    this.bus.warehouseRenamed.trigger({ type: "warehouse-renamed", warehouseId: warehouse.id, displayName: name });
    return undefined;
  }

  /** 添加成员：owner 只能通过转让设置（拒绝重复）；成功落盘，失败返回中文错误 */
  addMember(warehouse: Warehouse, playerName: PlayerName, role: MemberRole): string | undefined {
    if (role === "owner") return "owner 只能通过转让设置";
    if (warehouse.members.some((m) => m.playerName === playerName)) return "该玩家已是成员";
    warehouse.members.push({ playerName, role });
    this.persist(warehouse);
    return undefined;
  }

  /** 改成员角色：owner 角色不可改/不可授让；member 可视需要降为 visitor 等。失败返回中文错误 */
  setMemberRole(warehouse: Warehouse, playerName: PlayerName, role: MemberRole): string | undefined {
    if (playerName === warehouse.ownerName) return "不能修改 owner 的角色";
    if (role === "owner") return "owner 只能通过转让设置"; // 与 addMember 一致，防提权口径不一
    const member = warehouse.members.find((m) => m.playerName === playerName);
    if (!member) return "该玩家不是成员";
    member.role = role;
    this.persist(warehouse);
    return undefined;
  }

  /** 移除成员：owner 不可移除；非成员返回错误；成功落盘 */
  removeMember(warehouse: Warehouse, playerName: PlayerName): string | undefined {
    if (playerName === warehouse.ownerName) return "不能移除 owner";
    const before = warehouse.members.length;
    warehouse.members = warehouse.members.filter((m) => m.playerName !== playerName);
    if (warehouse.members.length === before) return "该玩家不是成员";
    this.persist(warehouse);
    return undefined;
  }

  /** 更新仓库设置（局部 patch 合并落 meta；最小粒度=单仓小 meta，事件既触发也即写） */
  updateSettings(warehouse: Warehouse, patch: Partial<WarehouseSettings>): void {
    warehouse.settings = { ...warehouse.settings, ...patch };
    this.persist(warehouse);
  }

  /**
   * 调整仓库区域（resize 命令）。
   * 与 createWarehouse 同样跑建仓限制校验（体积/重叠/间距，排除自身），失败返回中文错误。
   * 仓库 ID 编码初始区域 → resize 会重算 ID；若变化则**迁移**：
   *   1) 用新 id 持久化 meta，2) 移除旧 id meta，3) 触发 warehouse-area-changed（带 oldId）。
   * 按仓 id 存储的键（cids 索引）+ 调度器重注册由 mc 层订阅 warehouseAreaChanged 处理（事件驱动）。
   * 容器/索引等"随区域变脏"由后续 rescan 收敛。
   */
  updateArea(warehouse: Warehouse, area: WarehouseArea): string | undefined {
    const limitError = areaExceedsLimits(area, this.limits);
    if (limitError !== undefined) return limitError;
    for (const other of this.store.list()) {
      if (other.id === warehouse.id) continue; // 排除自身
      if (areaOverlaps(area, other.area)) return "区域与已有仓库重叠";
      if (areaTooClose(area, other.area, this.limits.minSpacing)) {
        return `区域与其他仓库过于接近（最小间距 ${this.limits.minSpacing} 格）`;
      }
    }
    const newId = warehouseIdOf(area);
    warehouse.area = { ...area };
    let oldId: WarehouseId | undefined;
    if (newId !== warehouse.id) {
      oldId = warehouse.id;
      warehouse.id = newId;
      this.persist(warehouse);
      this.store.remove(oldId);
    } else {
      this.persist(warehouse);
    }
    // resize 使仓库 ID 迁移时携带 oldId——持久化迁移（cids 索引/调度器重注册）由 mc 层
    // 订阅 warehouseAreaChanged 处理（事件驱动，与其它持久化统一，不再用构造回调）
    this.bus.warehouseAreaChanged.trigger({ type: "warehouse-area-changed", warehouseId: warehouse.id, oldId });
    return undefined;
  }

  /** 把仓库快照写盘（meta 单键 generation 模式；容器注册表另由 mc 层每容器一条键维护） */
  persist(warehouse: Warehouse): void {
    this.store.save(this.toSnapshot(warehouse));
  }

  // ── 私有方法 ───────────────────────────────────────────
  // 快照不含 containerIds：容器注册表是**每容器一条键**（ir2:c:{cid}）+ 每仓索引
  // （ir2:wh:{id}:cids，mc 层维护），meta 若带容器列表会随容器数增长而破坏"设置变更只写小 meta"。
  private toSnapshot(warehouse: Warehouse): WarehouseSnapshot {
    return {
      id: warehouse.id,
      displayName: warehouse.displayName,
      ownerName: warehouse.ownerName,
      members: warehouse.members.map((m) => ({ ...m })),
      area: { ...warehouse.area },
      settings: { ...warehouse.settings },
    };
  }

  private buildWarehouse(snapshot: WarehouseSnapshot): Warehouse {
    return {
      id: snapshot.id,
      displayName: snapshot.displayName,
      ownerName: snapshot.ownerName,
      members: snapshot.members.map((m) => ({ ...m })),
      area: { ...snapshot.area },
      settings: { ...createDefaultSettings(), ...snapshot.settings }, // 旧档缺新字段 → 补默认值
      containers: new Map(),
      inputs: new Map(),
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
