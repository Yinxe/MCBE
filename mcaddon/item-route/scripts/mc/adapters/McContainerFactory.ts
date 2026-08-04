// ─── 容器工厂：Block → McContainerAdapter（双箱合并/漏斗约束/安全访问） ──
import type { Block } from "@minecraft/server";
import { isChestType, isHopperType, isSupportedContainerType } from "../../core/model/ContainerTypes";
import { findChestPartner, type BlockInfo } from "../../core/model/ChestMerge";
import type { ContainerRole } from "../../core/model/Container";
import type { Location } from "../../core/model/types";
import { McContainerAdapter } from "./McContainerAdapter";
import type { McItemAdapter } from "./McItemAdapter";

const INVENTORY_COMPONENT = "minecraft:inventory";

export class McContainerFactory {
  constructor(private readonly item: McItemAdapter) {}

  /**
   * 方块 → 概念容器适配器。
   * - 双箱：水平相邻同类型箱子共享同一 mc.Container 实例 → occupiedLocations 含两半
   * - 漏斗：角色强制 input
   * - 返回 undefined：类型不支持/无 inventory 组件/访问失败
   */
  create(block: Block, role: ContainerRole): McContainerAdapter | undefined {
    try {
      const typeId = block.typeId;
      if (!isSupportedContainerType(typeId)) return undefined;
      const inv = block.getComponent(INVENTORY_COMPONENT)?.container;
      if (inv === undefined) return undefined;

      const loc: Location = { x: block.location.x, y: block.location.y, z: block.location.z };
      const occupied: Location[] = [loc];

      if (isChestType(typeId)) {
        const partner = this.findPartner(block);
        if (partner !== undefined) {
          const partnerInv = partner.getComponent(INVENTORY_COMPONENT)?.container;
          if (partnerInv !== undefined && partnerInv === inv) {
            occupied.push({ x: partner.location.x, y: partner.location.y, z: partner.location.z });
          }
        }
      }

      const finalRole: ContainerRole = isHopperType(typeId) ? "input" : role;
      const id = `c@${loc.x},${loc.y},${loc.z}`;
      return new McContainerAdapter(id, finalRole, inv, this.item, occupied);
    } catch {
      return undefined;
    }
  }

  /** 水平 4 邻居中找双箱伙伴（几何判定，core 纯函数） */
  private findPartner(block: Block): Block | undefined {
    const dim = block.dimension;
    const primary: BlockInfo = { typeId: block.typeId, x: block.location.x, y: block.location.y, z: block.location.z };
    const offsets: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of offsets) {
      try {
        const n = dim.getBlock({ x: primary.x + dx, y: primary.y, z: primary.z + dz });
        if (n === undefined || n.isAir || n.typeId !== block.typeId) continue;
        const neighbor: BlockInfo = { typeId: n.typeId, x: n.location.x, y: n.location.y, z: n.location.z };
        if (findChestPartner(primary, [neighbor]) !== undefined) return n;
      } catch {
        continue;
      }
    }
    return undefined;
  }
}