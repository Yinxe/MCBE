// ── 指定格子精准覆写（纯逻辑，零 @minecraft 依赖） ──────────────────
// `overwriteSlot`：**ItemStack → 指定格子**的直接精准覆写写入（slotId 不变），
// 主要用于**实时数据保存**（固定 slotId 反复覆盖，如实体状态/物品栏快照）。
// 与 put（分配新槽）/transferIn（容器→容器搬移）互补，语义是"写入指定格"：
//   - 格内已有物品（occupied）→ 替换，旧物品读出返回调用方（不丢）；
//   - 格内为空/洞（empty）→ 直接写入（精准指定格子的写入手势），并**占位移除**
//     该洞（防止后续 put 再分配同一格）；
//   - 非木桶/区块未加载（damaged/unknown）→ 拒绝（绝不写入异常位置，请先巡检）；
//   - 格子号越界/空物品 → 拒绝。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, SLOTS_PER_LEVEL, levelOf, slotIdToPosition } from "./layout";
import type { PersistedRegion } from "./record";
import type { SlotStatus } from "./repair";

/** overwriteSlot 依赖的端口：槽位探测/读写 + 洞池占位维护 */
export interface OverwritePort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  readLevelPool(level: number): number[];
  writeLevelPool(level: number, locals: number[]): void;
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
  // 空槽覆写：若该格登记在洞池（曾被 take 释放）→ 占位移除，防止后续 put 再分配同一格
  if (status === "empty") {
    const record = port.readRecord();
    if (record) {
      const level = levelOf(slotId);
      const local = slotId - level * SLOTS_PER_LEVEL;
      const pool = port.readLevelPool(level);
      const idx = pool.indexOf(local);
      if (idx >= 0) {
        pool.splice(idx, 1);
        port.writeLevelPool(level, pool);
        record.meta.holeCount = Math.max(0, record.meta.holeCount - 1);
        if (pool.length === 0) {
          record.meta.holeLevels = record.meta.holeLevels.filter((l) => l !== level);
        }
        port.writeRecord(record);
      }
    }
  }
  return { ok: true, old };
}
