import type { ContainerId, StoredContainer } from "../types";

export interface WarehouseRescanDiff {
  added: ContainerId[];
  removed: ContainerId[];
  changed: ContainerId[];
  unchanged: ContainerId[];
}

/**
 * 比较两个容器的占用位置是否完全相同。
 *
 * @param a - 容器 A
 * @param b - 容器 B
 * @returns 位置列表相同时返回 true
 */
function sameLocations(a: StoredContainer, b: StoredContainer): boolean {
  if (a.occupiedLocations.length !== b.occupiedLocations.length) return false;
  return a.occupiedLocations.every((loc, index) => {
    const other = b.occupiedLocations[index];
    return loc.x === other.x && loc.y === other.y && loc.z === other.z;
  });
}

/**
 * 比较当前容器记录与重新扫描结果，返回差异摘要。
 *
 * @param current - 当前持久化的容器记录
 * @param scanned - 新扫描得到的容器记录
 * @returns 新增、移除、变化、未变的容器 ID 列表
 */
export function diffRescanContainers(
  current: Record<ContainerId, StoredContainer>,
  scanned: Record<ContainerId, StoredContainer>
): WarehouseRescanDiff {
  const added: ContainerId[] = [];
  const removed: ContainerId[] = [];
  const changed: ContainerId[] = [];
  const unchanged: ContainerId[] = [];

  for (const id of Object.keys(scanned)) {
    const old = current[id];
    if (!old) {
      added.push(id);
      continue;
    }
    const next = scanned[id];
    if (old.role !== next.role || old.enabled !== next.enabled || !sameLocations(old, next)) changed.push(id);
    else unchanged.push(id);
  }

  for (const id of Object.keys(current)) {
    if (!scanned[id]) removed.push(id);
  }

  return { added, removed, changed, unchanged };
}
