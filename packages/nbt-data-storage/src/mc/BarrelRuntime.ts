// ── 木桶阵列运行时（mc 适配层：方块/容器 IO + 常加载） ─────────────────
// 只做物理副作用：建木桶方块、读写容器格子、ticking area 常加载。
// 不持有业务状态（账本等由 StoredRegion 经 DP 读写）。
// 所有方块/容器访问 try-catch 保护；区块未加载或不可达时返回失败而非抛错。
import { world } from "@minecraft/server";
import type { BlockInventoryComponent, Container, Dimension, ItemStack, TickingAreaOptions } from "@minecraft/server";
import type { RegionLayout, SlotPosition } from "../core/layout";
import type { SlotStatus } from "../core/repair";
import { shortDimension } from "../core/keys";

const BARREL = "minecraft:barrel";

/** 低层桶阵列 IO：物化 / 读写 / 清空 / 常加载 */
export class BarrelRuntime {
  private layout: RegionLayout;

  constructor(
    private readonly dimensionId: string,
    layout: RegionLayout
  ) {
    this.layout = layout;
  }

  /** 布局变更后同步（resizeLevels 调整层数时更新常加载范围） */
  applyLayout(layout: RegionLayout): void {
    this.layout = layout;
  }

  private get dimension(): Dimension {
    return world.getDimension(this.dimensionId);
  }

