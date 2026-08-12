// ── 阵列盘点 + 修复（纯逻辑，零 @minecraft 依赖） ─────────────────────
// 自检维护（把仓库对一遍账）：按层扫描已建木桶（账本 usage.length 范围内），
// 逐个桶看实物与账本比对：
//   - 桶位置**不是木桶方块**（空气/其它容器/普通方块——阵列坐标内的一切非木桶
//     都是预期之外的干扰）→ 重建木桶（`barrel-restored` 事件）；
//   - **桶级丢失判定**（v3 无逐格空格子登记，无法逐格报丢失）：对比账本计数与
//     实际占用（看实物）：
//       * 桶完好但实际占用 < 计数（外部取走）→ 差异件数判定丢失
//         （kind=taken-externally，按桶报告 count）；
//       * 桶损坏（非木桶 → 重建后桶内全空）→ 该桶曾登记的全部占用判定丢失
//         （kind=barrel-destroyed，按桶报告 count）；
//       * 实际占用 > 计数（外部塞入/计数失真）→ 静默对齐（不误报不误清）；
//   - 区块未加载（不可判定）→ 跳过（不误报不误修）。
// 盘完一层就把该层账本**对齐真值**（对齐后分配/统计与世界一致；空格子无需登记，
// 分配时看实物自然复用）。
//
// **分批执行**：`checkAndRepairLevel` 每次只盘一层（mc 层用 system.runInterval
// 每 tick 一层——满阵列 64 层 ≈ 3 秒完成，不把全部工作堆在一个 tick 卡死游戏）；
// `checkAndRepair` 是同步全量包装（逐层循环，供单测与小型区域直接用）。
// 特殊事件经 onEvent 回调暴露（mc 层桥接到 ItemStorage.events 供外部模组订阅）。
// 这是显式盘点（O(物化桶×可用槽) 扫描），只在调用时执行，非热路径。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, SLOTS_PER_LEVEL, slotIdToPosition, usableSlotsPerBarrel } from "./layout";
import type { PersistedRegion } from "./record";
import { normalizeUsage } from "./put";

/** 槽位世界状态（盘点探测结果） */
export type SlotStatus = "occupied" | "empty" | "damaged" | "unknown";

/** 物品丢失原因（外部模组可据此分类处理） */
export type LostKind = "barrel-destroyed" | "taken-externally";

/** 盘点事件（经 onEvent 回调暴露，mc 层桥接为 EventSignal） */
export type RepairEvent =
  | { type: "barrel-restored"; slotId: number; level: number; barrelInLevel: number }
  | { type: "item-lost-barrel"; level: number; barrelInLevel: number; kind: LostKind; count: number };

/** 桶级丢失明细（v3：无逐格登记，按桶报告丢失件数） */
export interface LostBarrelDetail {
  /** 纵向层号 */
  level: number;
  /** 层内木桶序号 0..255 */
  barrelInLevel: number;
  /** 该桶确认丢失的物品件数 */
  count: number;
  kind: LostKind;
}

/** checkAndRepair 依赖的端口：区域记录 + 账本 + 世界槽位探测/修复 */
export interface RepairPort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  /** 读某层"每桶已用格数"账本（占用计数数组） */
  readLevelUsage(level: number): number[];
  /** 写某层账本 */
  writeLevelUsage(level: number, usage: number[]): void;
  /**
   * 槽位状态：
   * - occupied=有物 / empty=空；
   * - damaged=位置不是木桶（空气/其它容器/普通方块——阵列坐标内的一切非木桶都是
   *   预期之外的干扰）→ 盘点一律重建覆盖；
   * - unknown=不可判定（区块未加载等）。
   */
  probeSlot(slotId: number): SlotStatus;
  /**
   * 一次看一个木桶的全部格子（性能优化，可选）：返回该桶 0..usable-1 每格的状态。
   * 未提供时回退逐格 `probeSlot`（逻辑一致，只是每格都要重新取容器，慢一些）。
   */
  probeBarrelSlots?(x: number, y: number, z: number, usable: number): SlotStatus[];
  /** 重建该槽所在位置的木桶方块（幂等 setBlockType）；ok=成功，created=本次是否真正新建了桶（同桶多槽只计一次） */
  restoreBarrel(slotId: number): { ok: boolean; created: boolean };
}

/** 盘点报告（面向玩家可格式化输出） */
export interface RepairReport {
  /** 扫描的可用槽数（全部已登记桶 × 每桶可用槽） */
  scanned: number;
  /** 重建（修复）的木桶数 */
  fixedBarrels: number;
  /** 桶级丢失明细（损坏重建全丢 / 外部取走差额；丢失桶数 = length） */
  lostDetails: LostBarrelDetail[];
  /** 确认丢失的物品总件数 */
  lostItems: number;
  /** 不可判定跳过的槽数（区块未加载） */
  unknownSlots: number;
}

