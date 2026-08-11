// ── 存储区域句柄（mc 适配层：对外 put/get/take/remove/transfer/stats） ──
// 每个区域对应世界上一座"全木桶阵列"（锚定一个区块，纵向 64 层）。
// - put：分配槽位 ID（O(1)）→ 物化木桶 → 写入物品（完整 NBT）→ 返回 { regionId, slotId }
// - get/take：按 ID 纯算术解码（O(1)）秒定位容器与槽位
// - transferIn/transferOut：与原版容器一致的**原子传输**（要么成功要么保持原状）
// - 分配/回收经 DP 读改写（RMW）持久化；空洞按层分键（level-local 索引）；
//   跨模组共享以"世界真值"兜底（不覆盖他人物品）。
import type { Container, ItemStack } from "@minecraft/server";
import { capacityOf, levelOf, slotIdToPosition, type RegionLayout } from "../core/layout";
import {
  allocateSlotId,
  createLevelPools,
  createRegionMeta,
  releaseSlotId,
  type LevelPools,
  type RegionMeta,
} from "../core/meta";
import { createRegionRecord, type PersistedRegion } from "../core/record";
import { regionStats, type RegionStats } from "../core/stats";
import { transferIn, transferOut, type TransferPort, type TransferResult } from "../core/transfer";
import type { StoredRef } from "../core/keys";
import { BarrelRuntime } from "./BarrelRuntime";
import { ItemStorageEvents } from "./events";
import { readLevelPool, readRegionRecord, writeLevelPool, writeRegionRecord } from "./store";

/** 分配重试上限：物化失败/世界占用的候选被跳过，避免无限循环 */
const MAX_ALLOC_RETRY = 64;

/** 一个已注册的存储区域（同区域 ID → 同阵列，多模组共享） */
export class StoredRegion {
  private readonly runtime: BarrelRuntime;

  constructor(
    /** 区域唯一 ID：`2:0:-64`（维度token:区块X:区块Z） */
    readonly regionId: string,
    /** 完整维度 ID：`minecraft:the_end` */
    readonly dimensionId: string,
    /** 布局（首个注册者定下，后续共享） */
    readonly layout: RegionLayout
  ) {
    this.runtime = new BarrelRuntime(dimensionId, layout);
  }

  /** 阵列理论容量（槽位数） */
  get capacity(): number {
    return capacityOf(this.layout);
  }

  private readRecord(): PersistedRegion | undefined {
    return readRegionRecord(this.regionId);
  }

  private writeRecord(record: PersistedRegion): void {
    writeRegionRecord(this.regionId, record);
  }

  /** 为分配准备空洞池：只加载"最低有洞层"（分配只会触碰这一个层） */
  private poolsForAllocate(meta: RegionMeta): LevelPools {
    const pools = createLevelPools(this.layout.maxLevels);
    const lowest = meta.holeLevels[0];
    if (lowest !== undefined) {
      pools.byLevel[lowest] = readLevelPool(this.regionId, lowest);
    }
    return pools;
  }

  /** 为回收准备空洞池：只加载"该 slot 所在层" */
  private poolsForRelease(slotId: number): LevelPools {
    const pools = createLevelPools(this.layout.maxLevels);
    pools.byLevel[levelOf(slotId)] = readLevelPool(this.regionId, levelOf(slotId));
    return pools;
  }

  /**
   * 存入一个物品（完整 NBT），成功返回取物凭据 `{ regionId, slotId }`，容量满/失败返回 null。
   * 分配遵循"先占位（写 DP）→ 物化 → 世界占用检查 → 写入"：
   * - 目标槽被外部占用 → 不覆盖、丢弃该候选并试下一候选（有界）；
   * - 物化/写入失败（通常为区块未就绪或新桶容器暂不可用）→ 槽位回归空洞池，
   *   返回 null 由调用方下个周期重试，不烧水印、不丢空槽。
   */
  put(item: ItemStack | undefined): StoredRef | null {
    if (!item) return null;
    const layout = this.layout;
    for (let attempt = 0; attempt < MAX_ALLOC_RETRY; attempt++) {
      const record = this.readRecord() ?? createRegionRecord(this.dimensionId, layout);
      const meta = record.meta;
      // 记录分配前的最低洞层：分配只会触碰这一层（复用 or 移出索引）
      const lowest = meta.holeLevels[0];
      const pools = this.poolsForAllocate(meta);
      const slotId = allocateSlotId(meta, pools, capacityOf(layout));
      if (slotId === null) return null; // 真满
      const pos = slotIdToPosition(slotId, layout);
      if (!pos) return null;
      // 先占位持久化：收窄 RMW 窗口内跨模组重复分配同一槽的竞态
      this.writeRecord(record);
      if (lowest !== undefined) {
        writeLevelPool(this.regionId, lowest, pools.byLevel[lowest] ?? []);
      }
      if (!this.runtime.ensureBarrel(pos)) {
        this.releaseSlot(slotId); // 区块未就绪：槽回归空洞池，下次重试
        return null;
      }
      if (this.runtime.isSlotOccupied(pos)) continue; // 世界已占用 → 丢弃该候选
      if (!this.runtime.writeItem(pos, item)) {
        this.releaseSlot(slotId); // 新桶容器暂不可用：槽回归空洞池，下次重试
        return null;
      }
      ItemStorageEvents.stored.trigger({
        regionId: this.regionId,
        slotId,
        itemTypeId: item.typeId,
        stackSize: item.amount,
      });
      return { regionId: this.regionId, slotId };
    }
    return null;
  }

