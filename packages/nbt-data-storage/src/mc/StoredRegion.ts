// ── 存储区域句柄（mc 适配层：对外 put/get/take/remove/transfer/stats） ──
// 每个区域对应世界上一座"全木桶阵列"（锚定一个区块，纵向 64 层）。
// - put：编排下沉到 core `putItem`（PutPort 注入）：桶水位定位未满桶 +
//   桶内真值探测空槽 + 物化新桶 + 占位即写（有界重试）
// - get/take：按 ID 纯算术解码（O(1)）秒定位容器与槽位
// - transferIn/transferOut：与原版容器一致的**原子传输**（要么成功要么保持原状）
// - 分配/回收经 DP 读改写（RMW）持久化：桶水位按层分键（每层一条）；已物化桶数
//   由 meta.barrelCount 精确跟踪（真正 setBlockType 建桶时 +1）。
import type { Container, ItemStack } from "@minecraft/server";
import { system } from "@minecraft/server";
import { groupSlotIdsByBarrel } from "../core/batch";
import { BARREL_SLOTS, BARRELS_PER_LEVEL, SLOTS_PER_LEVEL, capacityOf, slotIdToPosition, usableSlotsPerBarrel, type RegionLayout, type SlotPosition } from "../core/layout";
import { createRegionMeta, type RegionMeta } from "../core/meta";
import { putItem, decrementUsage, type PutPort } from "../core/put";
import { createRegionRecord, type PersistedRegion } from "../core/record";
import { checkAndRepairLevel, createRepairReport, type RepairEvent, type RepairPort, type RepairReport, type SlotStatus } from "../core/repair";
import { overwriteSlot, type OverwritePort, type OverwriteResult } from "../core/overwrite";
import { rebuildUsage, resizeLayout, type ResizePatch, type ResizePort } from "../core/region";
import { regionStats, type RegionStats } from "../core/stats";
import { transferIn, transferOut, type TransferPort, type TransferResult } from "../core/transfer";
import type { StoredRef } from "../core/keys";
import { BarrelRuntime } from "./BarrelRuntime";
import { ItemStorageEvents } from "./events";
import { readLevelUsage, readRegionRecord, writeLevelUsage, writeRegionRecord } from "./store";

/** 一个已注册的存储区域（同区域 ID → 同阵列，多模组共享） */
export class StoredRegion {
  private readonly runtime: BarrelRuntime;
  private _layout: RegionLayout;
  /** 盘点分批执行状态：进行中标记 + 调度句柄 */
  private repairing = false;
  private repairTimer: number | undefined;

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
      readLevelUsage: (level) => readLevelUsage(region.regionId, level),
      writeLevelUsage: (level, usage) => writeLevelUsage(region.regionId, level, usage),
      ensureBarrel: (x, y, z) => {
        const result = region.runtime.ensureBarrel({ x, y, z, slotInBarrel: 0 });
        if (result.created) {
          ItemStorageEvents.barrelCreated.trigger({ regionId: region.regionId, x, y, z });
        }
        return result;
      },
      isSlotOccupied: (x, y, z, slotInBarrel) => region.runtime.isSlotOccupied({ x, y, z, slotInBarrel }),
      findEmptySlotInBarrel: (x, y, z, usable) => region.runtime.firstEmptySlot({ x, y, z, slotInBarrel: 0 }, usable),
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
   * 编排在 core `putItem`：桶水位定位未满桶 → 桶内真值探测空槽 → 占位写 →
   * 物化（如需要）→ 写入；目标槽被外部占用时不覆盖、改选下一候选；
   * 物化/写入失败回滚计数，下次重试（不丢槽）。
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

  /** O(1) 按 ID 只读取物（不回收槽位、不影响存储阵列；想取走请用 take） */
  read(slotId: number): ItemStack | undefined {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return undefined;
    return this.runtime.readItem(pos);
  }

