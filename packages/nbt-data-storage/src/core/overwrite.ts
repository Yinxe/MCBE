// ── 指定格子精准覆写（纯逻辑，零 @minecraft 依赖） ──────────────────
// `overwriteSlot`：**ItemStack → 指定格子**的直接精准覆写写入（slotId 不变），
// 主要用于**实时数据保存**（固定 slotId 反复覆盖，如实体状态/物品栏快照）。
// 与 put（分配新槽）/transferIn（容器→容器搬移）互补，语义是"写入指定格"：
//   - 格内已有物品（occupied）→ 替换，旧物品读出返回调用方（不丢）；
//   - 格内为空（empty）→ 直接写入（精准指定格子的写入手势），并**登记桶水位**
//     计数 +1（该桶占用数对齐，防止统计虚低——水位只记计数，不记槽位）；
//   - 非木桶/区块未加载（damaged/unknown）→ 拒绝（绝不写入异常位置，请先巡检）；
//   - 格子号越界/空物品 → 拒绝。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, SLOTS_PER_LEVEL, levelOf, slotIdToPosition, usableSlotsPerBarrel } from "./layout";
import type { PersistedRegion } from "./record";
import type { SlotStatus } from "./repair";

/** overwriteSlot 依赖的端口：槽位探测/读写 + 桶水位维护 */
export interface OverwritePort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  /** 读某层桶水位（占用计数数组） */
  readLevelUsage(level: number): number[];
  /** 写某层桶水位 */
  writeLevelUsage(level: number, usage: number[]): void;
  /** 槽位状态（occupied/empty/damaged/unknown，语义见 repair.ts） */
  probeSlot(slotId: number): SlotStatus;
  /** 读旧物品（不透明引用，mc 层克隆返回） */
  readItem(slotId: number): unknown;
  /** 写入新物品（克隆源栈）；成功返回 true */
  writeItem(slotId: number, item: unknown): boolean;
}

/** 覆写结果：ok=true 时 old 为被替换的旧物品（空槽覆写则 undefined；调用方负责处置，不丢） */
export interface OverwriteResult {
  ok: boolean;
  old?: unknown;
  error?: string;
}

/**
 * 指定格子精准覆写（安全，ItemStack → 容器；实时数据保存用）。
 * @returns { ok:true, old } 覆写成功，old=被替换的旧物品（原为空则 undefined）；
 *          { ok:false, error } 拒绝原因
 */
export function overwriteSlot(
  port: OverwritePort,
  slotId: number,
  item: unknown,
  layout: RegionLayout
): OverwriteResult {
  if (item === undefined || item === null) return { ok: false, error: "覆写物品不能为空" };
  if (!slotIdToPosition(slotId, layout)) return { ok: false, error: "格子号超出范围" };
  const status = port.probeSlot(slotId);
  if (status === "damaged" || status === "unknown") {
    return { ok: false, error: "该位置状态异常（非木桶/区块未加载），请先巡检修复后再覆写" };
  }
  const old = status === "occupied" ? port.readItem(slotId) : undefined;
  if (!port.writeItem(slotId, item)) {
    return { ok: false, error: "覆写写入失败（位置异常），原物品未受影响" };
  }
  // 空槽覆写：桶水位计数 +1（该桶此前未登记该占用；防止统计虚低）
  if (status === "empty" && slotIdToPosition(slotId, layout)) {
    registerUsage(port, slotId, layout);
  }
  return { ok: true, old };
}

/** 空槽覆写后登记桶水位（该桶占用计数 +1；桶未登记 → 登记 1） */
function registerUsage(port: OverwritePort, slotId: number, layout: RegionLayout): void {
  const level = levelOf(slotId);
  const local = slotId - level * SLOTS_PER_LEVEL;
  const b = Math.floor(local / BARREL_SLOTS);
  const j = local % BARREL_SLOTS;
  if (j >= usableSlotsPerBarrel(layout)) return; // 超限槽：计数范围之外
  const usage = port.readLevelUsage(level);
  if (b < usage.length) {
    if (usage[b]! < BARREL_SLOTS) usage[b] = usage[b]! + 1;
  } else {
    usage[b] = 1;
  }
  port.writeLevelUsage(level, usage);
}