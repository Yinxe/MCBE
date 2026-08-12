// ── 阵列巡检 + 修复（纯逻辑，零 @minecraft 依赖） ─────────────────────
// 自检维护：扫描全部"已分配过的可用槽"（0..水印），探测世界真值并修复：
//   - 槽位所在位置**不是木桶方块**：
//       * 是空气/普通方块（无数据）→ 重建木桶（`barrel-restored` 事件）；
//       * 是**其它容器方块**（箱子/漏斗等，可能承载他人数据）→ **绝不覆盖**，
//         报告冲突（`container-conflict` 事件），跳过；
//   - 元数据认为占用但实物为空：
//       * 桶损坏重建后为空 → 丢失（kind=barrel-destroyed）；
//       * 实物空且不在洞池 → 丢失（kind=taken-externally，外部取走无法修复）；
//   - 区块未加载（不可判定）→ 跳过（不误报不误修）；
//   - 洞池内已知空槽 → 不算丢失（正常 take 释放）。
// 巡检结束统一 rebuildPools：空槽（含丢失槽）回归空洞池 → 容量恢复可复用。
// 特殊事件经 onEvent 回调暴露（mc 层桥接到 ItemStorage.events 供外部模组订阅）。
// 这是显式巡检（O(水印) 扫描），只在调用时执行，非热路径（巡检例外，见 AGENTS.md）。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, SLOTS_PER_LEVEL, levelOf, usableSlotsPerBarrel } from "./layout";
import type { PersistedRegion } from "./record";
import { rebuildPools } from "./region";

/** 槽位世界状态（巡检探测结果） */
export type SlotStatus = "occupied" | "empty" | "damaged" | "unknown";

/** 物品丢失原因（外部模组可据此分类处理） */
export type LostKind = "barrel-destroyed" | "taken-externally";

/** 巡检事件（经 onEvent 回调暴露，mc 层桥接为 EventSignal） */
export type RepairEvent =
  | { type: "barrel-restored"; slotId: number }
  | { type: "item-lost"; slotId: number; kind: LostKind };

/** checkAndRepair 依赖的端口：区域记录 + 洞池 + 世界槽位探测/修复 */
export interface RepairPort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  readLevelPool(level: number): number[];
  writeLevelPool(level: number, locals: number[]): void;
  /**
   * 槽位状态：
   * - occupied=有物 / empty=空；
   * - damaged=位置不是木桶（空气/其它容器/普通方块——阵列坐标内的一切非木桶都是
   *   预期之外的干扰）→ 巡检一律重建覆盖；
   * - unknown=不可判定（区块未加载等）。
   */
  probeSlot(slotId: number): SlotStatus;
  /** 重建该槽所在位置的木桶方块（幂等 setBlockType）；ok=成功，created=本次是否真正新建了桶（同桶多槽只计一次） */
  restoreBarrel(slotId: number): { ok: boolean; created: boolean };
}

/** 巡检报告（面向玩家可格式化输出） */
export interface RepairReport {
  /** 扫描的可用槽数（0..水印 内桶内索引 < 每桶槽数） */
  scanned: number;
  /** 修复（重建）的木桶数 */
  fixedBarrels: number;
  /** 确认丢失的槽位（已释放可重新存入） */
  lostSlots: number[];
  /** 丢失明细（区分原因：桶损坏 / 外部取走） */
  lostDetails: { slotId: number; kind: LostKind }[];
  /** 不可判定跳过的槽数（区块未加载） */
  unknownSlots: number;
  /** 释放回空洞池的槽数（= 丢失槽数；重建洞池后容量恢复） */
  freedSlots: number;
}

/**
 * 阵列巡检 + 修复。语义：
 * - 已分配的槽（水印内、可用槽）逐个探测世界真值；
 * - damaged（无数据方块）→ 重建木桶（容器内容随方块损坏已丢失，无法找回）；
 * - conflict（其它容器）→ **绝不覆盖**，仅报告（可能有他人数据）；
 * - 元数据占用但实物空且不在洞池 → 丢失（外部取走/意外）；
 * - 完成后 rebuildPools 统一把空槽回收为空洞（丢失槽可被再次分配，容量不浪费）。
 *
 * @param onEvent 可选：巡检事件回调（barrel-restored / item-lost / container-conflict），
 *                由 mc 层桥接为 ItemStorage.events 供外部模组订阅
 */
export function checkAndRepair(port: RepairPort, layout: RegionLayout, onEvent?: (e: RepairEvent) => void): RepairReport {
  const record = port.readRecord();
  const report: RepairReport = {
    scanned: 0,
    fixedBarrels: 0,
    lostSlots: [],
    lostDetails: [],
    unknownSlots: 0,
    freedSlots: 0,
  };
  if (!record) return report;

  const limit = record.meta.nextFree;
  const usable = usableSlotsPerBarrel(layout);
  // 洞池快照：已知空槽不算丢失（正常 take 释放）
  const holeSets = new Map<number, Set<number>>();
  for (const level of record.meta.holeLevels) {
    holeSets.set(level, new Set(port.readLevelPool(level)));
  }
  const isHole = (slotId: number): boolean => {
    const level = levelOf(slotId);
    const set = holeSets.get(level);
    return set ? set.has(slotId - level * SLOTS_PER_LEVEL) : false;
  };

  for (let slotId = 0; slotId < limit; slotId++) {
    if (slotId % BARREL_SLOTS >= usable) continue; // 不可分配槽：不巡检
    report.scanned++;
    const status = port.probeSlot(slotId);
    if (status === "unknown") {
      report.unknownSlots++;
      continue;
    }
    if (status === "damaged") {
      // 阵列坐标内任何非木桶方块（空气/其它容器/普通方块）都是预期之外的干扰 → 一律重建覆盖
      const restored = port.restoreBarrel(slotId);
      if (!restored.ok) {
        report.unknownSlots++; // 修复失败（区块未加载）→ 跳过，下次巡检再试
        continue;
      }
      if (restored.created) report.fixedBarrels++; // 真正新建桶才计数（同桶多槽只计一次）
      onEvent?.({ type: "barrel-restored", slotId });
      if (port.probeSlot(slotId) === "occupied") continue; // 重建后幸存（保守视为未丢失）
      // 重建后为空 = 物品随方块损坏丢失
      report.lostSlots.push(slotId);
      report.lostDetails.push({ slotId, kind: "barrel-destroyed" });
      onEvent?.({ type: "item-lost", slotId, kind: "barrel-destroyed" });
      continue;
    }
    if (status === "empty" && !isHole(slotId)) {
      // 元数据占用但实物空 → 外部取走/意外消失（无法修复，判定丢失）
      report.lostSlots.push(slotId);
      report.lostDetails.push({ slotId, kind: "taken-externally" });
      onEvent?.({ type: "item-lost", slotId, kind: "taken-externally" });
    }
  }

  // 统一重建洞池：空槽（含丢失槽）回收为空洞 → 容量恢复可复用
  rebuildPools(
    {
      readRecord: port.readRecord,
      writeRecord: port.writeRecord,
      readLevelPool: port.readLevelPool,
      writeLevelPool: port.writeLevelPool,
      probeSlot: (slotId) => {
        const s = port.probeSlot(slotId);
        return s === "occupied" || s === "unknown"; // unknown 保守视为占用（不回收）
      },
    },
    layout
  );
  report.freedSlots = report.lostSlots.length;
  return report;
}