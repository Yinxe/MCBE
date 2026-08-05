// ─── 容器适配器：概念 Container ← mc.Container（委托 + 安全访问） ──
// core 的 Container 契约在此对接真实 mc.Container。三件事（审查）：
//   · 安全访问——getItem/setItem/addItem 全部 try-catch，区块未加载/容器失效
//     静默返回（undefined/原堆），绝不把异常抛进 core 引擎。
//   · 写权威委托——`addItem` 直接调 `mc.addItem`（原生 NBT 级堆叠判定），
//     经 `item.toMc` 还原的堆（携带源引用、保留组件）放入。这正是"同型不同 NBT
//     不错误合并"的保证（见 McItemAdapter 的 SOURCE symbol）。
//   · O(1) 属性——capacity/emptySlotsCount/usedSlots 直接读 mc 容器，零遍历。
// 注意：本文件依赖 @minecraft/server，仅编译检查 + 游戏内冒烟，不进 node 测试构建。
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