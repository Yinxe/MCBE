// ── 存入编排（纯逻辑，零 @minecraft 依赖） ────────────────────────────
// 把 `put` 的"找未满桶 → 桶内探测空槽 → 物化 → 写入"全流程从 mc 适配层
// 下沉到 core，通过 PutPort 注入世界/持久化副作用 → 可脱离游戏 mock 单测。
//
// **桶水位设计**（v3，取代 v2 空洞池）：
//   - 每层一条"桶水位"：已物化桶的占用计数数组 usage[]（元素 0..usable，
//     length = 该层已物化桶数）。计数只是**快速过滤**（usage[b] < usable ⇔ 未满），
//     本身不记录任何空槽 ID；
//   - 分配：从桶 0 线性找第一个未满桶 → 桶内扫描 `usable` 个槽位探测
//     世界真值 → 第一个空槽写入（真值权威：计数失真/外部干扰都被探测兜底，
//     绝不覆盖占用槽）；全部桶满 → 物化该层下一新桶；
//   - 物化位置被非木桶方块占用 → 计数置 usable（伪满标记）永久跳过该位置，
//     绝不替换他人方块；
//   - 占位即写（usage 变更立刻落盘）：收窄跨模组 RMW 竞态窗口。
// 语义（以世界为真值，绝不覆盖他人物品）：
//   - 候选槽被世界占用 → 丢弃候选、重试下一候选（有界，不覆盖）；
//   - 物化/写入失败（区块未就绪、新桶容器暂不可用）→ 回滚该桶计数并返回 null，
//     由调用方下个周期重试（不烧计数、不丢槽）；
//   - 真正 setBlockType 建了新桶 → meta.barrelCount +1。
import type { RegionLayout } from "./layout";
import { BARREL_SLOTS, BARRELS_PER_LEVEL, SLOTS_PER_LEVEL, levelOf, slotIdToPosition, usableSlotsPerBarrel } from "./layout";
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
  /**
   * 读某层"每桶已用格数"账本（数组元素 0..usable，长度 = 该层已建桶数）。
   * 缺失/损坏 → 空数组（= 从未建桶）。
   */
  readLevelUsage(level: number): number[];
  /** 写某层账本 */
  writeLevelUsage(level: number, usage: number[]): void;
  /**
   * 物化/确认木桶存在（幂等）。返回是否就绪 + 本次是否新建了桶 + 位置是否被
   * **非木桶方块占用**（occupied=true 表示该位置有其它方块/容器——调用方必须
   * 跳过该候选，**绝不能替换他人方块**；建桶只发生在空气/已是木桶的位置）。
   */
  ensureBarrel(x: number, y: number, z: number): { ok: boolean; created: boolean; occupied?: boolean };
  /**
   * 在一个木桶里找第一个空格子（性能优化，可选）：一次取容器、循环查格，
   * 返回格子号 0..usable-1；无空格子/位置异常（非木桶、区块未加载）→ null。
   * 未提供时回退逐格 `isSlotOccupied`（逻辑一致，只是慢一些）。
   */
  findEmptySlotInBarrel?(x: number, y: number, z: number, usable: number): number | null;
  /** 该槽位是否已被世界占用（真值检查；无法确认保守视为占用） */
  isSlotOccupied(x: number, y: number, z: number, slotInBarrel: number): boolean;
  /** 把物品写入槽位（物品为不透明引用）；成功返回 true */
  writeItem(x: number, y: number, z: number, slotInBarrel: number, item: unknown): boolean;
}

/** 读取某层桶水位并归一化（非法元素清 0、超长截断；不强制写回，下次写时自然修正） */
export function normalizeUsage(raw: number[] | undefined, layout: RegionLayout): number[] {
  if (!raw) return [];
  const usable = usableSlotsPerBarrel(layout);
  const usage = raw.slice(0, BARRELS_PER_LEVEL); // 解码硬上限：每层最多 256 桶
  const out: number[] = new Array(usage.length);
  for (let i = 0; i < usage.length; i++) {
    const v = usage[i];
    // 非法元素（缺失/负数/非整数）清 0；超载（布局调小后的旧计数）clamp 到可用上限
    out[i] = v === undefined || !Number.isInteger(v) || v < 0 ? 0 : Math.min(v, usable);
  }
  return out;
}

/**
 * 存入编排（有界重试）：成功返回取物凭据 `{ regionId, slotId }`，满/失败返回 null。
 * 分配流程（见文件头注释）：账本定位未满桶 → 桶内找空格子 → 占位写账本 →
 * 建桶（如需要）→ 写入物品；失败回滚计数。
 */
export function putItem(
  port: PutPort,
  item: unknown,
  regionId: string,
  dimensionId: string,
  layout: RegionLayout
): StoredRef | null {
  if (item === undefined || item === null) return null;
  const usable = usableSlotsPerBarrel(layout);
  if (usable <= 0) return null; // 瞬满布局：无可用槽
  for (let attempt = 0; attempt < MAX_ALLOC_RETRY; attempt++) {
    const candidate = allocateCandidate(port, layout, usable);
    if (!candidate) return null; // 真满
    const { slotId, createdBarrel } = candidate;
    const pos = slotIdToPosition(slotId, layout);
    if (!pos) {
      decrementUsage(port, slotId, layout); // 回滚占位（理论不可达）
      return null;
    }
    if (createdBarrel) {
      // 建桶成功：提交新建桶计数（读改写，窄竞态窗口；无物化时不读主记录）
      const rec = port.readRecord() ?? createRegionRecord(dimensionId, layout);
      rec.meta.barrelCount += 1;
      port.writeRecord(rec);
    }
    if (!port.writeItem(pos.x, pos.y, pos.z, pos.slotInBarrel, item)) {
      decrementUsage(port, slotId, layout); // 写入失败：回滚占位，槽留给下轮重试
      return null;
    }
    return { regionId, slotId };
  }
  return null;
}

