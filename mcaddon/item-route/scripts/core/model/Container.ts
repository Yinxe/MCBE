// ─── 概念级容器 ──────────────────────────────────────────
// 对"一个可装物品的方块组"的抽象。不感知 MC，由两处实现：
//   · tests/helpers/InMemoryContainer.ts —— 纯内存实现，供 node 单测
//   · scripts/mc/adapters/McContainerAdapter.ts —— 委托真实 mc.Container，生产用
// 契约要点（审查必读）：
//   · `role` 决定路由去向：input（输入源）→ single（单物绑定）→ multi（同型聚集）
//     → misc（兜底）。漏斗在工厂层被强制为 input。
//   · `occupiedLocations` 承载双箱合并：一个逻辑容器可能占多个方块坐标。
//   · `addItem` 是核心写入原语：返回"剩余（未能放入）"，全部放入返回 undefined。
//     生产实现把判定全权委托 mc.addItem（原生 NBT 级堆叠），保证不吞不覆盖不刷。
import type { ItemStack } from "./ItemStack";
import type { ContainerId, ItemId, Location, WarehouseId } from "./types";

/** 容器角色 */
export type ContainerRole = "input" | "single" | "multi" | "misc";

/** 容器角色中文标签（UI 下拉选项） */
export const ROLE_LABELS: Record<ContainerRole, string> = {
  input: "输入",
  single: "单物",
  multi: "多物",
  misc: "其他",
};

/** 容器角色中文语义（通知/注册消息用）：输入容器/单物容器/多物容器/其他容器 */
export function containerRoleName(role: ContainerRole): string {
  return `${ROLE_LABELS[role]}容器`;
}

/** 概念级容器：不感知 MC，由适配层实现 */
export interface Container {
  readonly id: ContainerId;
  /** 所属仓库 ID（registerContainer 装配时写入；持久化在 ContainerEntry，用于直接归属解析） */
  warehouseId: WarehouseId;
  role: ContainerRole;
  enabled: boolean;
  /** 该容器容量预警开关（默认开；关闭后该容器不再触发 warning/full 预警） */
  warningEnabled: boolean;
  /** 路由排序优先级，数字越小越先（默认 10） */
  priority: number;
  /** 同族开关：多物容器开启后，**只要装有某族的任一成员**，即可收纳该族全部物品（族路由）。
   * 族成员关系由容器**实际内容**派生（存羊毛→即羊毛族容器），非手动绑定。 */
  familyEnabled: boolean;
  /** 容器级白名单 typeId[]：非空时仅收纳列表内物品；空 = 不限制（多物/族路由准入门槛） */
  whitelist: string[];
  /** 容器级黑名单 typeId[]：永不收纳这些物品（所有层级准入均拒绝）；空 = 不限制 */
  blacklist: string[];
  readonly capacity: number;
  /** O(1) 空槽数（adapter 委托 MC 属性，零遍历） */
  readonly emptySlotsCount: number;
  readonly usedSlots: number;
  /** 逻辑容器全部方块坐标（大箱子 = primary + 附属） */
  readonly occupiedLocations: Location[];
  getItem(slot: number): ItemStack | undefined;
  setItem(slot: number, item?: ItemStack): void;
  /** 尝试放入；返回剩余（未放入部分），全部放入返回 undefined */
  addItem(stack: ItemStack): ItemStack | undefined;
  /** 单物绑定：由首个非空 slot 物品推导（core 纯函数 deriveBinding 实现） */
  getDedicatedItemId(): ItemId | undefined;
  // ── 便捷搜索 ──
  // firstNoEmptyItem/lastNoEmptyItem 为**手封装线性扫描**（不依赖官方 firstItem 的
  // 槽 0 歧义，且 last 向无原生对应）；firstEmptySlot/contains/find/findLast 委托原生。
  /** 首个非空槽索引（无则 undefined）——调度轮询取源 */
  firstNoEmptyItem(): number | undefined;
  /** 末个非空槽索引（无则 undefined）——整理/取货侧可用 */
  lastNoEmptyItem(): number | undefined;
  /** 首个空槽索引（无则 undefined） */
  firstEmptySlot(): number | undefined;
  /** 是否包含给定物品（按 mc 语义：类型+组件相等，非仅 itemId） */
  contains(itemStack: ItemStack): boolean;
  /** 查找给定物品所在的槽（首个） */
  find(itemStack: ItemStack): number | undefined;
  /** 查找给定物品所在的槽（最后一个） */
  findLast(itemStack: ItemStack): number | undefined;
}