  /** O(1) 按 ID 取物（只读不回收槽位；想取走请用 take） */
  get(slotId: number): ItemStack | undefined {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return undefined;
    return this.runtime.readItem(pos);
  }

  /** O(1) 按 ID 取走：读出物品并清空槽位、回收空洞；槽空返回 undefined */
  take(slotId: number): ItemStack | undefined {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return undefined;
    const item = this.runtime.readItem(pos);
    if (!item) return undefined;
    if (!this.runtime.clearSlot(pos)) return undefined; // 清除失败不回收
    this.releaseSlot(slotId);
    ItemStorageEvents.taken.trigger({ regionId: this.regionId, slotId, itemTypeId: item.typeId });
    return item;
  }

  /** O(1) 按 ID 清空槽位并回收空洞；槽已空/清除失败返回 false */
  remove(slotId: number): boolean {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return false;
    if (!this.runtime.isSlotOccupied(pos)) return false;
    if (!this.runtime.clearSlot(pos)) return false;
    this.releaseSlot(slotId);
    ItemStorageEvents.removed.trigger({ regionId: this.regionId, slotId });
    return true;
  }

  /**
   * 原子存入：把 `container` 的 `sourceSlot` 槽位物品搬进区域。
   * 成功 → 源槽清空、返回 { ok:true, slotId }；失败 → 源槽保持原样（物品不丢）。
   */
  transferIn(container: Container, sourceSlot: number): TransferResult {
    const port: TransferPort = {
      readSource: () => {
        try {
          return container.getItem(sourceSlot);
        } catch {
          return undefined;
        }
      },
      store: (item) => this.put(item as ItemStack)?.slotId ?? null,
      take: (slotId) => this.take(slotId),
      writeDest: (item) => {
        try {
          container.setItem(sourceSlot, item as ItemStack);
          return true;
        } catch {
          return false;
        }
      },
      clearSource: () => {
        try {
          container.setItem(sourceSlot, undefined);
          return true;
        } catch {
          return false;
        }
      },
    };
    return transferIn(port);
  }

  /**
   * 原子取出：把区域 `slotId` 槽位物品搬进 `container` 的 `destSlot`。
   * 成功 → 区域槽已回收、目标槽有物；失败 → 物品仍在区域（不丢）。
   */
  transferOut(slotId: number, container: Container, destSlot: number): TransferResult {
    const port: TransferPort = {
      readSource: () => undefined, // transferOut 不使用
      store: (item) => this.put(item as ItemStack)?.slotId ?? null,
      take: (sid) => this.take(sid),
      writeDest: (item) => {
        try {
          container.setItem(destSlot, item as ItemStack);
          return true;
        } catch {
          return false;
        }
      },
      clearSource: () => true,
    };
    return transferOut(port, slotId);
  }

  /** 区域统计快照（capacity/used/水印/空洞总数） */
  stats(): RegionStats {
    const record = this.readRecord();
    const meta: RegionMeta = record?.meta ?? createRegionMeta();
    return regionStats(this.regionId, this.dimensionId, this.layout, meta);
  }

  /** 确保阵列区块被 ticking area 常加载（注册后调用一次） */
  ensureTickingArea(): void {
    this.runtime.ensureTickingArea();
  }

  /** 回收槽位到其所在层空洞池（读改写：主记录 + 该层池） */
  private releaseSlot(slotId: number): void {
    const record = this.readRecord() ?? createRegionRecord(this.dimensionId, this.layout);
    const pools = this.poolsForRelease(slotId);
    releaseSlotId(record.meta, pools, slotId);
    this.writeRecord(record);
    writeLevelPool(this.regionId, levelOf(slotId), pools.byLevel[levelOf(slotId)] ?? []);
  }
}