/** 空盘点报告（各层累计用） */
export function createRepairReport(): RepairReport {
  return { scanned: 0, fixedBarrels: 0, lostDetails: [], lostItems: 0, unknownSlots: 0 };
}

/**
 * 盘点一层（分批执行的最小单位）：扫描该层已建木桶（账本长度范围内）的可用槽，
 * 看实物与账本比对、对齐（桶级丢失判定见文件头注释）。
 * @returns 该层的报告增量 + 下一层号（全部盘完 → null）
 */
export function checkAndRepairLevel(
  port: RepairPort,
  layout: RegionLayout,
  level: number,
  onEvent?: (e: RepairEvent) => void
): { report: RepairReport; nextLevel: number | null } {
  const report = createRepairReport();
  if (level >= layout.maxLevels) return { report, nextLevel: null };
  const usable = usableSlotsPerBarrel(layout);
  const usage = normalizeUsage(port.readLevelUsage(level), layout);
  for (let b = 0; b < usage.length; b++) {
    if (usage[b]! <= 0) continue; // 未登记占用：空桶（或外部数据）不扫不动
    const base = level * SLOTS_PER_LEVEL + b * BARREL_SLOTS;
    const pos = slotIdToPosition(base, layout);
    if (!pos) continue;
    // 一次取容器、循环查格（性能：避免每格一次方块查询）
    const statuses = port.probeBarrelSlots
      ? port.probeBarrelSlots(pos.x, pos.y, pos.z, usable)
      : Array.from({ length: usable }, (_, j) => port.probeSlot(base + j));
    let actual = 0; // 桶内实际占用（真值）
    let skip = 0; // 不可判定格数
    for (let j = 0; j < usable; j++) {
      const slotId = base + j;
      report.scanned++;
      const status = statuses[j] ?? "unknown";
      if (status === "unknown") {
        skip++; // 不可判定：保守视为占用，该桶本次不对齐
        report.unknownSlots++;
        continue;
      }
      if (status === "damaged") {
        const restored = port.restoreBarrel(slotId);
        if (!restored.ok) {
          skip++;
          continue;
        }
        if (restored.created) {
          report.fixedBarrels++; // 真正新建桶才计数 + 发重建事件（同桶多格只一次）
          onEvent?.({ type: "barrel-restored", slotId, level, barrelInLevel: b });
        }
        continue; // 重建后按"空"处理（桶内物品随方块损坏已丢失，下方计入差异）
      }
      if (status === "occupied") actual++;
    }
    const aligned = actual + skip; // 可判定部分对齐；unknown 格保守计入占用
    if (aligned >= (usage[b] ?? 0)) {
      // 实际占用 ≥ 计数：无丢失（或计数失真，静默对齐）
      if (aligned !== usage[b]) {
        usage[b] = aligned;
        port.writeLevelUsage(level, usage);
      }
      continue;
    }
    // 实际占用 < 计数：该桶确认有物品丢失
    const kind: LostKind = actual === 0 && skip === 0 ? "barrel-destroyed" : "taken-externally";
    const lostCount = (usage[b] ?? 0) - aligned;
    report.lostItems += lostCount;
    report.lostDetails.push({ level, barrelInLevel: b, count: lostCount, kind });
    onEvent?.({ type: "item-lost-barrel", level, barrelInLevel: b, kind, count: lostCount });
    usage[b] = aligned;
    port.writeLevelUsage(level, usage);
  }
  return { report, nextLevel: level + 1 < layout.maxLevels ? level + 1 : null };
}

/**
 * 阵列盘点 + 修复（同步全量版：逐层盘完；供单测与小型区域直接用）。
 * 游戏内请用 mc 层的分批版（`StoredRegion.checkAndRepair`，每 tick 一层）。
 *
 * @param onEvent 可选：盘点事件回调（barrel-restored / item-lost-barrel），
 *                由 mc 层桥接为 ItemStorage.events 供外部模组订阅
 */
export function checkAndRepair(
  port: RepairPort,
  layout: RegionLayout,
  onEvent?: (e: RepairEvent) => void
): RepairReport {
  const report = createRepairReport();
  for (let level = 0; ; level++) {
    const step = checkAndRepairLevel(port, layout, level, onEvent);
    mergeReport(report, step.report);
    if (step.nextLevel === null) break;
  }
  return report;
}

/** 把一层报告合并进累计报告 */
function mergeReport(total: RepairReport, part: RepairReport): void {
  total.scanned += part.scanned;
  total.fixedBarrels += part.fixedBarrels;
  total.lostItems += part.lostItems;
  total.unknownSlots += part.unknownSlots;
  total.lostDetails.push(...part.lostDetails);
}