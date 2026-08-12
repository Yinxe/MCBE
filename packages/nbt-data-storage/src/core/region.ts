// ── 注册决策（纯逻辑，零 @minecraft 依赖） ────────────────────────────
// 多个模组注册到同一区域时，以"首个注册者"定下的布局为准：
//   - 世界已有该区域的持久化记录 → 采纳其 dimensionId 与 layout（后注册者传的 baseY 等被忽略），
//     但**布局参数一致性校验**：若后注册者显式传入 slotPerBarrel/maxLevels 且与记录不一致
//     （只有测试渠道会传）→ 拒绝注册。理由：同一区块共享同一批物理木桶，两套分配语义
//     会让同一 ID 指向不同物理位置（ID 漂移/错读/孤儿数据），绝不允许混用。
//   - 测试区域（test:true，仅 registerTest 创建）：正式 register 拒绝进入（防正式模组
//     数据混入可随时改参数的测试阵列）；测试渠道可对其**动态调整布局参数**（resizeLayout）
//     并在调整后重扫容器重建桶水位（rebuildUsage，对齐世界真值）。
//   - 全新区域 → 用传入参数创建（baseY 缺省 DEFAULT_BASE_Y；maxLevels 缺省 MAX_LEVELS；
//     slotPerBarrel 缺省 BARREL_SLOTS = 全部可用）
// 区域 ID 由"维度枚举 + 区块坐标"决定（不含 baseY）→ 同维度同区块必然共享同一记录/阵列，
// baseY 只是阵列在地表的高度锚点，首个注册者定下后共享。
//
// ⚠️ ID 语义恒定：slotPerBarrel 只约束"每桶可分配槽数"（分配跳过超限槽），
// 解码永远按 27 槽/桶（见 layout.ts / meta.ts）→ 已存物品的 ID 在任何配置下不漂移。

import {
  BARREL_SLOTS,
  MAX_LEVELS,
  SLOTS_PER_LEVEL,
  SLOT_PER_BARREL_MAX,
  SLOT_PER_BARREL_MIN,
  usableSlotsPerBarrel,
  validateLayout,
  type RegionLayout,
} from "./layout";
import type { PersistedRegion } from "./record";

/** 默认底层木桶 Y（末地虚空高度，避让末地主岛/黑曜石柱） */
export const DEFAULT_BASE_Y = 120;

/** 注册决策的输入（锚点已归块为区块坐标） */
export interface RegistrationInput {
  /** 本模组请求的完整维度 ID */
  dimensionId: string;
  /** 本模组请求的底层 Y（可选；仅全新区域生效） */
  baseY?: number;
  /** 本模组请求的纵向层数（可选；仅全新区域生效；仅测试渠道可传） */
  maxLevels?: number;
  /** 本模组请求的每桶可用槽数（可选；仅全新区域生效；仅测试渠道可传） */
  slotPerBarrel?: number;
  /** ⚠️ 测试区域特权标记（仅 registerTest 传入；正式 register 不传） */
  test?: boolean;
}

/** 注册决策输出：生效的维度 + 布局 */
export interface RegistrationDecision {
  dimensionId: string;
  layout: RegionLayout;
}

/**
 * 布局一致性校验：显式传入的布局参数必须与既有布局一致，否则抛错（拒绝混用）。
 * 供 resolveRegistration（持久化记录路径）与 ItemStorage 注册缓存路径共用。
 * 额外规则：既有布局是测试区域（test:true）而传入未带测试标记 → 拒绝（正式渠道不可进测试阵列）。
 */
export function assertLayoutConsistent(existing: RegionLayout, input: RegistrationInput, cx: number, cz: number): void {
  if (existing.test === true && input.test !== true) {
    throw new Error(`该区块(${cx},${cz})是测试区域（仅测试渠道 registerTest 可用），正式渠道注册被拒绝，请更换锚点`);
  }
  if (input.maxLevels !== undefined && input.maxLevels !== existing.maxLevels) {
    throw new Error(
      `该区块(${cx},${cz})已被布局（层数 ${existing.maxLevels}）占用，不一致的注册被拒绝，测试区域请更换锚点`
    );
  }
  const existingSlots = existing.slotPerBarrel ?? BARREL_SLOTS;
  if (input.slotPerBarrel !== undefined && input.slotPerBarrel !== existingSlots) {
    throw new Error(
      `该区块(${cx},${cz})已被布局（每桶 ${existingSlots} 槽）占用，不一致的注册被拒绝，测试区域请更换锚点`
    );
  }
}

/**
 * 注册决策：已有持久化记录 → 校验一致性后采纳其维度/布局；否则按传入参数新建。
 * 后注册者即便传了不同高度，也以首个注册者的布局为准（同区块共享不分裂）；
 * 但显式传入的 maxLevels/slotPerBarrel 与记录不一致时抛错（防 ID 语义混用）。
 */
export function resolveRegistration(
  persisted: PersistedRegion | undefined,
  input: RegistrationInput,
  chunk: { cx: number; cz: number }
): RegistrationDecision {
  const dimensionId = persisted?.dimensionId ?? input.dimensionId;
  if (persisted) {
    assertLayoutConsistent(persisted.layout, input, chunk.cx, chunk.cz);
  }
  const layout: RegionLayout = persisted?.layout ?? {
    chunkX: chunk.cx,
    chunkZ: chunk.cz,
    baseY: input.baseY ?? DEFAULT_BASE_Y,
    maxLevels: input.maxLevels ?? MAX_LEVELS,
    slotPerBarrel: input.slotPerBarrel ?? BARREL_SLOTS,
    test: input.test,
  };
  return { dimensionId, layout };
}

