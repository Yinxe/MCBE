// ── 存入编排（纯逻辑，零 @minecraft 依赖） ────────────────────────────
// 把 `put` 的"分配候选槽 → 先占位写 DP → 物化 → 世界占用检查 → 写入"全流程
// 从 mc 适配层下沉到 core，通过 PutPort 注入世界/持久化副作用 → 可脱离游戏 mock 单测。
// 语义（以世界为真值，绝不覆盖他人物品）：
//   - 候选槽被世界占用 → 丢弃候选、重试下一候选（有界，不覆盖）；
//   - 物化/写入失败（区块未就绪、新桶容器暂不可用）→ 槽位回归该层空洞池并返回 null，
//     由调用方下个周期重试（不烧水印、不丢空槽）；
//   - 真正 setBlockType 建了新桶 → meta.barrelCount +1。
import type { RegionLayout } from "./layout";
import { SLOTS_PER_LEVEL, levelOf, slotIdToPosition, usableSlotsPerBarrel } from "./layout";
import { allocateSlotId, createLevelPools, releaseSlotId, type LevelPools } from "./meta";
import { createRegionRecord, type PersistedRegion } from "./record";
import type { StoredRef } from "./keys";

/** 分配重试上限：物化失败/世界占用的候选被跳过，避免无限循环 */
export const MAX_ALLOC_RETRY = 64;

/** put 编排依赖的端口：世界/持久化副作用全部抽象，纯逻辑可 mock */
export interface PutPort {
  /** 读区域主记录（每次全新读取，模拟 DP 读改写） */
  readRecord(): PersistedRegion | undefined;
  /** 写区域主记录 */
  writeRecord(record: PersistedRegion): void;
  /** 读某层空洞池（level-local 索引） */
  readLevelPool(level: number): number[];
  /** 写某层空洞池 */
  writeLevelPool(level: number, locals: number[]): void;
  /** 物化/确认木桶存在（幂等）；返回是否就绪 + 本次是否新建了桶 */
  ensureBarrel(x: number, y: number, z: number): { ok: boolean; created: boolean };
  /** 该槽位是否已被世界占用（真值检查；无法确认保守视为占用） */
  isSlotOccupied(x: number, y: number, z: number, slotInBarrel: number): boolean;
  /** 把物品写入槽位（物品为不透明引用）；成功返回 true */
  writeItem(x: number, y: number, z: number, slotInBarrel: number, item: unknown): boolean;
}

/**
 * 存入编排（O(1) 分配 + 有界重试）：成功返回取物凭据 `{ regionId, slotId }`，满/失败返回 null。
 * 分配只触碰最低洞层（holeLevels[0]），无洞则推进水印；每轮都是常量操作，不扫描槽位。
 */
export function putItem(
  port: PutPort,
  item: unknown,
  regionId: string,
  dimensionId: string,
  layout: RegionLayout
): StoredRef | null {
  if (item === undefined || item === null) return null;
  // 解码硬上限（ID 以 27 槽/桶解码，容量上限 = 层数 × 6912）；可用容量由每桶可用槽数约束
  const hardLimit = layout.maxLevels * SLOTS_PER_LEVEL;
  const usable = usableSlotsPerBarrel(layout);
  for (let attempt = 0; attempt < MAX_ALLOC_RETRY; attempt++) {
    const record = port.readRecord() ?? createRegionRecord(dimensionId, layout);
    const meta = record.meta;
    // 分配前的最低洞层：分配只会触碰这一层（复用 or 移出索引）
    const lowest = meta.holeLevels[0];
    const pools: LevelPools = createLevelPools(layout.maxLevels);
    if (lowest !== undefined) pools.byLevel[lowest] = port.readLevelPool(lowest);
    const slotId = allocateSlotId(meta, pools, hardLimit, usable);
    if (slotId === null) return null; // 真满
    const pos = slotIdToPosition(slotId, layout);
    if (!pos) return null;
    // 先占位持久化：收窄 RMW 窗口内跨模组重复分配同一槽的竞态
    port.writeRecord(record);
    if (lowest !== undefined) {
      port.writeLevelPool(lowest, pools.byLevel[lowest] ?? []);
    }
    const barrel = port.ensureBarrel(pos.x, pos.y, pos.z);
    if (!barrel.ok) {
      releaseSlot(port, slotId, dimensionId, layout); // 区块未就绪：槽回归空洞池
      return null;
    }
    if (barrel.created) {
      meta.barrelCount += 1;
      port.writeRecord(record); // 提交新建桶计数
    }
    if (port.isSlotOccupied(pos.x, pos.y, pos.z, pos.slotInBarrel)) continue; // 世界已占用 → 丢弃候选
    if (!port.writeItem(pos.x, pos.y, pos.z, pos.slotInBarrel, item)) {
      releaseSlot(port, slotId, dimensionId, layout); // 新桶容器暂不可用：槽回归空洞池
      return null;
    }
    return { regionId, slotId };
  }
  return null;
}

/**
 * 回收槽位到其所在层空洞池（读改写：主记录 + 该层池）。
 * 供 put 失败回滚与 take/remove 共用。
 */
export function releaseSlot(port: PutPort, slotId: number, dimensionId: string, layout: RegionLayout): void {
  const record = port.readRecord() ?? createRegionRecord(dimensionId, layout);
  const level = levelOf(slotId);
  const pools: LevelPools = createLevelPools(layout.maxLevels);
  pools.byLevel[level] = port.readLevelPool(level);
  releaseSlotId(record.meta, pools, slotId);
  port.writeRecord(record);
  port.writeLevelPool(level, pools.byLevel[level] ?? []);
}
