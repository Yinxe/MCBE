// ─── 区域容器扫描（rescan：遍历仓库区域补注册容器） ─────────
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
import { registerContainer } from "../../core/model/ContainerRegistry";
import type { WarehouseArea } from "../../core/model/Warehouse";
import type { Warehouse } from "../../core/model/Warehouse";
import type { Container } from "../../core/model/Container";
import type { ItemIndex } from "../../core/index/ItemIndex";
import type { McContainerFactory } from "../adapters/McContainerFactory";

/** 单次扫描体积上限（避免大区域造成瞬时高负载） */
export const MAX_SCAN_VOLUME = 40_000;

export interface RescanResult {
  scanned: number;
  registered: number;
  skipped: boolean;
}

/**
 * 遍历仓库区域，将支持的容器方块注册进仓库 + 索引。
 * 体积上限内逐块探测；超限则跳过（需玩家缩小区域或手动放置注册）。
 * `index` 为该仓库当前加载的索引（隔离；未激活时为 undefined → 只注册容器、
 * 跳过索引增量，由索引懒加载/惰性校验兜底）。
 */
export function scanWarehouseArea(
  dimension: { getBlock(loc: { x: number; y: number; z: number }): { typeId: string } | undefined },
  area: WarehouseArea,
  factory: McContainerFactory,
  index: ItemIndex | undefined,
  warehouse: Warehouse,
  /** 单仓最大容器数（v1 maxContainers 校验；超限停止注册新增） */
  maxContainers: number,
  /** 持久化本次**新增**的容器（最小单位：只写新增容器 + 同步索引），added 为本次注册列表 */
  persist: (warehouse: Warehouse, added: Container[]) => void
): RescanResult {
  const minX = Math.min(area.corner1.x, area.corner2.x);
  const maxX = Math.max(area.corner1.x, area.corner2.x);
  const minY = Math.min(area.corner1.y, area.corner2.y);
  const maxY = Math.max(area.corner1.y, area.corner2.y);
  const minZ = Math.min(area.corner1.z, area.corner2.z);
  const maxZ = Math.max(area.corner1.z, area.corner2.z);
  const volume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
  if (volume > MAX_SCAN_VOLUME) return { scanned: 0, registered: 0, skipped: true };

  const added: Container[] = [];
  let registered = 0;
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        // 容器数达上限 → 停止注册新增（v1 assertContainerCount 的扫描侧校验）
        if (warehouse.containers.size + registered >= maxContainers) {
          return { scanned: volume, registered, skipped: true };
        }
        const block = dimension.getBlock({ x, y, z });
        if (block === undefined || !isSupportedContainerType(block.typeId)) continue;
        const container = factory.create(
          block as Parameters<McContainerFactory["create"]>[0],
          warehouse.settings.defaultContainerRole
        );
        if (container === undefined) continue;
        container.enabled = warehouse.settings.defaultContainerEnabled; // 与放置路径口径一致
        if (warehouse.containers.has(container.id)) continue;
        registerContainer(warehouse, container);
        index?.onContainerAdded(container);
        added.push(container);
        registered++;
      }
    }
  }
  if (added.length > 0) persist(warehouse, added);
  return { scanned: volume, registered, skipped: false };
}
