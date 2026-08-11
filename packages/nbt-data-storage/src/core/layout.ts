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

/** 单个木桶的槽位数 */
export const BARREL_SLOTS = 27;
/** 区块水平边长（阵列每个层面占满一个区块） */
export const LEVEL_EDGE = 16;
/** 每层木桶数 = 16×16 = 256 */
export const BARRELS_PER_LEVEL = LEVEL_EDGE * LEVEL_EDGE;
/** 每层槽位数 = 256 桶 × 27 槽 */
export const SLOTS_PER_LEVEL = BARRELS_PER_LEVEL * BARREL_SLOTS;
/** 阵列默认纵向层数（固定，无需配置）：0..63 层 → 容量 442368 槽；不够再注册新集群 */
export const MAX_LEVELS = 64;

/** 存储区域布局（不可变几何参数；由首个注册该区块的模组定下，后续模组共享） */
export interface RegionLayout {
  /** 锚定区块坐标 X */
  readonly chunkX: number;
  /** 锚定区块坐标 Z */
  readonly chunkZ: number;
  /** 最底层木桶的 Y 坐标 */
  readonly baseY: number;
  /** 纵向木桶层数上限 */
  readonly maxLevels: number;
}

/** 一个槽位解码后的物理位置（物化木桶 / 读写容器用） */
export interface SlotPosition {
  x: number;
  y: number;
  z: number;
  /** 木桶内槽位索引 0..26 */
  slotInBarrel: number;
}

/** 阵列理论总槽位数（= 最满时的容量上限） */
export function capacityOf(layout: RegionLayout): number {
  return layout.maxLevels * SLOTS_PER_LEVEL;
}

/** slotId 是否落在有效范围 [0, capacity) 内 */
export function isValidSlotId(slotId: number, layout: RegionLayout): boolean {
  return Number.isInteger(slotId) && slotId >= 0 && slotId < capacityOf(layout);
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

/**
 * 布局合法性校验。合法返回 null，否则返回面向玩家的中文错误消息。
 * 边界约束：baseY ≥ 0 且阵列顶部不超过世界上限 320（含）。
 */
export function validateLayout(layout: RegionLayout): string | null {
  if (!Number.isInteger(layout.chunkX) || !Number.isInteger(layout.chunkZ)) {
    return "区块坐标必须为整数";
  }
  if (!Number.isInteger(layout.baseY) || layout.baseY < 0) {
    return "baseY 必须为非负整数";
  }
  if (!Number.isInteger(layout.maxLevels) || layout.maxLevels < 1) {
    return "maxLevels 必须为 >= 1 的整数";
  }
  const topY = layout.baseY + layout.maxLevels - 1;
  if (topY > 320) {
    return `阵列顶部 Y(${topY}) 超过世界上限 320，请降低 baseY 或 maxLevels`;
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
