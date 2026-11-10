// ── 存储阵列几何布局（纯计算，零 @minecraft 依赖） ────────────────────────
// 一个存储区域锚定在一个区块（16×16 水平面）上，纵向向上堆叠若干层木桶；
// 每个格子 = 一个木桶槽位，持有一个 ItemStack（完整 NBT）。
//
// 槽位 ID 采用稠密编号（0 起），纯算术 O(1) 解码到物理位置：
//   slotInBarrel = slotId % 27
//   barrelLocal  = floor(slotId / 27) % 256          // 区块内木桶序号 0..255
//   level        = floor(slotId / (27*256))          // 纵向层号 0..maxLevels-1
//   x = chunkX*16 + (barrelLocal % 16)
//   z = chunkZ*16 + floor(barrelLocal / 16)
//   y = baseY + level
// 解码全程纯整数运算，无查表 → O(1) 秒定位容器与槽位。
//
// ⚠️ ID 语义恒定：解码**永远按 27 槽/桶**，不随布局参数漂移。`slotPerBarrel`
// 只是**每桶可分配槽位上限**（测试渠道用，默认 27 = 全部可用）：分配时跳过
// 桶内索引 ≥ 上限的槽位，但 ID 仍按 27 解码——已存物品的 ID 在任何配置下
// 都指向同一物理位置，永不偏移（见 put.allocateCandidate 的跳过逻辑）。
// 测试区域（test:true）可在 resize 后经 rebuildUsage 重扫容器重建桶水位，
// 保证"每桶可用槽数/层数"动态调整后分配状态与参数一致。

/** 单个木桶的槽位数（解码公式恒用此值，永不参数化） */
export const BARREL_SLOTS = 27;
/** 区块水平边长（阵列每个层面占满一个区块） */
export const LEVEL_EDGE = 16;
/** 每层木桶数 = 16×16 = 256 */
export const BARRELS_PER_LEVEL = LEVEL_EDGE * LEVEL_EDGE;
/** 每层槽位数 = 256 桶 × 27 槽 */
export const SLOTS_PER_LEVEL = BARRELS_PER_LEVEL * BARREL_SLOTS;
/** 阵列默认纵向层数（固定，无需配置）：0..63 层 → 容量 442368 槽；不够再注册新集群 */
export const MAX_LEVELS = 64;
/** 每桶可分配槽位上限的合法范围（0..27；0 = 容量 0 的"瞬满"测试布局；仅测试渠道可配） */
export const SLOT_PER_BARREL_MIN = 0;
export const SLOT_PER_BARREL_MAX = BARREL_SLOTS;

/** 存储区域布局（几何参数；由首个注册该区块的模组定下，后续模组共享；测试区域可调） */
export interface RegionLayout {
  /** 锚定区块坐标 X */
  readonly chunkX: number;
  /** 锚定区块坐标 Z */
  readonly chunkZ: number;
  /** 最底层木桶的 Y 坐标 */
  readonly baseY: number;
  /** 纵向木桶层数上限（1..64，默认 64；仅测试渠道可配，可动态调整） */
  readonly maxLevels: number;
  /**
   * 每桶可分配槽位上限（0..27，缺省 27）。**仅测试渠道（registerTest）可配**：
   * 解码恒按 27 槽/桶，此值只让分配跳过桶内超限槽位（见 put.allocateCandidate），
   * 用于快速模拟满容量/见证扩容；0 = 容量 0（put 全拒，瞬见"已满"）。
   * 正式 register 不传此值。
   */
  readonly slotPerBarrel?: number;
  /** ⚠️ 测试区域特权标记（仅 registerTest 创建；正式 register 拒绝进入；可动态调整布局参数） */
  readonly test?: boolean;
}

/** 一个槽位解码后的物理位置（物化木桶 / 读写容器用） */
export interface SlotPosition {
  x: number;
  y: number;
  z: number;
  /** 木桶内槽位索引 0..26 */
  slotInBarrel: number;
}

/** 该布局每桶实际可分配的槽位数（缺省 27 = 全部可用） */
export function usableSlotsPerBarrel(layout: RegionLayout): number {
  return layout.slotPerBarrel ?? BARREL_SLOTS;
}

/** 阵列理论总槽位数（= 最满时的可用容量上限；解码上限仍是 27×256×层） */
export function capacityOf(layout: RegionLayout): number {
  return layout.maxLevels * BARRELS_PER_LEVEL * usableSlotsPerBarrel(layout);
}

/** 阵列满容量时的木桶总数（静态可预知：层数 × 每层 256 桶） */
export function totalBarrelsOf(layout: RegionLayout): number {
  return layout.maxLevels * BARRELS_PER_LEVEL;
}

/** 解码范围上限（物理可寻址的槽位数 = 层数 × 每层 27×256 槽；与可用容量无关） */
export function decodeCapacityOf(layout: RegionLayout): number {
  return layout.maxLevels * SLOTS_PER_LEVEL;
}

/** slotId 是否落在有效解码范围 [0, decodeCapacityOf) 内（恒按 27 槽/桶判定，不受 slotPerBarrel 影响） */
export function isValidSlotId(slotId: number, layout: RegionLayout): boolean {
  return Number.isInteger(slotId) && slotId >= 0 && slotId < decodeCapacityOf(layout);
}

