// ─── 容器适配器：概念 Container ← mc.Container（委托 + 安全访问） ──
import type { Container as McContainer } from "@minecraft/server";
import type { Container, ContainerRole } from "../../core/model/Container";
import type { ItemStack } from "../../core/model/ItemStack";
import type { ContainerId, Location } from "../../core/model/types";
import { deriveBinding } from "../../core/model/DeriveBinding";
import type { McItemAdapter } from "./McItemAdapter";

export class McContainerAdapter implements Container {
  readonly id: ContainerId;
  role: ContainerRole;
  enabled = true;
  priority = 10;
  readonly occupiedLocations: Location[];
  /** 源方块类型 ID（漏斗强制 input 判定用） */
  readonly blockType: string;

  constructor(
    id: ContainerId,
    role: ContainerRole,
    private readonly mc: McContainer,
    private readonly item: McItemAdapter,
    occupiedLocations: Location[],
    blockType = ""
  ) {
    this.id = id;
    this.role = role;
    this.occupiedLocations = occupiedLocations;
    this.blockType = blockType;
  }

  get capacity(): number { return this.mc.size; }
  get emptySlotsCount(): number { return this.mc.emptySlotsCount; }
  get usedSlots(): number { return this.capacity - this.emptySlotsCount; }

  getItem(slot: number): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.getSlot(slot).getItem());
    } catch {
      return undefined;
    }
  }

  setItem(slot: number, item?: ItemStack): void {
    try {
      this.mc.getSlot(slot).setItem(item === undefined ? undefined : this.item.toMc(item));
    } catch {
      // 区块未加载/容器失效：静默
    }
  }

  addItem(stack: ItemStack): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.addItem(this.item.toMc(stack)));
    } catch {
      return stack; // 失败视为全部剩余
    }
  }

  getDedicatedItemId(): string | undefined {
    return deriveBinding(this);
  }
}