  /**
   * 物化（幂等）：确保该槽位所在木桶存在。
   * - 已是木桶 → { ok:true, created:false }
   * - 空气/未生成 → setBlockType 物化 → { ok:true, created:true }
   * - **其它方块（他人容器/普通方块）→ { ok:false, occupied:true }——绝不替换他人方块**
   *   （put 编排据此跳过候选；巡检的显式重建走 ensureBarrelForRepair）
   * - 区块未加载/失败 → { ok:false }
   */
  ensureBarrel(pos: SlotPosition): { ok: boolean; created: boolean; occupied?: boolean } {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return { ok: false, created: false };
      if (block.typeId === BARREL) return { ok: true, created: false };
      if (block.typeId !== "minecraft:air") return { ok: false, created: false, occupied: true };
      this.dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, BARREL);
      return { ok: true, created: true };
    } catch (e) {
      console.warn("[nbt-data-storage] ensureBarrel 失败", e);
      return { ok: false, created: false };
    }
  }

  /**
   * 巡检重建（显式修复）：把阵列坐标内的**任何非木桶方块一律覆盖**为木桶
   * （含其它容器——按设计阵列坐标内的一切非木桶都是预期之外的干扰）。
   */
  ensureBarrelForRepair(pos: SlotPosition): { ok: boolean; created: boolean } {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return { ok: false, created: false };
      if (block.typeId === BARREL) return { ok: true, created: false };
      this.dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, BARREL);
      return { ok: true, created: true };
    } catch (e) {
      console.warn("[nbt-data-storage] ensureBarrelForRepair 失败", e);
      return { ok: false, created: false };
    }
  }

  /** 读取槽位物品（克隆返回，避免外部改动污染已存物品）；**位置不是木桶 → undefined（绝不读他人容器）** */
  readItem(pos: SlotPosition): ItemStack | undefined {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return undefined;
      const inv = block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
      return inv?.container?.getItem(pos.slotInBarrel)?.clone();
    } catch {
      return undefined;
    }
  }

  /**
   * 批量读取同一木桶的多个格子（**一次取容器**、循环 getItem，替代逐格 getBlock 放大）。
   * 位置不是木桶/区块未加载 → 全部 undefined（绝不读他人容器）。
   * 返回数组与入参 slotInBarrels 顺序对齐。
   */
  readBatch(pos: SlotPosition, slotInBarrels: number[]): (ItemStack | undefined)[] {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return slotInBarrels.map(() => undefined);
      const container = (block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined)?.container;
      if (!container) return slotInBarrels.map(() => undefined);
      return slotInBarrels.map((j) => container.getItem(j)?.clone());
    } catch {
      return slotInBarrels.map(() => undefined);
    }
  }

  /** 槽位是否被占用；无法确认或**位置不是木桶**时保守视为占用（绝不覆盖/写入他人方块） */
  isSlotOccupied(pos: SlotPosition): boolean {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return true; // 区块未加载：保守占用
      if (block.typeId !== BARREL) return true; // 非木桶（含其它容器/空气）：保守占用，put 绝不写入
      const inv = block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
      return inv?.container?.getItem(pos.slotInBarrel) !== undefined;
    } catch {
      return true;
    }
  }

  /**
   * 在一个木桶里找第一个空格子（性能优化：**一次取容器**、循环查格，
   * 替代逐格 `isSlotOccupied` 的每格一次方块查询）。
   * 位置不是木桶/区块未加载 → null（保守：无空格子，调用方跳过该桶）。
   */
  firstEmptySlot(pos: SlotPosition, usable: number): number | null {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return null;
      const container = (block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined)?.container;
      if (!container) return null;
      for (let j = 0; j < usable; j++) {
        if (container.getItem(j) === undefined) return j;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 一次看一个木桶的全部格子（性能优化：**一次取容器**、循环查格，
   * 供盘点按桶批处理；替代逐格 `probeStatus` 的每格一次方块查询）。
   * 位置不是木桶 → 每格 damaged（盘点将重建）；区块未加载 → 每格 unknown。
   */
  probeBarrelSlots(pos: SlotPosition, usable: number): SlotStatus[] {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return new Array(usable).fill("unknown");
      if (block.typeId !== BARREL) return new Array(usable).fill("damaged");
      const container = (block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined)?.container;
      if (!container) return new Array(usable).fill("unknown");
      const statuses: SlotStatus[] = new Array(usable);
      for (let j = 0; j < usable; j++) {
        statuses[j] = container.getItem(j) !== undefined ? "occupied" : "empty";
      }
      return statuses;
    } catch {
      return new Array(usable).fill("unknown");
    }
  }

  /** 写入物品（克隆源栈，保留完整 NBT/组件）；位置不是木桶时拒绝（绝不写入他人方块） */
  writeItem(pos: SlotPosition, item: ItemStack): boolean {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return false;
      const container = (block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined)?.container;
      if (!container) return false;
      container.setItem(pos.slotInBarrel, item.clone());
      return true;
    } catch {
      return false;
    }
  }

  /** 清空槽位（移除物品）；**位置不是木桶 → false（绝不清空他人容器）** */
  clearSlot(pos: SlotPosition): boolean {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return false;
      const inv = block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
      if (!inv?.container) return false;
      inv.container.setItem(pos.slotInBarrel, undefined);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 安全交换（原子）：区域格子 ↔ 外部容器槽位对调。
   * 用原版 `Container.swapItems`（引擎级原子语义：要么换成功要么两边原样，
   * 不会出现"一边写入成功一边失败"的中间态）；区域位置不是木桶/未加载 → false。
   */
  swapItems(pos: SlotPosition, container: Container, destSlot: number): boolean {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block || block.typeId !== BARREL) return false;
      const regionContainer = (block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined)
        ?.container;
      if (!regionContainer) return false;
      regionContainer.swapItems(pos.slotInBarrel, destSlot, container); // 引擎级原子交换（失败会抛，被 catch 兜底）
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 巡检探测：槽位世界状态（修复流程用）。
   * 阵列坐标范围内的**任何非木桶方块都是预期之外的干扰**（含其它容器）→ damaged，
   * 巡检会一律重建覆盖；区块未加载 → unknown（跳过不误修）。
   */
  probeStatus(pos: SlotPosition): SlotStatus {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return "unknown"; // 区块未加载：不可判定
      if (block.typeId !== BARREL) return "damaged"; // 任何非木桶（空气/其它容器/普通方块）→ 重建
      const inv = block.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
      if (!inv?.container) return "unknown"; // 容器组件缺失：保守不可判定
      return inv.container.getItem(pos.slotInBarrel) ? "occupied" : "empty";
    } catch {
      return "unknown";
    }
  }

  /**
   * ticking area 名称（维度 + 区块 组合，跨维度不冲突）。名称仅本包可见
   * （TickingAreaManager 语义：无法修改/查询其他包或命令添加的区域）。
   */
  private areaName(): string {
    return `nds_${shortDimension(this.dimensionId)}_${this.layout.chunkX}_${this.layout.chunkZ}`;
  }

  /**
   * 注册 ticking area 保持阵列所在区块常加载（低频：注册/调整时各一次）。
   * 使用 **world.tickingAreaManager（TickingAreaManager）**——模组独立额度：
   * - **不占游戏命令预算**（每包固定 ticking 区块数，独立于命令限制）；
   * - 多模组共用同一存储区域：各包各自挂自己的常加载（API 无法感知其他包的区域，
   *   但**各包额度独立**，互不挤占；本包内 `hasTickingArea` 去重，同名不重复创建）；
   * - createTickingArea 为异步（区块加载完成后 resolve），fire-and-forget + 失败告警；
   * - force=true（resizeLayout 后范围变化）：先 remove 再重建；
   * - 容量不足/失败 → 警告日志（否则远方容器读写将静默降级，难以排查）。
   */
  ensureTickingArea(opts: { force?: boolean } = {}): void {
    const name = this.areaName();
    const manager = world.tickingAreaManager;
    try {
      if (!opts.force && manager.hasTickingArea(name)) return; // 本包已挂 → 去重
      if (opts.force) {
        try {
          manager.removeTickingArea(name); // 范围变化：先移除旧区域
        } catch {
          /* 不存在则忽略 */
        }
      }
      const x0 = this.layout.chunkX * 16;
      const z0 = this.layout.chunkZ * 16;
      // from/to 取**同一点**（区块原点）：引擎自动把该点所在区块（16×16 垂直柱）设为常加载，
      // 避免 16×16 包围盒在区块边界上跨越多个区块；区块柱覆盖全部 Y 层（含 64 层桶阵列）
      const anchor = { x: x0, y: this.layout.baseY, z: z0 };
      const options: TickingAreaOptions = {
        dimension: this.dimension,
        from: anchor,
        to: anchor,
      };
      if (!manager.hasCapacity(options)) {
        console.warn(
          `[nbt-data-storage] 常加载区块容量不足（本包额度 ${manager.chunkCount}/${manager.maxChunkCount}），存储阵列可能受区块加载影响`
        );
        return;
      }
      void manager.createTickingArea(name, options).catch((e) => {
        console.warn(`[nbt-data-storage] 常加载区块挂载失败：${e instanceof Error ? e.message : String(e)}`);
      });
    } catch (e) {
      console.warn(`[nbt-data-storage] 常加载区块挂载失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
