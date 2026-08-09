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
// 失联容器（活塞移动/摧毁）：**不主动探测**（不给每候选每路由加位置读取）——读取全 try-catch，
// 失效即标记 `lost` 并返回空/undefined → 路由层统一失联门(gateLost)跳过；恢复由 `isLost()` 复查同位置
// （受支持容器 → 清 lost 重新可选）；持续丢失由仓库卸载→重载补注册机制清扫。
import {
  world,
  ItemStack as McItemStack,
  type Container as McContainer,
} from "@minecraft/server";
import type { Container, ContainerRole } from "../../core/model/Container";
import type { ItemStack } from "../../core/model/ItemStack";
import type { ContainerId, Location, WarehouseId } from "../../core/model/types";
import { deriveBinding } from "../../core/model/DeriveBinding";
import { isSupportedContainerType } from "../../core/model/ContainerTypes";
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
  /** 同族开关：多物容器开启后，装有某族任一成员即可收纳该族全部物品（内容派生，非手动绑定） */
  familyEnabled = true;
  /** 容器级白名单 typeId[]：非空时仅收纳列表内物品 */
  whitelist: string[] = [];
  /** 容器级黑名单 typeId[]：永不收纳这些物品 */
  blacklist: string[] = [];
  readonly occupiedLocations: Location[];
  /** 所属维度（完整 id：minecraft:overworld…），供恢复复查读方块用（位置见 occupiedLocations[0]） */
  readonly dimension: string;
  /** 源方块类型 ID（漏斗强制 input / 潜影盒防套娃判定用） */
  readonly blockType: string;
  /**
   * 失联标记（活塞移动/摧毁等使 mc 读取抛错时置位；所有角色通用）。路由层据此**跳过候选**；
   * `isLost()` 复查同位置（occupiedLocations[0]）是否恢复（受支持容器 → 清标记重新可用）。
   * 不置位时不探测，零成本；恢复只在"已失联"时复查（罕见）。持续失联由卸载→重载补注册清扫。
   */
  private lost = false;

  constructor(
    id: ContainerId,
    role: ContainerRole,
    private readonly mc: McContainer,
    private readonly item: McItemAdapter,
    occupiedLocations: Location[],
    blockType = "",
    dimension = ""
  ) {
    this.id = id;
    this.role = role;
    this.occupiedLocations = occupiedLocations;
    this.blockType = blockType;
    this.dimension = dimension;
  }

  get capacity(): number {
    try {
      return this.mc.size;
    } catch {
      this.lost = true; // 底层失效（活塞移动/摧毁）→ 懒标记 lost，路由层 gateLost 跳过（不注销）
      return 0; // 按空容器处理，绝不让单点故障崩掉菜单/扫描
    }
  }
  get emptySlotsCount(): number {
    try {
      return this.mc.emptySlotsCount;
    } catch {
      this.lost = true;
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
      this.lost = true; // 失效容器读取抛错 → 懒标记 lost（供路由层 gateLost 跳过）
      return undefined;
    }
  }

  setItem(slot: number, item?: ItemStack): void {
    try {
      // 直接用 Container.setItem（比经 getSlot().setItem 更贴近 mc API）
      this.mc.setItem(slot, item === undefined ? undefined : this.item.toMc(item));
    } catch {
      this.lost = true; // 写入也抛错 → 同一失效判定（区块未加载的读写同样进 catch）
    }
  }

  addItem(stack: ItemStack): ItemStack | undefined {
    try {
      return this.item.toDomain(this.mc.addItem(this.item.toMc(stack)));
    } catch {
      this.lost = true;
      return stack; // 失败视为全部剩余
    }
  }

  getDedicatedItemId(): string | undefined {
    return deriveBinding(this);
  }

  /** 是否**失联**（活塞移动/摧毁等，所有角色通用）：lost 标记由读取抛错**懒置**（不主动探测）。
   * 已置位 → 复查注册位置是否恢复（活塞推回/发射器重新放盒 → 受支持容器 → 清标记重新可用）；
   * 未置位 → 直接 false，零世界读取。恢复只在"已失联"时复查，成本被失联频度天然收敛。 */
  isLost(): boolean {
    if (!this.lost) return false;
    try {
      const loc = this.occupiedLocations[0];
      const block: import("@minecraft/server").Block | undefined =
        this.dimension === "" || loc === undefined
          ? undefined
          : world.getDimension(this.dimension).getBlock(loc);
      if (block !== undefined && !block.isAir && isSupportedContainerType(block.typeId)) {
        this.lost = false; // 已恢复（新容器回到原位）→ 重新可选
        return false;
      }
    } catch {
      // 位置读取失败 → 保持失联
    }
    return true;
  }

  /** 原生 O(1) 类型判定（native `contains` 快判）。约定：
   *   · true   —— 原生命中：该类型确定存在（唯一可信正向，直接短路，免遍历）
   *   · false  —— 空容器（empty 确定，类型必不存在）
   *   · undefined —— 原生未命中（NBT/data 差异可假阴性，**不做线性遍历**——遍历由 core
   *     helpers.hasItemType 统一兜底，避免双写同逻辑）或原生失效（→ lost）
   * 返回 undefined 时调用方（core hasItemType）走 linear 遍历确定。 */
  hasItemType(itemId: string): boolean | undefined {
    try {
      if (this.mc.emptySlotsCount === this.mc.size) return false; // 空容器 → 免构造 ItemStack + contains
      if (this.mc.contains(new McItemStack(itemId, 1))) return true; // 原生 O(1) 命中
      return undefined; // 未命中不可全信（NBT/data 差异假阴性）→ 交 core 线性遍历确定
    } catch {
      this.lost = true;
      return undefined; // 原生失效 → core hasItemType 遍历兜底（getItem/capacity 安全）
    }
  }

  // ── 便捷搜索：first/last 手封装线性扫描（复用 getItem 的安全访问，不依赖官方
  //    firstItem 的槽 0 歧义）；firstEmptySlot/contains/find/findLast 委托 mc 原生 ──
  firstNoEmptyItem(): number | undefined {
    let size: number;
    try {
      size = this.mc.size; // ⚠️ 必须 try：失效容器读 size 会抛（活塞摧毁后 getDedicatedItemId 崩）
    } catch {
      this.lost = true;
      return undefined;
    }
    for (let i = 0; i < size; i++) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  lastNoEmptyItem(): number | undefined {
    let size: number;
    try {
      size = this.mc.size;
    } catch {
      this.lost = true;
      return undefined;
    }
    for (let i = size - 1; i >= 0; i--) {
      if (this.getItem(i) !== undefined) return i;
    }
    return undefined;
  }

  firstEmptySlot(): number | undefined {
    try {
      return this.mc.firstEmptySlot();
    } catch {
      this.lost = true;
      return undefined;
    }
  }

  contains(itemStack: ItemStack): boolean {
    try {
      return this.mc.contains(this.item.toMc(itemStack));
    } catch {
      this.lost = true;
      return false;
    }
  }

  find(itemStack: ItemStack): number | undefined {
    try {
      return this.mc.find(this.item.toMc(itemStack));
    } catch {
      this.lost = true;
      return undefined;
    }
  }

  findLast(itemStack: ItemStack): number | undefined {
    try {
      return this.mc.findLast(this.item.toMc(itemStack));
    } catch {
      this.lost = true;
      return undefined;
    }
  }

  /**
   * 合并/拆箱时重定容器 ID（主坐标迁移）。
   * 概念接口将 id 标为 readonly（语义上 identity），但双箱拆主半后 id 必须跟随
   * 幸存主坐标迁移，否则会导致 ID 悬空、与新放容器撞 ID（见 McEventBridge）。
   * 仅适配层内部用；调用方需同步：按旧 id 从 map 删除 → rebase → 按新 id 放回，
   * 并同步索引（运行时时重建）。
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