  /**
   * 批量只读取物（不影响存储阵列）：同桶格子一次容器读取（每桶一次 getBlock +
   * 一次 getItem 循环，替代逐格 getBlock 放大）。越界 slotId 对应位置 undefined。
   * @param slotIds 任意顺序（可重复）；输出与输入顺序对齐
   */
  readBatch(slotIds: number[]): (ItemStack | undefined)[] {
    const result: (ItemStack | undefined)[] = new Array(slotIds.length);
    const groups = groupSlotIdsByBarrel(slotIds, this.layout);
    for (const entries of groups.values()) {
      const pos = entries[0]!.pos;
      const values = this.runtime.readBatch(pos, entries.map((e) => e.slotInBarrel));
      for (let i = 0; i < entries.length; i++) {
        result[entries[i]!.inputIndex] = values[i];
      }
    }
    return result;
  }

  /** 槽位只读状态探测（occupied/empty/damaged/unknown；不影响存储） */
  probe(slotId: number): SlotStatus {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return "unknown";
    return this.runtime.probeStatus(pos);
  }

  /**
   * 枚举区域内全部已占用槽（只读）：按层读桶水位跳过空桶，占用桶一次取容器。
   * 用于巡检/迁移/调试总览（如统计各假人槽位分布）。
   */
  listOccupied(): { slotId: number; itemTypeId: string }[] {
    const result: { slotId: number; itemTypeId: string }[] = [];
    const layout = this.layout;
    const usable = usableSlotsPerBarrel(layout);
    const x0 = layout.chunkX * 16;
    const z0 = layout.chunkZ * 16;
    for (let level = 0; level < layout.maxLevels; level++) {
      const usage = readLevelUsage(this.regionId, level);
      for (let b = 0; b < usage.length && b < BARRELS_PER_LEVEL; b++) {
        if (usage[b] === 0) continue; // 未物化/空桶：跳过
        const pos: SlotPosition = { x: x0 + (b % 16), y: layout.baseY + level, z: z0 + Math.floor(b / 16), slotInBarrel: 0 };
        const statuses = this.runtime.probeBarrelSlots(pos, usable);
        const occupied: number[] = [];
        for (let j = 0; j < statuses.length; j++) {
          if (statuses[j] === "occupied") occupied.push(j);
        }
        if (occupied.length === 0) continue;
        const items = this.runtime.readBatch(pos, occupied);
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item) {
            result.push({
              slotId: level * SLOTS_PER_LEVEL + b * BARREL_SLOTS + occupied[i]!,
              itemTypeId: item.typeId,
            });
          }
        }
      }
    }
    return result;
  }

  /**
   * O(1) 按 ID 取走：读出物品并清空槽位；槽空返回 undefined。
   * 取走成功后该桶占用计数 -1（空槽本身**不需要登记**——分配时桶内探测
   * 真值自然复用空槽，见 AGENTS.md 桶水位设计）。
   */
  take(slotId: number): ItemStack | undefined {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return undefined;
    const item = this.runtime.readItem(pos);
    if (!item) return undefined; // 槽空（已丢失/外部取走）：计数保持，巡检对齐
    if (!this.runtime.clearSlot(pos)) return undefined; // 清除失败不回收
    decrementUsage(this.putPort, slotId, this.layout);
    ItemStorageEvents.taken.trigger({ regionId: this.regionId, slotId, itemTypeId: item.typeId });
    return item;
  }

  /** O(1) 按 ID 清空槽位并回收计数；槽已空/清除失败返回 false */
  remove(slotId: number): boolean {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return false;
    if (!this.runtime.isSlotOccupied(pos)) return false;
    if (!this.runtime.clearSlot(pos)) return false;
    decrementUsage(this.putPort, slotId, this.layout);
    ItemStorageEvents.removed.trigger({ regionId: this.regionId, slotId });
    return true;
  }

  /**
   * 指定槽覆写（安全，read 的写对）：**写入已有格子**（slotId 不变），旧物品读出返回（不丢）。
   * 空槽也允许（写入 + 桶水位 +1）；非木桶/区块未加载（damaged/unknown）→ 拒绝（请先巡检）。
   * 成功后触发 `ItemStorage.events.overwritten`。
   */
  write(slotId: number, item: ItemStack | undefined): OverwriteResult {
    const port: OverwritePort = {
      readRecord: () => this.readRecord(),
      writeRecord: (record) => this.writeRecord(record),
      readLevelUsage: (level) => readLevelUsage(this.regionId, level),
      writeLevelUsage: (level, usage) => writeLevelUsage(this.regionId, level, usage),
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
   * 安全交换（原子）：区域格子 ↔ 外部容器槽位对调（引擎级 `swapItems`，
   * 要么换成功要么两边原样）。与覆写（单向，旧物丢弃/由调用方处置）互补。
   * 成功后触发 `taken`（旧物离开区域）+ `stored`（新物进入区域）事件。
   * @returns { ok, oldTypeId?, newTypeId?, error? }；ok=false 时双方未动
   */
  swap(slotId: number, container: Container, destSlot: number): { ok: boolean; oldTypeId?: string; newTypeId?: string; error?: string } {
    const pos = slotIdToPosition(slotId, this.layout);
    if (!pos) return { ok: false, error: "格子号超出范围" };
    const oldItem = this.runtime.readItem(pos);
    if (!this.runtime.swapItems(pos, container, destSlot)) {
      return { ok: false, error: "交换失败（位置异常/区块未加载），双方保持原样" };
    }
    const newItem = this.runtime.readItem(pos);
    ItemStorageEvents.taken.trigger({
      regionId: this.regionId,
      slotId,
      itemTypeId: oldItem?.typeId,
    });
    ItemStorageEvents.stored.trigger({
      regionId: this.regionId,
      slotId,
      itemTypeId: newItem?.typeId,
      stackSize: newItem?.amount,
    });
    return { ok: true, oldTypeId: oldItem?.typeId, newTypeId: newItem?.typeId };
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

  /** 区域统计快照（capacity/barrels/totalBarrels/used/freeSlots，账本遍历求和） */
  stats(): RegionStats {
    const record = this.readRecord();
    const meta: RegionMeta = record?.meta ?? createRegionMeta();
    return regionStats(
      this.regionId,
      this.dimensionId,
      this.layout,
      meta,
      (level) => readLevelUsage(this.regionId, level)
    );
  }

  /**
   * 已建木桶总数（真值：各层账本登记桶数之和；供扩容见证等高频场景替代全量 stats）。
   * 不用 meta.barrelCount 缓存——它可能因"物化后写入失败"等路径漂移（虚增）。
   */
  get barrelCount(): number {
    let n = 0;
    for (let level = 0; level < this.layout.maxLevels; level++) {
      n += readLevelUsage(this.regionId, level).length;
    }
    return n;
  }

  /**
   * 动态调整测试区域布局参数（层数 1..64 / 每桶槽数 0..27；**仅 test:true 区域可用**）。
   * 解码恒按 27 槽/桶，不影响已有物品的 ID：
   * - 层数增大：任意（≤64），后续分配向新层推进；减小：仅当被裁层无任何物化木桶；
   * - 每桶槽数：任意调整（缩小后已占用的超限槽保留可读，只是不再分配）。
   * 成功后同步句柄布局、**重扫全部已物化桶重建桶水位**（rebuildUsage，对齐世界真值）、
   * 重挂常加载范围。
   * @returns null=成功；字符串=中文拒绝原因
   */
  resizeLayout(patch: ResizePatch): string | null {
    const port: ResizePort = {
      readRecord: () => this.readRecord(),
      writeRecord: (record) => this.writeRecord(record),
      readLevelUsage: (level) => readLevelUsage(this.regionId, level),
    };
    const err = resizeLayout(port, this.layout, patch);
    if (err) return err;
    this._layout = {
      ...this._layout,
      maxLevels: patch.maxLevels ?? this._layout.maxLevels,
      slotPerBarrel: patch.slotPerBarrel ?? this._layout.slotPerBarrel ?? BARREL_SLOTS,
    };
    this.runtime.applyLayout(this._layout);
    // 重扫全部已物化桶，按新布局把桶水位对齐真值（超限槽不计入）
    rebuildUsage(
      {
        readRecord: () => this.readRecord(),
        writeRecord: (record) => this.writeRecord(record),
        readLevelUsage: (level) => readLevelUsage(this.regionId, level),
        writeLevelUsage: (level, usage) => writeLevelUsage(this.regionId, level, usage),
        probeSlot: (slotId) => {
          const pos = slotIdToPosition(slotId, this._layout);
          return pos ? this.runtime.isSlotOccupied(pos) : false;
        },
      },
      this._layout
    );
    this.runtime.ensureTickingArea({ force: true }); // 层数/范围变化：强制重挂（默认预检会跳过同名旧 area）
    return null;
  }

  /**
   * 阵列盘点 + 修复（自检维护，**分批执行**）：每 tick 盘一层（`checkAndRepairLevel`），
   * 满阵列 64 层 ≈ 3 秒完成，不把全部扫描堆在一个 tick 卡死游戏；完成时回调报告。
   * - 桶位置不是木桶（空气/其它容器/普通方块）→ 重建（桶内物品随方块损坏已丢失，无法找回）；
   * - 桶级丢失判定：实际占用 < 账本计数 → 差异件数报丢失（桶损坏重建全丢 /
   *   外部取走差额），账本对齐真值（空格子无需登记，分配看实物自然复用）。
   * 盘点事件（barrel-restored / item-lost-barrel）桥接为 `ItemStorage.events.*`。
   * 进行中再次调用 → 忽略（返回 false）。
   * @returns true=已开始盘点；false=正在盘点中（忽略本次请求）
   */
  checkAndRepair(onDone?: (report: RepairReport) => void): boolean {
    if (this.repairing) return false; // 防重入：上一轮还没盘完
    this.repairing = true;
    const report = createRepairReport();
    let level = 0;
    const port: RepairPort = {
      readRecord: () => this.readRecord(),
      writeRecord: (record) => this.writeRecord(record),
      readLevelUsage: (l) => readLevelUsage(this.regionId, l),
      writeLevelUsage: (l, usage) => writeLevelUsage(this.regionId, l, usage),
      probeSlot: (slotId) => {
        const pos = slotIdToPosition(slotId, this.layout);
        if (!pos) return "unknown";
        return this.runtime.probeStatus(pos);
      },
      probeBarrelSlots: (x, y, z, usable) => this.runtime.probeBarrelSlots({ x, y, z, slotInBarrel: 0 }, usable),
      restoreBarrel: (slotId) => {
        const pos = slotIdToPosition(slotId, this.layout);
        if (!pos) return { ok: false, created: false };
        // 显式盘点修复：阵列坐标内任何非木桶一律覆盖重建（区别于 put 的保守 ensureBarrel）
        return this.runtime.ensureBarrelForRepair(pos);
      },
    };
    const bridge = (e: RepairEvent): void => {
      if (e.type === "barrel-restored") {
        ItemStorageEvents.barrelRestored.trigger({
          regionId: this.regionId,
          slotId: e.slotId,
          level: e.level,
          barrelInLevel: e.barrelInLevel,
        });
      } else {
        ItemStorageEvents.itemLost.trigger({
          regionId: this.regionId,
          level: e.level,
          barrelInLevel: e.barrelInLevel,
          kind: e.kind,
          count: e.count,
        });
      }
    };
    this.repairTimer = system.runInterval(() => {
      if (level >= this.layout.maxLevels) {
        // 全部盘完：复位状态 + 回调汇总报告
        if (this.repairTimer !== undefined) system.clearRun(this.repairTimer);
        this.repairTimer = undefined;
        this.repairing = false;
        onDone?.(report);
        return;
      }
      const step = checkAndRepairLevel(port, this.layout, level, bridge);
      report.scanned += step.report.scanned;
      report.fixedBarrels += step.report.fixedBarrels;
      report.lostItems += step.report.lostItems;
      report.unknownSlots += step.report.unknownSlots;
      report.lostDetails.push(...step.report.lostDetails);
      level = step.nextLevel ?? this.layout.maxLevels;
    }, 1);
    return true;
  }

  /** 确保阵列区块被 ticking area 常加载（注册后调用一次） */
  ensureTickingArea(): void {
    this.runtime.ensureTickingArea();
  }
}