// ─── 容器工厂：Block → McContainerAdapter（双箱 SafeProbe 探测/漏斗约束/安全访问） ──
// 方块 → 概念容器的唯二入口（容器注册/重扫/启动重建都经它）。
// 要点（审查）：
//   · 双箱合并用 SafeProbe 探针**确认共享同一库存**，而非依赖 mc 容器实例同一性
//     （MC 不保证两半共享同一 Container 实例；v1 已踩过此坑）。
//   · 容器 ID = 主坐标（双箱取两半 (x,y,z) 最小者）→ 无论从哪半开始创建 ID 都稳定，
//     且拆主半后能重定到幸存半（见 ContainerId/primaryLocationOf）。
//   · 白名单：非受支持容器类型直接返回 undefined（isSupportedContainerType）。
//   · 漏斗强制 finalRole=input（不可改角色），其余按传入 role。
import type { Block } from "@minecraft/server";
import { isChestType, isHopperType, isSupportedContainerType } from "../../core/model/ContainerTypes";
import type { ContainerRole } from "../../core/model/Container";
import type { Location } from "../../core/model/types";
import { containerIdOf, primaryLocationOf } from "../../core/model/ContainerId";
import { McContainerAdapter } from "./McContainerAdapter";
import { probeDoubleChestSafely } from "./SafeProbe";
import type { McItemAdapter } from "./McItemAdapter";

const INVENTORY_COMPONENT = "minecraft:inventory";

/**
 * 容器工厂：Block → McContainerAdapter 的**唯二入口**（容器注册/重扫/启动重建都经它）。
 * - 双箱：SafeProbe 临时物探测确认共享同一库存（不依赖实例同一性）→ occupiedLocations 含两半
 * - 白名单：非受支持容器类型返回 undefined；漏斗强制 finalRole=input（不可改角色）
 * - 访问安全：任何失败（无库存组件/区块异常）静默返回 undefined，不抛崩溃
 */
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
      // ID 用主坐标 + 维度（双箱取两半 (x,y,z) 最小者 + 所属维度）——稳定、防跨维重叠、拆主半可重定
      const primary = primaryLocationOf(occupied)!;
      const id = containerIdOf(primary, block.dimension.id);
      return new McContainerAdapter(id, finalRole, inv, this.item, occupied, typeId, block.dimension.id);
    } catch {
      return undefined;
    }
  }
}
