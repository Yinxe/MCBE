// ─── 菜单信息元素清单（仓库级/容器级，模块化开关） ──
// 仓库/容器菜单里的每一条信息展示元素都登记在此，OP 可在 OPInfoConfigUI 里逐项开关。
// 设计：
//   · 纯数据零依赖（core 可单测）——清单是"信息元数据"的单一来源。
//   · 每项默认开；关闭的元素渲染方**跳过对应计算**（如统计/扫描），避免无效开销。
//   · 开关状态存 McModConfig（menuInfo），键 = 本模块的 `key`。
export type MenuInfoKey =
  // ── 仓库级（WarehouseSettingsMenu / WarehouseManageMenu） ──
  | "warehouseId"
  | "warehouseName"
  | "warehouseOwner"
  | "warehouseDimension"
  | "warehouseCoords"
  | "warehouseSpec"
  | "warehouseStats"
  | "warehouseFamily";
// ── 容器级（ContainerRoleMenu 配置模态 + 列表按钮） ──
export type ContainerInfoKey =
  | "containerWhName"
  | "containerType"
  | "containerCapacity"
  | "containerMessiness"
  | "containerId"
  | "containerStatus"
  | "containerRole"
  | "containerPriority"
  | "containerFamilyRank";

/** 信息元素：key + 中文标签 + 归属（仓库/容器）+ 默认开 */
export interface MenuInfoItem {
  key: MenuInfoKey | ContainerInfoKey;
  label: string;
  kind: "warehouse" | "container";
  defaultOn: boolean;
}

/** 全部仓库级信息元素（默认全开） */
export const WAREHOUSE_INFO_ITEMS: readonly MenuInfoItem[] = [
  { key: "warehouseId", label: "仓库 ID", kind: "warehouse", defaultOn: true },
  { key: "warehouseName", label: "仓库名称", kind: "warehouse", defaultOn: true },
  { key: "warehouseOwner", label: "拥有者", kind: "warehouse", defaultOn: true },
  { key: "warehouseDimension", label: "维度", kind: "warehouse", defaultOn: true },
  { key: "warehouseCoords", label: "坐标范围", kind: "warehouse", defaultOn: true },
  { key: "warehouseSpec", label: "规格（x×y×z）", kind: "warehouse", defaultOn: true },
  { key: "warehouseStats", label: "统计（容器/槽位/物品/种类）", kind: "warehouse", defaultOn: true },
  { key: "warehouseFamily", label: "已启用族类数", kind: "warehouse", defaultOn: true },
];

/** 全部容器级信息元素（默认全开） */
export const CONTAINER_INFO_ITEMS: readonly MenuInfoItem[] = [
  { key: "containerWhName", label: "所属仓库名", kind: "container", defaultOn: true },
  { key: "containerType", label: "方块类型", kind: "container", defaultOn: true },
  { key: "containerCapacity", label: "容量", kind: "container", defaultOn: true },
  { key: "containerMessiness", label: "混乱度", kind: "container", defaultOn: true },
  { key: "containerId", label: "容器 ID", kind: "container", defaultOn: true },
  { key: "containerStatus", label: "状态", kind: "container", defaultOn: true },
  { key: "containerRole", label: "角色", kind: "container", defaultOn: true },
  { key: "containerPriority", label: "优先级", kind: "container", defaultOn: true },
  { key: "containerFamilyRank", label: "族榜", kind: "container", defaultOn: true },
];

/** 全部信息元素（仓库 + 容器，供 OPInfoConfigUI 枚举） */
export const ALL_MENU_INFO_ITEMS: readonly MenuInfoItem[] = [
  ...WAREHOUSE_INFO_ITEMS,
  ...CONTAINER_INFO_ITEMS,
];

/** 默认开关态：全部元素默认开 */
export function defaultMenuInfo(): Record<string, boolean> {
  const m: Record<string, boolean> = {};
  for (const item of ALL_MENU_INFO_ITEMS) m[item.key] = item.defaultOn;
  return m;
}

/** 某信息元素是否显示（缺省 → 默认开，兼容旧档无此字段） */
export function isMenuInfoOn(menuInfo: Record<string, boolean> | undefined, key: MenuInfoKey | ContainerInfoKey): boolean {
  return menuInfo?.[key] ?? true;
}