// ── 测试区域布局动态调整（resizeLayout）+ 桶水位重建（rebuildUsage） ──

/** resizeLayout 依赖的端口：区域记录 + 桶水位读改写 */
export interface ResizePort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  /** 读某层桶水位（占用计数数组；缺失 → 空数组） */
  readLevelUsage(level: number): number[];
}

/** 布局调整补丁：只传要改的字段（未传保持原值） */
export interface ResizePatch {
  /** 纵向层数（1..64） */
  maxLevels?: number;
  /** 每桶可分配槽位上限（0..27；0 = 容量 0 的"瞬满"测试布局） */
  slotPerBarrel?: number;
}

/**
 * 动态调整测试区域布局参数（层数 / 每桶槽数）。**仅 test:true 区域可用**。
 * 解码恒按 27 槽/桶，调整不影响任何已有 slotId 的解码——已存物品永远安全：
 * - 层数增大：任意（≤64，顶部 ≤320），后续分配向新层推进；
 * - 层数减小：仅当被裁层**无任何物化木桶**（水位长度 = 0，含空桶——空桶也占
 *   物理空间，不能裁出常加载范围），否则拒绝防孤儿；
 * - 每桶槽数：0..27 任意调整（缩小时已占用的超限槽保留可读，只是不再分配；
 *   水位遗留由调用方在调整后执行 rebuildUsage 重扫容器对齐真值）。
 *
 * @returns null=成功；字符串=面向玩家的中文拒绝原因
 */
export function resizeLayout(port: ResizePort, layout: RegionLayout, patch: ResizePatch): string | null {
  if (layout.test !== true)
    return "该区域非测试区域，无法动态调整参数（仅 registerTest 创建的测试区域可调，正式区域请更换锚点）";
  const newMaxLevels = patch.maxLevels ?? layout.maxLevels;
  const newSlotPerBarrel = patch.slotPerBarrel ?? layout.slotPerBarrel ?? BARREL_SLOTS;
  if (!Number.isInteger(newMaxLevels) || newMaxLevels < 1 || newMaxLevels > MAX_LEVELS) {
    return `maxLevels 必须为 1..${MAX_LEVELS} 的整数`;
  }
  if (
    !Number.isInteger(newSlotPerBarrel) ||
    newSlotPerBarrel < SLOT_PER_BARREL_MIN ||
    newSlotPerBarrel > SLOT_PER_BARREL_MAX
  ) {
    return `slotPerBarrel 必须为 ${SLOT_PER_BARREL_MIN}..${SLOT_PER_BARREL_MAX} 的整数`;
  }
  if (newMaxLevels === layout.maxLevels && newSlotPerBarrel === (layout.slotPerBarrel ?? BARREL_SLOTS)) return null; // 无变化
  const candidate: RegionLayout = { ...layout, maxLevels: newMaxLevels, slotPerBarrel: newSlotPerBarrel };
  const invalid = validateLayout(candidate);
  if (invalid) return invalid; // 含阵列顶部超世界上限

  const record = port.readRecord();
  if (!record) return "该区域尚无持久化记录，无法调整参数（请先注册）";
  if (newMaxLevels < layout.maxLevels) {
    for (let l = newMaxLevels; l < layout.maxLevels; l++) {
      const usage = port.readLevelUsage(l);
      if (usage.some((u) => u > 0) || usage.length > 0) {
        return `无法缩减层数：高层（第 ${l + 1} 层）仍有物化木桶/物品，请先取出高层物品或保持 ${layout.maxLevels} 层`;
      }
    }
  }
  port.writeRecord({ ...record, layout: candidate });
  return null;
}

/** rebuildUsage 依赖的端口：区域记录 + 按层桶水位读改写 + 世界槽位探测 */
export interface RebuildPort {
  readRecord(): PersistedRegion | undefined;
  writeRecord(record: PersistedRegion): void;
  /** 读某层桶水位（占用计数数组） */
  readLevelUsage(level: number): number[];
  /** 写某层桶水位 */
  writeLevelUsage(level: number, usage: number[]): void;
  /** 世界真值：该槽位当前是否有物品（O(1) 解码 + 容器访问） */
  probeSlot(slotId: number): boolean;
}

/**
 * 重扫全部已物化桶，按**世界真值**重建每层桶水位（占用计数对齐）：
 * - 只扫"可用槽"（桶内索引 < slotPerBarrel），跳过不可分配槽；
 * - usage[b] = 该桶实际占用件数（探测真值）——水位与参数/世界真值完全对齐；
 * - 桶内探测全空（桶已空）→ 计数 0（桶常驻不回收，分配时跳过）；
 * - 桶水位长度（= 物化桶数）不变——不物化、不销毁任何方块。
 * 供测试区域 resizeLayout 后调用（一次性 O(物化桶×可用槽) 扫描，非热路径）。
 * 缩层已被 resizeLayout 保证被裁层无物化桶，故扫描范围始终落在新层数内。
 */
export function rebuildUsage(port: RebuildPort, layout: RegionLayout): void {
  const record = port.readRecord();
  if (!record) return;
  const usable = usableSlotsPerBarrel(layout);
  for (let level = 0; level < layout.maxLevels; level++) {
    const usage = port.readLevelUsage(level);
    for (let b = 0; b < usage.length; b++) {
      let count = 0;
      for (let j = 0; j < usable; j++) {
        const slotId = level * SLOTS_PER_LEVEL + b * BARREL_SLOTS + j;
        if (port.probeSlot(slotId)) count++;
      }
      if (count !== usage[b]) {
        usage[b] = count;
        port.writeLevelUsage(level, usage);
      }
    }
  }
}
