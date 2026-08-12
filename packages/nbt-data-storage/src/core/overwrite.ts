// ── 原位覆写（纯逻辑，零 @minecraft 依赖） ────────────────────────────
// `overwriteSlot`：在**已有格子**上覆盖写入（slotId 不变），旧物品读出返回
// 给调用方（不丢）。与 put（分配新槽）互补：
//   - put            → 分配新槽位（O(1) 分配器）
//   - transferIn     → 原子搬移（源清 → 新槽）
//   - overwriteSlot  → 指定槽位原位替换（返回旧物）
// 安全护栏（"覆写"必须是显式且受控的）：
//   - 位置有实物（occupied）→ 允许，返回旧物品；
//   - 空槽（empty）→ 拒绝（覆写语义要求"已有物品"，空槽请用 put）；
//   - 非木桶/区块未加载（damaged/unknown）→ 拒绝（请先巡检修复，绝不写入异常位置）；
//   - 格子号越界/不可分配 → 拒绝。
import type { RegionLayout } from "./layout";
import { slotIdToPosition } from "./layout";
import type { SlotStatus } from "./repair";

/** overwriteSlot 依赖的端口：槽位探测/读写（覆写不改变分配状态，无需记录/洞池） */
export interface OverwritePort {
  /** 槽位状态（occupied/empty/damaged/unknown，语义见 repair.ts） */
  probeSlot(slotId: number): SlotStatus;
  /** 读旧物品（不透明引用，mc 层克隆返回） */
  readItem(slotId: number): unknown;
  /** 写入新物品（克隆源栈）；成功返回 true */
  writeItem(slotId: number, item: unknown): boolean;
}

/** 覆写结果：ok=true 时 old 为被替换的旧物品（调用方负责处置，不丢） */
export interface OverwriteResult {
  ok: boolean;
  old?: unknown;
  error?: string;
}

/**
 * 指定槽位原位覆写（安全）。
 * @returns { ok:true, old } 覆写成功，old=被替换的旧物品；{ ok:false, error } 拒绝原因
 */
export function overwriteSlot(port: OverwritePort, slotId: number, item: unknown, layout: RegionLayout): OverwriteResult {
  if (item === undefined || item === null) return { ok: false, error: "覆写物品不能为空" };
  if (!slotIdToPosition(slotId, layout)) return { ok: false, error: "格子号超出范围或不可分配" };
  const status = port.probeSlot(slotId);
  if (status === "occupied") {
    const old = port.readItem(slotId);
    if (port.writeItem(slotId, item)) return { ok: true, old };
    return { ok: false, error: "覆写写入失败（位置异常），旧物品未受影响" };
  }
  if (status === "empty") {
    return { ok: false, error: "该位置为空，覆写需目标已有物品（存入新槽请用 put）" };
  }
  return { ok: false, error: "该位置状态异常（非木桶/区块未加载），请先巡检修复后再覆写" };
}