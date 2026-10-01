import { ItemStack, type Block, type Dimension } from "@minecraft/server";
import type { BlockLocation } from "../types";
import { hasInventory } from "./ContainerTypes";

const PROBE_ID = "minecraft:structure_void";
const NEIGHBOR_OFFSETS: BlockLocation[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function tryGetBlock(dimension: Dimension, location: BlockLocation): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

/**
 * 深度比较两个 ItemStack 是否等价。
 *
 * 比较维度：typeId、amount、nameTag（若双方均有）、lore（若双方均有）
 * 耐久度组件（durability）的 damage 值。每个维度的比较均用 try-catch 保护，
 * 单个维度不可访问时静默跳过，不影响整体判断。
 */
function sameStack(
  a: import("@minecraft/server").ItemStack | undefined,
  b: import("@minecraft/server").ItemStack | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.typeId !== b.typeId || a.amount !== b.amount) return false;

  // 比较 nameTag
  try {
    if (a.nameTag !== b.nameTag) return false;
  } catch {
    /* nameTag 不可访问时忽略 */
  }

  // 比较 lore
  try {
    const loreA = a.getLore();
    const loreB = b.getLore();
    if (loreA.length !== loreB.length) return false;
    for (let i = 0; i < loreA.length; i++) {
      if (loreA[i] !== loreB[i]) return false;
    }
  } catch {
    /* getLore 不可访问时忽略 */
  }

  // 比较耐久度组件损伤
  try {
    const durA = a.getComponent("durability") as { damage: number } | undefined;
    const durB = b.getComponent("durability") as { damage: number } | undefined;
    if ((durA?.damage ?? 0) !== (durB?.damage ?? 0)) return false;
  } catch {
    /* durability 组件不可访问时忽略 */
  }

  return true;
}

/**
 * 使用临时探针安全识别双箱另一半。
 *
 * 所有 getItem / clone 操作均在 try 保护下执行，
 * 任何访问失败都会返回 undefined，不会中断调用方的扫描流程。
 * restore 仅在探针实际写入后执行。
 *
 * @param dimension - 目标维度
 * @param location - 当前箱子位置
 * @param block - 当前箱子方块
 * @returns 另一半箱子坐标；无法确认时返回 undefined
 */
export function probeDoubleChestSafely(
  dimension: Dimension,
  location: BlockLocation,
  block: Block
): BlockLocation | undefined {
  const container = block.getComponent("inventory")?.container;
  if (!container) return undefined;

  let found: BlockLocation | undefined;
  let probeWritten = false;
  let probeSlot = 0;
  let original: import("@minecraft/server").ItemStack | undefined;

  // ── 探针准备、写入、探测 —— 所有 getItem/clone 均在 try 保护内 ──
  try {
    // 选择空槽（优先），否则使用最后一个槽位
    probeSlot = container.size - 1;
    for (let slot = 0; slot < container.size; slot++) {
      if (!container.getItem(slot)) {
        probeSlot = slot;
        break;
      }
    }

    original = container.getItem(probeSlot)?.clone();
    const probe = new ItemStack(PROBE_ID, 1);
    container.setItem(probeSlot, probe);
    probeWritten = true;

    for (const offset of NEIGHBOR_OFFSETS) {
      const neighborLocation = { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
      const neighbor = tryGetBlock(dimension, neighborLocation);
      if (!neighbor || neighbor.typeId !== block.typeId || !hasInventory(neighbor)) continue;
      const neighborContainer = neighbor.getComponent("inventory")?.container;
      if (neighborContainer?.getItem(probeSlot)?.typeId === PROBE_ID) {
        found = neighborLocation;
        break;
      }
    }
  } catch {
    return undefined;
  } finally {
    // 仅在探针实际写入后执行 restore
    if (probeWritten) {
      try {
        container.setItem(probeSlot, original);
        const restored = container.getItem(probeSlot);
        if (!sameStack(restored, original)) return undefined;
      } catch {
        return undefined;
      }
    }
  }

  return found;
}
