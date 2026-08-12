// ── 存储区域句柄（mc 适配层：对外 put/get/take/remove/transfer/stats） ──
// 每个区域对应世界上一座"全木桶阵列"（锚定一个区块，纵向 64 层）。
// - put：编排下沉到 core `putItem`（PutPort 注入）：O(1) 分配 + 世界真值防覆盖 + 有界重试
// - get/take：按 ID 纯算术解码（O(1)）秒定位容器与槽位
// - transferIn/transferOut：与原版容器一致的**原子传输**（要么成功要么保持原状）
// - 分配/回收经 DP 读改写（RMW）持久化；空洞按层分键（level-local 索引）；
//   已物化桶数由 meta.barrelCount 精确跟踪（真正 setBlockType 建桶时 +1）。
import type { Container, ItemStack } from "@minecraft/server";
import { BARREL_SLOTS, capacityOf, slotIdToPosition, type RegionLayout } from "../core/layout";
import { createRegionMeta, type RegionMeta } from "../core/meta";
import { putItem, releaseSlot, type PutPort } from "../core/put";
import { createRegionRecord, type PersistedRegion } from "../core/record";
import { checkAndRepair, type RepairPort, type RepairReport } from "../core/repair";
import { overwriteSlot, type OverwritePort, type OverwriteResult } from "../core/overwrite";
import { rebuildPools, resizeLayout, type ResizePatch, type ResizePort } from "../core/region";
import { regionStats, type RegionStats } from "../core/stats";
import { transferIn, transferOut, type TransferPort, type TransferResult } from "../core/transfer";
import type { StoredRef } from "../core/keys";
import { BarrelRuntime } from "./BarrelRuntime";
import { ItemStorageEvents } from "./events";
import { readLevelPool, readRegionRecord, writeLevelPool, writeRegionRecord } from "./store";

/** 一个已注册的存储区域（同区域 ID → 同阵列，多模组共享） */
export class StoredRegion {
  private readonly runtime: BarrelRuntime;
  private _layout: RegionLayout;

  constructor(
    /** 区域唯一 ID：`2:0:-64`（维度token:区块X:区块Z） */
    readonly regionId: string,
    /** 完整维度 ID：`minecraft:the_end` */
    readonly dimensionId: string,
    /** 布局（首个注册者定下，后续共享；层数可经 resizeLevels 调整） */
    layout: RegionLayout
  ) {
    this._layout = layout;
    this.runtime = new BarrelRuntime(dimensionId, layout);
  }

