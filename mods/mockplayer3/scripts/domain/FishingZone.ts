// ─── 钓鱼区（domain 纯几何 + 钓点池） ────────────────────────────
// 一个钓鱼区 = 一片水域扫出的一批钓点 + 共享点池 + 覆盖盒；支持就近复用与 x/z 间隙 ≤16 邻区合并。
// @minecraft 观测（站位结构复核、实体占用）一律由调用方喂进来，本模块零引擎依赖。

import type { Vec3 } from "./Coords";
import type { FishSpot } from "./FishingSpot";
import { FISH_SPOT_STRIKES, rankFishSpots } from "./FishingSpot";
import { DEFAULT_POOL_CAP, DEFAULT_REFILL_THRESHOLD, SharedPool } from "./Pool";

/** 区域盒（含端点，方块整数坐标；y 维不参与距离判定——水域近水平） */
export interface ZoneRect {
  min: Vec3;
  max: Vec3;
}

/** 邻区合并阈值（格，x/z 盒间隙） */
export const ZONE_MERGE_DISTANCE = 16;

/** 就近复用阈值（格：假人到区盒的 x/z 距离，盒内算 0） */
export const ZONE_REUSE_MAX_DIST = 16;

/** 同维度建区扫描节流（tick）：一次扫描=十几片逐 tick 体积查询，防多假人同 tick 并发 getBlocks 卡顿 */
export const ZONE_SCAN_COOLDOWN_TICKS = 60;

/**
 * 空区宽限（tick）：新建待填、已被清空的区在这段时间内保留，
 * 避免"扫完就解散→马上又重建"的来回空转
 */
export const ZONE_EXPIRE_GRACE_TICKS = 600;

/** 盒间 x/z 间隙（重叠=0；含端点相邻盒间隙可为 0） */
export function rectGapXz(a: ZoneRect, b: ZoneRect): number {
  const dx = Math.max(a.min.x - b.max.x, b.min.x - a.max.x, 0);
  const dz = Math.max(a.min.z - b.max.z, b.min.z - a.max.z, 0);
  return Math.hypot(dx, dz);
}

/** 点到盒的 x/z 距离（盒内=0——就近复用判据） */
export function distanceToRectXz(rect: ZoneRect, at: Vec3): number {
  const dx = Math.max(rect.min.x - at.x, at.x - rect.max.x, 0);
  const dz = Math.max(rect.min.z - at.z, at.z - rect.max.z, 0);
  return Math.hypot(dx, dz);
}

/** 两盒并集（合并后的覆盖盒；y 取并——两侧扫描窗不同高时都保住） */
export function unionRect(a: ZoneRect, b: ZoneRect): ZoneRect {
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
  };
}

/** 取整盒（假人位置小数 → 方块坐标；负半轴 floor 正确向下） */
export function normalizeRect(rect: ZoneRect): ZoneRect {
  return {
    min: { x: Math.floor(rect.min.x), y: Math.floor(rect.min.y), z: Math.floor(rect.min.z) },
    max: { x: Math.floor(rect.max.x), y: Math.floor(rect.max.y), z: Math.floor(rect.max.z) },
  };
}

/**
 * 需与 target 合并的既有区集合（传递闭包：并盒后间隙重算，
 * 链式相邻的三区一次并齐）。
 * @returns 命中区列表（不含 target 自身）
 */
export function mergeGroup<T extends { rect: ZoneRect }>(
  zones: readonly T[],
  target: T,
  dist = ZONE_MERGE_DISTANCE
): T[] {
  const out: T[] = [];
  let box = target.rect;
  let grew = true;
  while (grew) {
    grew = false;
    for (const z of zones) {
      if (out.includes(z)) continue;
      if (rectGapXz(box, z.rect) <= dist) {
        out.push(z);
        box = unionRect(box, z.rect);
        grew = true;
      }
    }
  }
  return out;
}

/**
 * 单个钓鱼区：覆盖盒 + 钓点池 + 合并去向。
 * 合并后本对象退为墓碑（只留 mergedInto），在途持有者经 resolve 找回存活区，
 * 归还与失败计数不会因为并区丢点。
 */
export class FishZone {
  rect: ZoneRect;
  /** 钓点池按 星级→成功率→距心 位次入队；连败 3 次触发失败裁决，不是直接拉黑 */
  readonly pool = new SharedPool<FishSpot>(
    DEFAULT_REFILL_THRESHOLD,
    FISH_SPOT_STRIKES,
    DEFAULT_POOL_CAP,
    rankFishSpots
  );
  mergedInto: FishZone | null = null;
  /** 最近一次使用（认领/补扫/建区）tick——空区超宽限未再用即消散 */
  lastUsedAt: number;

  constructor(
    readonly id: number,
    readonly dimId: string,
    rect: ZoneRect,
    now: number
  ) {
    this.rect = normalizeRect(rect);
    this.lastUsedAt = now;
  }

  /** 合并链解析到存活区（路径压缩：后续再问一跳直达） */
  resolve(): FishZone {
    const chain: FishZone[] = [];
    let cur: FishZone = this;
    while (cur.mergedInto) {
      chain.push(cur);
      cur = cur.mergedInto;
    }
    for (const z of chain) z.mergedInto = cur;
    return cur;
  }

