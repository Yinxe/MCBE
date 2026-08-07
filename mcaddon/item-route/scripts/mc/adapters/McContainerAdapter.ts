// ─── 容器适配器：概念 Container ← mc.Container（委托 + 安全访问） ──
// core 的 Container 契约在此对接真实 mc.Container。三件事（审查）：
//   · 安全访问——getItem/setItem/addItem 全部 try-catch，区块未加载/容器失效
//     静默返回（undefined/原堆），绝不把异常抛进 core 引擎。
//   · 写权威委托——`addItem` 直接调 `mc.addItem`（原生 NBT 级堆叠判定），
//     经 `item.toMc` 还原的堆（携带源引用、保留组件）放入。这正是"同型不同 NBT
//     不错误合并"的保证（见 McItemAdapter 的 SOURCE symbol）。
//   · O(1) 属性——capacity/emptySlotsCount/usedSlots 直接读 mc 容器，零遍历。
//
// 已勘察的 mc.Container API 面（5513 行起）与取舍：
//   · 用：size/emptySlotsCount/usedSlots、getItem/setItem/clearAll(未用)/addItem、
//         getSlot、firstEmptySlot(供 SafeProbe)
//   · 知而不引：moveItem/transferItem/swapItems 是原生"移动/交换"原语，正确性高，
//     但概念层 transfer/Organizer 已通过 addItem(+源引用) 达成等价且不绕过抽象边界；
//     contains/find/findLast 委托原生（索引已在 ItemIndex 缓存，仅交互/校验兜底用），
//     firstNoEmptyItem/lastNoEmptyItem 为手封装线性扫描（见下方实现）。
// 注意：本文件依赖 @minecraft/server，仅编译检查 + 游戏内冒烟，不进 node 测试构建。
import type { Container as McContainer } from "@minecraft/server";
import type { Container, ContainerRole } from "../../core/model/Container";
import type { ItemStack } from "../../core/model/ItemStack";
import type { ContainerId, Location, WarehouseId } from "../../core/model/types";
import { deriveBinding } from "../../core/model/DeriveBinding";
import type { McItemAdapter } from "./McItemAdapter";

/**
 * 容器适配器：实现 core `Container` 契约，委托真实 mc.Container。
 *  - addItem/setItem/contains/find 全权委托 mc 原生（NBT 级堆叠判定，不吞不覆盖不刷）。
 *  - occupiedLocations 承载双箱合并；rebindMc 在双箱合并时换绑最新库存句柄，rebaseId 重定主 id。
 * 生产唯一容器实现（测试用 InMemoryContainer）。
 */
export class McContainerAdapter implements Container {
  readonly id: ContainerId;
  /** 所属仓库 ID（registerContainer 装配时写入，不自构造填） */
  warehouseId!: WarehouseId;
  role: ContainerRole;
  enabled = true;
  /** 该容器容量预警开关（默认开；菜单可关闭该容器预警） */
  warningEnabled = true;
  /** 路由优先级（1-100，数字小先处理；默认 50，中性档） */
  priority = 50;
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

  get capacity(): number {
    try {
      return this.mc.size;
    } catch {
      return 0; // 方块失效/区块未加载：按空容器处理，绝不让单点故障崩掉菜单/扫描
    }
  }
  get emptySlotsCount(): number {
    try {
      return this.mc.emptySlotsCount;
    } catch {
      return 0;
    }
  }
  get usedSlots(): number {
    return this.capacity - this.emptySlotsCount;
  }

  getItem(slot: number): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.getSlot(slot).getItem());
    } catch {
      return undefined;
    }
  }

  setItem(slot: number, item?: ItemStack): void {
    try {
      // 直接用 Container.setItem（比经 getSlot().setItem 更贴近 mc API）
      this.mc.setItem(slot, item === undefined ? undefined : this.item.toMc(item));
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

  // ── 便捷搜索：first/last 手封装线性扫描（复用 getItem 的安全访问，不依赖官方
  //    firstItem 的槽 0 歧义）；firstEmptySlot/contains/find/findLast 委托 mc 原生 ──
  firstNoEmptyItem(): number | undefined {
    for (let i = 0; i < this.mc.size; i++) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  lastNoEmptyItem(): number | undefined {
    for (let i = this.mc.size - 1; i >= 0; i--) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  firstEmptySlot(): number | undefined {
    try {
      return this.mc.firstEmptySlot();
    } catch {
      return undefined;
    }
  }

  contains(itemStack: ItemStack): boolean {
    try {
      return this.mc.contains(this.item.toMc(itemStack));
    } catch {
      return false;
    }
  }

  find(itemStack: ItemStack): number | undefined {
    try {
      return this.mc.find(this.item.toMc(itemStack));
    } catch {
      return undefined;
    }
  }

  findLast(itemStack: ItemStack): number | undefined {
    try {
      return this.mc.findLast(this.item.toMc(itemStack));
    } catch {
      return undefined;
    }
  }

  /**
   * 合并/拆箱时重定容器 ID（主坐标迁移）。
   * 概念接口将 id 标为 readonly（语义上 identity），但双箱拆主半后 id 必须跟随
   * 幸存主坐标迁移，否则会导致 ID 悬空、与新放容器撞 ID（见 McEventBridge）。
   * 仅适配层内部用；调用方需同步：按旧 id 从 map 删除 → rebase → 按新 id 放回，
   * 并重建索引条目。
   */
  rebaseId(newId: ContainerId): void {
    (this as { id: ContainerId }).id = newId;
  }

  /** 返回当前持有的 mc.Container（双箱合并时迁移句柄用） */
  getMc(): McContainer {
    return this.mc;
  }

  /**
   * 双箱合并后重绑定到**合并后共享库存**的 mc.Container 句柄。
   * MC 不保证旧 Container 实例在两箱合并后仍指向扩容后的共享库存，
   * 故合并路径用工厂新建适配器（持有最新库存句柄）的 mc 覆盖 existing 的旧引用。
   */
  rebindMc(mc: McContainer): void {
    (this as unknown as { mc: McContainer }).mc = mc;
  }
}
