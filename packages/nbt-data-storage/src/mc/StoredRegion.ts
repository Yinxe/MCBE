// ── 存储区域句柄（mc 适配层：对外 put/get/take/remove/transfer/stats） ──
// 每个区域对应世界上一座"全木桶阵列"（锚定一个区块，纵向 64 层）。
// - put：编排下沉到 core `putItem`（PutPort 注入）：O(1) 分配 + 世界真值防覆盖 + 有界重试
// - get/take：按 ID 纯算术解码（O(1)）秒定位容器与槽位
// - transferIn/transferOut：与原版容器一致的**原子传输**（要么成功要么保持原状）
// - 分配/回收经 DP 读改写（RMW）持久化；空洞按层分键（level-local 索引）；
//   已物化桶数由 meta.barrelCount 精确跟踪（真正 setBlockType 建桶时 +1）。
import type { Container, ItemStack } from "@minecraft/server";
import { capacityOf, slotIdToPosition, type RegionLayout } from "../core/layout";
import { createRegionMeta, type RegionMeta } from "../core/meta";
import { putItem, releaseSlot, type PutPort } from "../core/put";
import { createRegionRecord, type PersistedRegion } from "../core/record";
import { regionStats, type RegionStats } from "../core/stats";
import { transferIn, transferOut, type TransferPort, type TransferResult } from "../core/transfer";
import type { StoredRef } from "../core/keys";
import { BarrelRuntime } from "./BarrelRuntime";
import { ItemStorageEvents } from "./events";
import { readLevelPool, readRegionRecord, writeLevelPool, writeRegionRecord } from "./store";

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

  /** 把世界/持久化副作用装进 PutPort（core put 编排用它驱动真实方块/容器/DP） */
  private get putPort(): PutPort {
    const region = this;
    return {
      readRecord: () => region.readRecord(),
      writeRecord: (record) => region.writeRecord(record),
      readLevelPool: (level) => readLevelPool(region.regionId, level),
      writeLevelPool: (level, locals) => writeLevelPool(region.regionId, level, locals),
      ensureBarrel: (x, y, z) => region.runtime.ensureBarrel({ x, y, z, slotInBarrel: 0 }),
      isSlotOccupied: (x, y, z, slotInBarrel) => region.runtime.isSlotOccupied({ x, y, z, slotInBarrel }),
      writeItem: (x, y, z, slotInBarrel, item) =>
        region.runtime.writeItem({ x, y, z, slotInBarrel }, item as ItemStack),
    };
  }

  private readRecord(): PersistedRegion | undefined {
    return readRegionRecord(this.regionId);
  }

  private writeRecord(record: PersistedRegion): void {
    writeRegionRecord(this.regionId, record);
  }

  /**
   * 存入一个物品（完整 NBT），成功返回取物凭据 `{ regionId, slotId }`，容量满/失败返回 null。
   * 编排在 core `putItem`：先占位 → 物化 → 世界占用检查 → 写入；
   * 目标槽被外部占用时不覆盖、改选下一候选；物化/写入失败槽回归空洞池下次重试。
   */
  put(item: ItemStack | undefined): StoredRef | null {
    const ref = putItem(this.putPort, item, this.regionId, this.dimensionId, this.layout);
    if (ref && item) {
      ItemStorageEvents.stored.trigger({
        regionId: ref.regionId,
        slotId: ref.slotId,
        itemTypeId: item.typeId,
        stackSize: item.amount,
      });
    }
    return ref;
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
    releaseSlot(this.putPort, slotId, this.dimensionId, this.layout);
    ItemStorageEvents.taken.trigger({ regionId: this.regionId, slotId, itemTypeId: item.typeId });
    return item;
  }

  /** O(1) 按 ID 清空槽位并回收空洞；槽已空/清除失败返回 false */
  remove(slotId: number): boolean {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return false;
    if (!this.runtime.isSlotOccupied(pos)) return false;
    if (!this.runtime.clearSlot(pos)) return false;
    releaseSlot(this.putPort, slotId, this.dimensionId, this.layout);
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

  /** 区域统计快照（capacity/barrels/totalBarrels/used/水印/空洞总数） */
  stats(): RegionStats {
    const record = this.readRecord();
    const meta: RegionMeta = record?.meta ?? createRegionMeta();
    return regionStats(this.regionId, this.dimensionId, this.layout, meta);
  }

  /** 确保阵列区块被 ticking area 常加载（注册后调用一次） */
  ensureTickingArea(): void {
    this.runtime.ensureTickingArea();
  }
}
