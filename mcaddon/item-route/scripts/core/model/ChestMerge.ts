// ─── 双箱合并判定（纯几何规则，零 MC 依赖，可单测） ──────
// 判定"两格是否构成双箱"的纯几何部分：同维度同型、水平相邻（XZ 曼哈顿 1、Y 相同）。
// 注意：这只是**几何预筛**。真正确认"共享同一库存"由 mc 层 SafeProbe 探针完成
// （写临时物看邻居是否可见）——几何相似不代表共享容器，此处仅用于可单测的约束，
// 生产 `McContainerFactory` 已改用 SafeProbe，不再依赖实例同一性。
import { isChestType } from "./ContainerTypes";

/** 方块信息（typeId + 坐标），供双箱判定 */
export interface BlockInfo {
  typeId: string;
  x: number;
  y: number;
  z: number;
}

/** 两方块是否水平相邻（XZ 平面曼哈顿距离 1，Y 相同） */
function isHorizontallyAdjacent(a: BlockInfo, b: BlockInfo): boolean {
  if (a.y !== b.y) return false;
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return (dx === 1 && dz === 0) || (dx === 0 && dz === 1);
}

/**
 * 双箱合并判定：主箱 + 邻居列表 → 找到可合并的伙伴。
 * 规则：双方均为箱子/陷阱箱、typeId 相同、水平相邻。
 * 返回第一个匹配伙伴；无则 undefined。
 */
export function findChestPartner(primary: BlockInfo, neighbors: BlockInfo[]): BlockInfo | undefined {
  if (!isChestType(primary.typeId)) return undefined;
  return neighbors.find(
    (n) => isChestType(n.typeId) && n.typeId === primary.typeId && isHorizontallyAdjacent(primary, n)
  );
}