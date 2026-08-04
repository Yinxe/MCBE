// ─── 双箱安全探针（v1 SafeProbe 移植）：临时物探测共享容器 ──
// 不依赖 mc API 的容器实例同一性（两半不一定共享同一 Container 实例），
// 而是写入临时探针物品，观察相邻同型箱子是否"看到"它 → 判定共享同一库存。
// 写前 clone 原件、写完恢复 + sameStack 深度校验；任何失败静默返回 undefined。
import { ItemStack, type Block, type Dimension } from "@minecraft/server";

const PROBE_ID = "minecraft:structure_void";
const NEIGHBOR_OFFSETS: Array<{ x: number; y: number; z: number }> = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 },
];

function tryGetBlock(dimension: Dimension, location: { x: number; y: number; z: number }): Block | undefined {
  try {
    return dimension.getBlock(location);
  } catch {
    return undefined;
  }
}

/** 深度比较两个 ItemStack 是否等价（typeId/amount/lore/耐久；逐维 try-catch） */
function sameStack(a: ItemStack | undefined, b: ItemStack | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.typeId !== b.typeId || a.amount !== b.amount) return false;
  try {
    const loreA = a.getLore();
    const loreB = b.getLore();
    if (loreA.length !== loreB.length) return false;
    for (let i = 0; i < loreA.length; i++) if (loreA[i] !== loreB[i]) return false;
  } catch {
    /* lore 不可访问时忽略 */
  }
  try {
    const durA = a.getComponent("durability") as { damage: number } | undefined;
    const durB = b.getComponent("durability") as { damage: number } | undefined;
    if ((durA?.damage ?? 0) !== (durB?.damage ?? 0)) return false;
  } catch {
    /* durability 不可访问时忽略 */
  }
  return true;
}

/**
 * 探测 double chest 另一半：写入临时探针物 → 检查水平同型邻居是否可见 → 恢复原件。
 * 返回共享同一库存的邻居坐标；无法确认时返回 undefined（不冒险合并）。
 */
export function probeDoubleChestSafely(
  dimension: Dimension,
  location: { x: number; y: number; z: number },
  block: Block
): { x: number; y: number; z: number } | undefined {
  const container = block.getComponent("inventory")?.container;
  if (!container) return undefined;

  let found: { x: number; y: number; z: number } | undefined;
  let probeWritten = false;
  let probeSlot = 0;
  let original: ItemStack | undefined;

  try {
    // 优先选空槽（从 0 起），否则用最后一格
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
      const neighborLoc = { x: location.x + offset.x, y: location.y + offset.y, z: location.z + offset.z };
      const neighbor = tryGetBlock(dimension, neighborLoc);
      if (!neighbor || neighbor.typeId !== block.typeId) continue;
      const neighborContainer = neighbor.getComponent("inventory")?.container;
      if (neighborContainer?.getItem(probeSlot)?.typeId === PROBE_ID) {
        found = neighborLoc;
        break;
      }
    }
  } catch {
    return undefined;
  } finally {
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