/**
 * 槽位 ID → 物理位置（O(1) 纯算术）。越界/非法返回 null。
 * 这是取物/取物的核心寻址：给 ID 立即得到木桶坐标与槽内索引。
 */
export function slotIdToPosition(slotId: number, layout: RegionLayout): SlotPosition | null {
  if (!isValidSlotId(slotId, layout)) return null;
  const slotInBarrel = slotId % BARREL_SLOTS;
  const rest = Math.floor(slotId / BARREL_SLOTS);
  const barrelLocal = rest % BARRELS_PER_LEVEL;
  const level = Math.floor(rest / BARRELS_PER_LEVEL);
  return {
    x: layout.chunkX * LEVEL_EDGE + (barrelLocal % LEVEL_EDGE),
    z: layout.chunkZ * LEVEL_EDGE + Math.floor(barrelLocal / LEVEL_EDGE),
    y: layout.baseY + level,
    slotInBarrel,
  };
}

/** slotId 所在纵向层号（0 起） */
export function levelOf(slotId: number): number {
  return Math.floor(slotId / SLOTS_PER_LEVEL);
}

/** slotId 对应的全局木桶序号（0..capacity/27-1） */
export function barrelIndexOf(slotId: number): number {
  return Math.floor(slotId / BARREL_SLOTS);
}

/** 容纳到指定 slotId（含）所需物化的木桶数 */
export function materializedBarrelsFor(slotId: number): number {
  return barrelIndexOf(slotId) + 1;
}

/** 各维度世界高度约束（1.18+ 世界高度；y 轴合法范围，含两端） */
export interface WorldHeightRange {
  /** 最低可放置 Y（含） */
  minY: number;
  /** 最高可放置 Y（含） */
  maxY: number;
}

/**
 * 按维度 ID 查世界高度约束。**只有主世界能到 320**：
 * - 主世界：-64..320（384 层，向下挖到基岩、向上到建筑上限）；
 * - 下界：0..128（矮且浅，Y<0 是虚空不能放方块）；
 * - 末地：0..256（主岛浮空，Y<0 是虚空）。
 * 未知维度（自定义维度，无官方约束）→ undefined（不做额外高度校验）。
 */
export function worldHeightRangeOf(dimensionId: string): WorldHeightRange | undefined {
  switch (dimensionId) {
    case "minecraft:overworld":
      return { minY: -64, maxY: 320 };
    case "minecraft:nether":
      return { minY: 0, maxY: 128 };
    case "minecraft:the_end":
      return { minY: 0, maxY: 256 };
    default:
      return undefined;
  }
}

/**
 * 布局合法性校验。合法返回 null，否则返回面向玩家的中文错误消息。
 * 高度边界按维度（见 `worldHeightRangeOf`）；`dimensionId` 省略时按主世界
 * （-64..320，最宽范围，不误拒）。
 */
export function validateLayout(layout: RegionLayout, dimensionId?: string): string | null {
  if (!Number.isInteger(layout.chunkX) || !Number.isInteger(layout.chunkZ)) {
    return "区块坐标必须为整数";
  }
  const range = dimensionId === undefined ? { minY: -64, maxY: 320 } : worldHeightRangeOf(dimensionId);
  if (!Number.isInteger(layout.baseY)) {
    return "baseY 必须为整数";
  }
  if (range !== undefined && layout.baseY < range.minY) {
    return `baseY(${layout.baseY}) 低于维度 ${dimensionId ?? "主世界"} 的世界最低层 ${range.minY}`;
  }
  if (!Number.isInteger(layout.maxLevels) || layout.maxLevels < 1 || layout.maxLevels > MAX_LEVELS) {
    return `maxLevels 必须为 1..${MAX_LEVELS} 的整数`;
  }
  if (layout.slotPerBarrel !== undefined) {
    if (
      !Number.isInteger(layout.slotPerBarrel) ||
      layout.slotPerBarrel < SLOT_PER_BARREL_MIN ||
      layout.slotPerBarrel > SLOT_PER_BARREL_MAX
    ) {
      return `slotPerBarrel 必须为 ${SLOT_PER_BARREL_MIN}..${SLOT_PER_BARREL_MAX} 的整数（仅测试渠道可用）`;
    }
  }
  const topY = layout.baseY + layout.maxLevels - 1;
  if (range !== undefined && topY > range.maxY) {
    return `阵列顶部 Y(${topY}) 超出维度 ${dimensionId ?? "主世界"} 的世界高度上限 ${range.maxY}，请降低 baseY 或 maxLevels`;
  }
  return null;
}

/** 块坐标 → 所在区块坐标。JS `Math.floor` 对负数精确归块：区块 c 覆盖块 [16c, 16c+15] */
export function chunkFromBlock(coord: number): number {
  return Math.floor(coord / 16);
}

/** 任意锚点坐标（块内，可带小数）→ 所在区块坐标（四象限/边界都精确归块） */
export function chunkFromAnchor(x: number, z: number): { cx: number; cz: number } {
  return { cx: chunkFromBlock(x), cz: chunkFromBlock(z) };
}
