// ─── 物品仓搬迁计划（domain 纯逻辑） ────────────────────────────
// 兼容锚点（末地）迁回首选锚点（测试维度）时：逐槽读源仓 → 写目标仓 → 全成功才改绑定表。
// 本模块只决定"哪些绑定格要搬、从哪个槽搬"，读写、回滚与落盘在 engine/ItemVault。

import { EQUIP_SLOT_NAMES } from "./Record";
import type { StorageBinding } from "./Record";

/** 待搬迁的一格：目标绑定键 + 源区域槽位 + 读出的物品（物品类型由调用方决定） */
export interface CarryEntry<T> {
  /** 绑定表键（背包为格号串，装备为槽名） */
  key: string;
  /** 源区域槽位 id */
  fromSlotId: number;
  /** 源槽读出的物品 */
  item: T;
}

/** 搬迁计划：按绑定表分背包/装备两组，另有不带走的绑定数 */
export interface CarryPlan<T> {
  inv: CarryEntry<T>[];
  equip: CarryEntry<T>[];
  /** 空位或占位一类不带走的绑定数（对应绑定键不写入目标表） */
  skipped: number;
}

/**
 * 生成绑定表搬迁计划：逐绑定格读源槽，keep 判定的物品才带走。
 * 背包按格号升序、装备按 EQUIP_SLOT_NAMES 顺序，保证同一绑定表每次都得到同一搬序。
 * @param binding - 源绑定表
 * @param read - 读源槽（读不到返回 undefined）
 * @param keep - 是否真实物品（空位/占位返回 false）
 * @returns 搬迁计划（含跳过计数）
 */
export function planBindingCarry<T>(
  binding: StorageBinding,
  read: (slotId: number) => T | undefined,
  keep: (item: T) => boolean
): CarryPlan<T> {
  const plan: CarryPlan<T> = { inv: [], equip: [], skipped: 0 };
  const seen = new Set<number>();
  const collect = (key: string, slotId: number, into: CarryEntry<T>[]): void => {
    // 同一源槽被两个绑定键引用（损坏档案）：只搬一次，重复键计入跳过
    if (seen.has(slotId)) {
      plan.skipped++;
      return;
    }
    seen.add(slotId);
    const item = read(slotId);
    if (item === undefined || !keep(item)) {
      plan.skipped++;
      return;
    }
    into.push({ key, fromSlotId: slotId, item });
  };

  for (const key of Object.keys(binding.inv).sort((a, b) => Number(a) - Number(b))) {
    collect(key, binding.inv[key]!, plan.inv);
  }
  for (const key of EQUIP_SLOT_NAMES) {
    const slotId = binding.equip[key];
    if (slotId !== undefined) collect(key, slotId, plan.equip);
  }
  return plan;
}

/** 计划里要搬的总格数 */
export function carryCount<T>(plan: CarryPlan<T>): number {
  return plan.inv.length + plan.equip.length;
}
