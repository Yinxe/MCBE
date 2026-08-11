// ── 木桶阵列运行时（mc 适配层：方块/容器 IO + 常加载） ─────────────────
// 只做物理副作用：物化木桶方块、读写容器槽位、ticking area 常加载。
// 不持有业务状态（分配水印等由 StoredRegion 经 DP 读写）。
// 所有方块/容器访问 try-catch 保护；区块未加载或不可达时返回失败而非抛错。
import { world } from "@minecraft/server";
import type { BlockInventoryComponent, Container, Dimension, ItemStack } from "@minecraft/server";
import type { RegionLayout, SlotPosition } from "../core/layout";

const BARREL = "minecraft:barrel";

/** 低层桶阵列 IO：物化 / 读写 / 清空 / 常加载 */
export class BarrelRuntime {
  constructor(
    private readonly dimensionId: string,
    private readonly layout: RegionLayout
  ) {}

  private get dimension(): Dimension {
    return world.getDimension(this.dimensionId);
  }

  /**
   * 物化（幂等）：确保该槽位所在木桶存在；非木桶方块被替换为木桶。
   * 区块未加载或 setBlockType 失败返回 false。
   */
  ensureBarrel(pos: SlotPosition): boolean {
    try {
      const block = this.dimension.getBlock({ x: pos.x, y: pos.y, z: pos.z });
      if (!block) return false;
      if (block.typeId === BARREL) return true;
      this.dimension.setBlockType({ x: pos.x, y: pos.y, z: pos.z }, BARREL);
      return true;
    } catch (e) {
      console.warn("[nbt-data-storage] ensureBarrel 失败", e);
      return false;
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

  /** 槽位是否被占用；无法确认时保守视为占用（绝不覆盖他人物品） */
  isSlotOccupied(pos: SlotPosition): boolean {
    try {
      return this.containerOf(pos)?.getItem(pos.slotInBarrel) !== undefined;
    } catch {
      return true;
    }
  }

  /** 写入物品（克隆源栈，保留完整 NBT/组件） */
  writeItem(pos: SlotPosition, item: ItemStack): boolean {
    try {
      const container = this.containerOf(pos);
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