  /** 池内已无点位且无人占用（区消散判据；只剩黑名单里的点不算还有鱼） */
  get depleted(): boolean {
    const s = this.pool.stats();
    return s.free === 0 && s.claimed === 0;
  }

  /** 覆盖盒并入扫描盒（就地补扫后区随实际扫过的范围长大——间隙判据据实算） */
  grow(rect: ZoneRect): void {
    this.rect = unionRect(this.rect, rect);
  }
}

/** 钓鱼区注册表（进程内存活，随 Runtime 同寿；区自然消散靠 sweep） */
export class FishingZones {
  private readonly byId = new Map<number, FishZone>();
  private readonly byDim = new Map<string, FishZone[]>();
  private readonly lastScanAt = new Map<string, number>();
  private nextId = 1;

  /**
   * 按 id 取活区（合并链解析到存活区）；可用性判据=仍在维度活表内。
   * 区已消散或墓碑解析不到活区一律 undefined，调用方据此重走就近复用/建区，不灌点进幽灵区。
   */
  get(id: number): FishZone | undefined {
    const zone = this.byId.get(id);
    if (!zone) return undefined;
    const live = zone.resolve();
    return this.isLive(live) ? live : undefined;
  }

  /** 就近取区（假人到盒距离 ≤ maxDist 的最近活区——有区即复用，免扫描） */
  nearest(dimId: string, at: Vec3, maxDist = ZONE_REUSE_MAX_DIST): FishZone | undefined {
    let best: FishZone | undefined;
    let bestGap = Number.POSITIVE_INFINITY;
    for (const zone of this.byDim.get(dimId) ?? []) {
      const gap = distanceToRectXz(zone.rect, at);
      if (gap <= maxDist && gap < bestGap) {
        best = zone;
        bestGap = gap;
      }
    }
    return best;
  }

  /** 该维度活区列表（诊断/面板） */
  zonesOf(dimId: string): readonly FishZone[] {
    return this.byDim.get(dimId) ?? [];
  }

  /**
   * 建区并按 ZONE_MERGE_DISTANCE 并区。
   * @returns 存活区（可能是被并入的既有老区——id 稳定，既有成员无需搬迁）
   */
  create(dimId: string, rect: ZoneRect, now: number): FishZone {
    const fresh = new FishZone(this.nextId++, dimId, rect, now);
    this.byId.set(fresh.id, fresh);
    const live = this.byDim.get(dimId) ?? [];
    const neighbors = mergeGroup(live, fresh, ZONE_MERGE_DISTANCE);
    if (neighbors.length === 0) {
      this.insert(fresh);
      return fresh;
    }
    // 存活者=最老区（id 最小）：新扫的盒与点位搬进去，其余邻区一并搬入
    const survivor = neighbors.reduce((a, b) => (a.id < b.id ? a : b));
    for (const z of [fresh, ...neighbors]) {
      if (z === survivor) continue;
      survivor.grow(z.rect);
      survivor.pool.absorb(z.pool);
      z.mergedInto = survivor;
      this.deactivate(z);
    }
    survivor.lastUsedAt = now;
    this.insert(survivor);
    return survivor;
  }

  /** 取活区并刷新使用时刻（能力侧认领/补扫入口——空区宽限窗据此滑动） */
  use(id: number, now: number): FishZone | undefined {
    const zone = this.get(id);
    if (zone) zone.lastUsedAt = now;
    return zone;
  }

  /**
   * 空区清扫：过了宽限窗仍零点位 → 出表，下轮就近无区自然重扫。
   * 墓碑只在解析不到活区时才出表——按龄强删会让在途持有者解析不出池，dropSpot/spotFail/stop 静默失败。
   * @returns 消散区数（含墓碑）
   */
  sweep(now: number, graceTicks = ZONE_EXPIRE_GRACE_TICKS): number {
    let gone = 0;
    for (const list of this.byDim.values()) {
      for (const zone of [...list]) {
        if (now - zone.lastUsedAt >= graceTicks && zone.depleted) {
          this.deactivate(zone);
          this.byId.delete(zone.id);
          gone++;
        }
      }
    }
    for (const [id, zone] of [...this.byId]) {
      if (zone.mergedInto && now - zone.lastUsedAt >= graceTicks && !this.isLive(zone.resolve())) {
        this.byId.delete(id);
        gone++;
      }
    }
    return gone;
  }

  /** 建区扫描是否到点（同维度节流，慢操作治理） */
  scanDue(dimId: string, now: number, cooldownTicks = ZONE_SCAN_COOLDOWN_TICKS): boolean {
    const last = this.lastScanAt.get(dimId);
    return last === undefined || now - last >= cooldownTicks;
  }

  markScanned(dimId: string, now: number): void {
    this.lastScanAt.set(dimId, now);
  }

  private isLive(zone: FishZone): boolean {
    return this.byDim.get(zone.dimId)?.includes(zone) ?? false;
  }

  private insert(zone: FishZone): void {
    const list = this.byDim.get(zone.dimId);
    if (list) {
      if (!list.includes(zone)) list.push(zone);
    } else {
      this.byDim.set(zone.dimId, [zone]);
    }
  }

  private deactivate(zone: FishZone): void {
    const list = this.byDim.get(zone.dimId);
    if (!list) return;
    const at = list.indexOf(zone);
    if (at >= 0) list.splice(at, 1);
  }
}
