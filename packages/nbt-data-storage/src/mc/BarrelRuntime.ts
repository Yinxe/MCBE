// ── 木桶阵列运行时（mc 适配层：方块/容器 IO + 常加载） ─────────────────
// 只做物理副作用：物化木桶方块、读写容器槽位、ticking area 常加载。
// 不持有业务状态（分配水印等由 StoredRegion 经 DP 读写）。
// 所有方块/容器访问 try-catch 保护；区块未加载或不可达时返回失败而非抛错。
import { world } from "@minecraft/server";
import type { BlockInventoryComponent, Container, Dimension, ItemStack } from "@minecraft/server";
import type { RegionLayout, SlotPosition } from "../core/layout";
import type { SlotStatus } from "../core/repair";

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
   * 物化（幂等）：确保该槽位所在木桶存在；非木桶方块被替换为木桶。
   * 返回是否就绪 + 本次是否新建了桶（新建 → 上层计数）。
   * 区块未加载或 setBlockType 失败 → { ok:false }。
   */
  ensureBarrel(pos: SlotPosition): { ok: boolean; created: boolean } {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return { ok: false, created: false };
      if (block.typeId === BARREL) return { ok: true, created: false };
      this.dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, BARREL);
      return { ok: true, created: true };
    } catch (e) {
      console.warn("[nbt-data-storage] ensureBarrel 失败", e);
      return { ok: false, created: false };
    }
  }

  private containerOf(pos: SlotPosition): Container | undefined {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      const inv = block?.getComponent("minecraft:inventory") as BlockInventoryComponent | undefined;
      return inv?.container;
    } catch {
      return undefined;
    }
  }

  /** 读取槽位物品（克隆返回，避免外部改动污染已存物品） */
  readItem(pos: SlotPosition): ItemStack | undefined {
    try {
      return this.containerOf(pos)?.getItem(pos.slotInBarrel)?.clone();
    } catch {
      return undefined;
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

  /** 清空槽位（移除物品）；容器不可用返回 false */
  clearSlot(pos: SlotPosition): boolean {
    try {
      const container = this.containerOf(pos);
      if (!container) return false;
      container.setItem(pos.slotInBarrel, undefined);
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

  /** 注册 ticking area 保持阵列所在区块常加载（幂等；已存在/数量受限忽略） */
  ensureTickingArea(): void {
    try {
      const x0 = this.layout.chunkX * 16;
      const z0 = this.layout.chunkZ * 16;
      const x1 = x0 + 15;
      const z1 = z0 + 15;
      const y1 = this.layout.baseY + this.layout.maxLevels - 1;
      this.dimension.runCommand(`tickingarea add ${x0} ${this.layout.baseY} ${z0} ${x1} ${y1} ${z1}`);
    } catch {
      /* 已存在/数量受限：忽略，不影响存储 */
    }
  }
}