  /** 当前布局（层数可经 resizeLevels 更新） */
  get layout(): RegionLayout {
    return this._layout;
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
      ensureBarrel: (x, y, z) => {
        const result = region.runtime.ensureBarrel({ x, y, z, slotInBarrel: 0 });
        if (result.created) {
          ItemStorageEvents.barrelCreated.trigger({ regionId: region.regionId, x, y, z });
        }
        return result;
      },
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

  /**
   * O(1) 按 ID 取走：读出物品并清空槽位、回收空洞；槽空返回 undefined。
   * 槽空（物品已丢失/外部取走）时**也回收进空洞池**——释放该槽容量供复用，
   * 避免"占用虚高、永不重分配"（releaseSlotId 幂等，重复 take 不会重复入池）。
   */
  take(slotId: number): ItemStack | undefined {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return undefined;
    const item = this.runtime.readItem(pos);
    if (!item) {
      releaseSlot(this.putPort, slotId, this.dimensionId, this.layout); // 空槽回收（幂等）
      return undefined;
    }
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
   * 原位覆写（安全）：在**已有格子**上覆盖写入（slotId 不变），旧物品读出返回（不丢）。
   * 护栏：仅位置有实物才允许（空槽请用 put；非木桶/未加载请先巡检）。
   * 成功后触发 `ItemStorage.events.overwritten`。
   */
  overwrite(slotId: number, item: ItemStack | undefined): OverwriteResult {
    const port: OverwritePort = {
      probeSlot: (id) => {
        const pos = slotIdToPosition(id, this.layout);
        if (!pos) return "unknown";
        return this.runtime.probeStatus(pos);
      },
      readItem: (id) => {
        const pos = slotIdToPosition(id, this.layout);
        return pos ? this.runtime.readItem(pos) : undefined;
      },
      writeItem: (id, it) => {
        const pos = slotIdToPosition(id, this.layout);
        return pos ? this.runtime.writeItem(pos, it as ItemStack) : false;
      },
    };
    const result = overwriteSlot(port, slotId, item, this.layout);
    if (result.ok && item) {
      ItemStorageEvents.overwritten.trigger({
        regionId: this.regionId,
        slotId,
        oldTypeId: (result.old as ItemStack | undefined)?.typeId,
        newTypeId: item.typeId,
      });
    }
    return result;
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

  /**
   * 动态调整测试区域布局参数（层数 1..64 / 每桶槽数 0..27；**仅 test:true 区域可用**）。
   * 解码恒按 27 槽/桶，不影响已有物品的 ID：
   * - 层数增大：任意（≤64），后续分配向新层推进；减小：仅当高层无已分配槽位/空洞；
   * - 每桶槽数：任意调整（缩小后已占用的超限槽保留可读，只是不再分配）。
   * 成功后同步句柄布局、**重扫全部容器重建洞池**（rebuildPools，清遗留洞并对齐世界真值）、
   * 重挂常加载范围。
   * @returns null=成功；字符串=中文拒绝原因
   */
  resizeLayout(patch: ResizePatch): string | null {
    const port: ResizePort = {
      readRecord: () => this.readRecord(),
      writeRecord: (record) => this.writeRecord(record),
    };
    const err = resizeLayout(port, this.layout, patch);
    if (err) return err;
    this._layout = {
      ...this._layout,
      maxLevels: patch.maxLevels ?? this._layout.maxLevels,
      slotPerBarrel: patch.slotPerBarrel ?? (this._layout.slotPerBarrel ?? BARREL_SLOTS),
    };
    this.runtime.applyLayout(this._layout);
    // 重扫全部已分配槽位，按新布局重建洞池（遗留超限洞清除，与世界真值对齐）
    rebuildPools(
      {
        readRecord: () => this.readRecord(),
        writeRecord: (record) => this.writeRecord(record),
        readLevelPool: (level) => readLevelPool(this.regionId, level),
        writeLevelPool: (level, locals) => writeLevelPool(this.regionId, level, locals),
        probeSlot: (slotId) => {
          const pos = slotIdToPosition(slotId, this._layout);
          return pos ? this.runtime.isSlotOccupied(pos) : false;
        },
      },
      this._layout
    );
    this.runtime.ensureTickingArea(); // 范围变化：重挂（幂等，新范围新增一个 area）
    return null;
  }

  /**
   * 阵列巡检 + 修复（自检维护）：扫描全部已分配槽位，
   * - 无数据方块（空气/普通方块）→ 重建木桶（容器内容随方块损坏已丢失，无法找回）；
   * - **其它容器方块 → 绝不覆盖**（可能承载他人数据），仅报告冲突；
   * - 元数据占用但实物为空 → 报告丢失（区分桶损坏/外部取走）；
   * - 完成后重建洞池：丢失槽回收为空洞，容量恢复可复用。
   * 巡检事件（barrel-restored / item-lost / container-conflict）桥接为
   * `ItemStorage.events.*` 供外部模组订阅。显式巡检（O(水印) 扫描），仅调用时执行。
   */
  checkAndRepair(): RepairReport {
    const port: RepairPort = {
      readRecord: () => this.readRecord(),
      writeRecord: (record) => this.writeRecord(record),
      readLevelPool: (level) => readLevelPool(this.regionId, level),
      writeLevelPool: (level, locals) => writeLevelPool(this.regionId, level, locals),
      probeSlot: (slotId) => {
        const pos = slotIdToPosition(slotId, this.layout);
        if (!pos) return "unknown";
        return this.runtime.probeStatus(pos);
      },
      restoreBarrel: (slotId) => {
        const pos = slotIdToPosition(slotId, this.layout);
        if (!pos) return { ok: false, created: false };
        return this.runtime.ensureBarrel(pos);
      },
    };
    return checkAndRepair(port, this.layout, (e) => {
      if (e.type === "barrel-restored") {
        ItemStorageEvents.barrelRestored.trigger({ regionId: this.regionId, slotId: e.slotId });
      } else {
        ItemStorageEvents.itemLost.trigger({ regionId: this.regionId, slotId: e.slotId, kind: e.kind });
      }
    });
  }

  /** 确保阵列区块被 ticking area 常加载（注册后调用一次） */
  ensureTickingArea(): void {
    this.runtime.ensureTickingArea();
  }
}