/**
 * 候选分配（一轮）：账本扫描 + 看实物找空格 + 必要时建新桶，找到即占位写回账本。
 * - 已建桶（usage.length）：从桶 0 找第一个 usage[b] < usable 的桶，
 *   桶内找第一个空格子（`findEmptySlotInBarrel`，一次取容器循环查格）→ 计数 +1 返回；
 *   （计数未满但桶内全是东西 = 计数失真/外部塞满 → 计数修正为 usable 跳过）
 * - 全部已建桶满 → 建该层下一新桶（位置 = usage.length）：
 *   * 位置被非木桶方块占用 → 计数置 usable（伪满）永久跳过，继续下一位置；
 *   * 建桶成功 → 桶内找空格子（理论全空，外部干扰兜底）→ 计数 1 返回；
 * - 全部层满 → null。
 * @returns { slotId, createdBarrel } 找到可用槽（已占位）；null = 全满
 */
function allocateCandidate(
  port: PutPort,
  layout: RegionLayout,
  usable: number
): { slotId: number; createdBarrel: boolean } | null {
  for (let level = 0; level < layout.maxLevels; level++) {
    const base = level * SLOTS_PER_LEVEL;
    const usage = normalizeUsage(port.readLevelUsage(level), layout);
    // 已建桶：找未满桶 + 桶内找空格子
    for (let b = 0; b < usage.length; b++) {
      if (usage[b]! >= usable) continue;
      const pos0 = slotIdToPosition(base + b * BARREL_SLOTS, layout);
      if (!pos0) break;
      const empty = port.findEmptySlotInBarrel
        ? port.findEmptySlotInBarrel(pos0.x, pos0.y, pos0.z, usable)
        : scanEmptySlot(port, pos0.x, pos0.y, pos0.z, usable);
      if (empty !== null && empty < usable) {
        usage[b]! += 1;
        port.writeLevelUsage(level, usage); // 占位即写：收窄竞态窗口
        return { slotId: base + b * BARREL_SLOTS + empty, createdBarrel: false };
      }
      // 计数未满但桶内没有空格（计数失真/外部塞满）→ 修正为满，跳过该桶
      usage[b] = usable;
      port.writeLevelUsage(level, usage);
    }
    // 已建桶全满 → 建该层新桶（跳过被外部方块占用的候选位置）
    for (;;) {
      if (usage.length >= BARRELS_PER_LEVEL) break; // 该层物理满
      const pos = slotIdToPosition(base + usage.length * BARREL_SLOTS, layout);
      if (!pos) return null;
      const barrel = port.ensureBarrel(pos.x, pos.y, pos.z);
      if (barrel.occupied) {
        usage.push(usable); // 位置被他人方块占用：伪满标记永久跳过
        port.writeLevelUsage(level, usage);
        continue;
      }
      if (!barrel.ok) return null; // 区块未就绪：本轮放弃（不烧计数）
      const newBarrelIndex = usage.length; // push 前的长度 = 新桶序号
      if (barrel.created) {
        // 刚物化的桶必空（同 tick 内外部无法插入物品）——直接写槽 0，跳过探测。
        // 探测反而有害：setBlockType 后同 tick 容器组件可能尚未就绪，误判"被塞满"
        // → 伪满占位 → 下一个位置再物化（barrelCount 虚增，出现"桶 257/256"）。
        usage.push(1);
        port.writeLevelUsage(level, usage);
        return { slotId: base + newBarrelIndex * BARREL_SLOTS, createdBarrel: true };
      }
      // 位置已有木桶（旧数据/外部建桶）：桶内找空格子（已存在的桶容器通常就绪）
      const empty = port.findEmptySlotInBarrel
        ? port.findEmptySlotInBarrel(pos.x, pos.y, pos.z, usable)
        : scanEmptySlot(port, pos.x, pos.y, pos.z, usable);
      if (empty !== null && empty < usable) {
        usage.push(1); // 新桶登记：占用 1（该槽）
        port.writeLevelUsage(level, usage);
        return { slotId: base + newBarrelIndex * BARREL_SLOTS + empty, createdBarrel: false };
      }
      // 位置木桶被外部塞满（几乎不可能）→ 伪满，继续下一位置
      usage.push(usable);
      port.writeLevelUsage(level, usage);
    }
  }
  return null;
}

/** 回退实现：逐格探测找第一个空格子（未提供 findEmptySlotInBarrel 时用，逻辑一致） */
function scanEmptySlot(
  port: PutPort,
  x: number,
  y: number,
  z: number,
  usable: number
): number | null {
  for (let j = 0; j < usable; j++) {
    if (!port.isSlotOccupied(x, y, z, j)) return j;
  }
  return null;
}

/**
 * 回收一个槽位：所在桶占用计数 -1（幂等：计数 0/桶未登记/超限槽忽略）。
 * 供 put 失败回滚与 take/remove 共用。**空槽不计**：槽本空（外部取走）时
 * 计数保持虚高，由巡检对齐/分配探测自校正，取物不触碰计数。
 */
export function decrementUsage(port: PutPort, slotId: number, layout: RegionLayout): void {
  const level = levelOf(slotId);
  const local = slotId - level * SLOTS_PER_LEVEL;
  const b = Math.floor(local / BARREL_SLOTS);
  const j = local % BARREL_SLOTS;
  if (j >= usableSlotsPerBarrel(layout)) return; // 超限槽：从未计数
  const usage = port.readLevelUsage(level);
  if (b >= usage.length) return; // 桶未登记
  if (usage[b]! > 0) usage[b] = usage[b]! - 1;
  port.writeLevelUsage(level, usage);
}