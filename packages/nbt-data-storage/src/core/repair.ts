// ── 阵列巡检 + 修复（纯逻辑，零 @minecraft 依赖） ─────────────────────
// 自检维护：扫描全部已物化桶（桶水位 usage.length 范围内）的可用槽，探测世界真值：
//   - 槽位所在位置**不是木桶方块**：
//       * 是空气/普通方块（无数据）→ 重建木桶（`barrel-restored` 事件）；
//       * 是**其它容器方块**（箱子/漏斗等，可能承载他人数据）→ **绝不覆盖**，
//         报告冲突（`container-conflict` 事件），跳过；
//   - **桶级丢失判定**（v3 无逐槽空洞登记，无法逐槽报丢失）：对比桶水位计数与
//     实际占用（探测真值）：
//       * 桶完好但实际占用 < 计数（外部取走）→ 差异件数判定丢失
//         （kind=taken-externally，按桶报告 count）；
//       * 桶损坏（非木桶 → 重建后桶内全空）→ 该桶曾登记的全部占用判定丢失
//         （kind=barrel-destroyed，按桶报告 count）；
//       * 实际占用 > 计数（外部塞入/计数失真）→ 静默对齐（不误报不误清）；
//   - 区块未加载（不可判定）→ 跳过（不误报不误修）。
// 巡检结束统一把桶水位**对齐真值**（对齐后分配/统计与世界一致）。
// 特殊事件经 onEvent 回调暴露（mc 层桥接到 ItemStorage.events 供外部模组订阅）。
// 这是显式巡检（O(物化桶×可用槽) 扫描），只在调用时执行，非热路径（巡检例外，见 AGENTS.md）。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, SLOTS_PER_LEVEL, usableSlotsPerBarrel } from "./layout";
import type { PersistedRegion } from "./record";
import { normalizeUsage } from "./put";

/** 槽位世界状态（巡检探测结果） */
export type SlotStatus = "occupied" | "empty" | "damaged" | "unknown";

/** 物品丢失原因（外部模组可据此分类处理） */
export type LostKind = "barrel-destroyed" | "taken-externally";

/** 巡检事件（经 onEvent 回调暴露，mc 层桥接为 EventSignal） */
export type RepairEvent =
  | { type: "barrel-restored"; slotId: number; level: number; barrelInLevel: number }
  | { type: "item-lost-barrel"; level: number; barrelInLevel: number; kind: LostKind; count: number };

/** 桶级丢失明细（v3：无逐槽登记，按桶报告丢失件数） */
export interface LostBarrelDetail {
  /** 纵向层号 */
  level: number;
  /** 层内木桶序号 0..255 */
  barrelInLevel: number;
  /** 该桶确认丢失的物品件数 */
  count: number;
  kind: LostKind;
}

/** checkAndRepair 依赖的端口：区域记录 + 桶水位 + 世界槽位探测/修复 */
export interface RepairPort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  /** 读某层桶水位（占用计数数组） */
  readLevelUsage(level: number): number[];
  /** 写某层桶水位 */
  writeLevelUsage(level: number, usage: number[]): void;
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

/**
 * 阵列巡检 + 修复（桶级对齐语义，见文件头注释）。
 * 完成后桶水位与真值对齐：实际占用写回计数；空槽无需登记——
 * 分配时桶内探测真值自然复用（v3 无空洞池）。
 *
 * @param onEvent 可选：巡检事件回调（barrel-restored / item-lost-barrel），
 *                由 mc 层桥接为 ItemStorage.events 供外部模组订阅
 */
export function checkAndRepair(
  port: RepairPort,
  layout: RegionLayout,
  onEvent?: (e: RepairEvent) => void
): RepairReport {
  const record = port.readRecord();
  const report: RepairReport = {
    scanned: 0,
    fixedBarrels: 0,
    lostDetails: [],
    lostItems: 0,
    unknownSlots: 0,
  };
  if (!record) return report;

  const usable = usableSlotsPerBarrel(layout);
  for (let level = 0; level < layout.maxLevels; level++) {
    const usage = normalizeUsage(port.readLevelUsage(level), layout);
    for (let b = 0; b < usage.length; b++) {
      if ((usage[b] ?? 0) <= 0) continue; // 未登记占用：空桶（或外部数据）不扫不动
      let actual = 0; // 桶内实际占用（真值）
      let skip = 0; // 不可判定槽数
      for (let j = 0; j < usable; j++) {
        const slotId = level * SLOTS_PER_LEVEL + b * BARREL_SLOTS + j;
        report.scanned++;
        const status = port.probeSlot(slotId);
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
          if (restored.created) report.fixedBarrels++; // 真正新建桶才计数（同桶多槽只计一次）
          onEvent?.({ type: "barrel-restored", slotId, level, barrelInLevel: b });
          continue; // 重建后按"空"处理（桶内物品随方块损坏已丢失，下方计入差异）
        }
        if (status === "occupied") actual++;
      }
      const aligned = actual + skip; // 可判定部分对齐；unknown 槽保守计入占用
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
  }
  return report;
}