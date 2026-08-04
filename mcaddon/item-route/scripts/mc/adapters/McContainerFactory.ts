// ─── 容器工厂：Block → McContainerAdapter（双箱 SafeProbe 探测/漏斗约束/安全访问） ──
import type { Block } from "@minecraft/server";
import { isChestType, isHopperType, isSupportedContainerType } from "../../core/model/ContainerTypes";
import type { ContainerRole } from "../../core/model/Container";
import type { Location } from "../../core/model/types";
import { McContainerAdapter } from "./McContainerAdapter";
import { probeDoubleChestSafely } from "./SafeProbe";
import type { McItemAdapter } from "./McItemAdapter";

const INVENTORY_COMPONENT = "minecraft:inventory";

export class McContainerFactory {
  constructor(private readonly item: McItemAdapter) {}

  /**
   * 方块 → 概念容器适配器。
   * - 双箱：用 SafeProbe 临时物探测确认共享同一库存（不依赖实例同一性）→ occupiedLocations 含两半
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
        const partner = probeDoubleChestSafely(block.dimension, loc, block);
        if (partner !== undefined) {
          occupied.push({ x: partner.x, y: partner.y, z: partner.z });
        }
      }

      const finalRole: ContainerRole = isHopperType(typeId) ? "input" : role;
      const id = `c@${loc.x},${loc.y},${loc.z}`;
      return new McContainerAdapter(id, finalRole, inv, this.item, occupied, typeId);
    } catch {
      return undefined;
    }
  }
}