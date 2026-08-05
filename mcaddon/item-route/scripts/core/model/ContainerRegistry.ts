// ─── 容器注册表：containers（全量）与 inputs（启用输入子集）的单一写路径 ──
// `containers` 是真相源；`inputs` 是它派生的"启用 input 子集"维护镜像。
// **所有对容器集合的结构性写入**（新增/拆除/改角色/改启用/重定 ID）都必须经本模块函数，
// 保证 Scheduler 每轮取输入容器零过滤（`inputs` 通常只有 1~3 个，不遍历全仓容器）。
// 若绕过本模块直接改 `warehouse.containers`，`inputs` 会失同步 → 输入被漏路由/幽灵路由。
import type { Container } from "./Container";
import type { Warehouse } from "./Warehouse";
import type { ContainerId } from "./types";

/** 是否属于"启用输入"集合（input 角色且启用） */
function isEnabledInput(container: Container): boolean {
  return container.role === "input" && container.enabled;
}

/** 注册容器（新容器入仓 / 区域重扫 / 启动重建） */
export function registerContainer(warehouse: Warehouse, container: Container): void {
  warehouse.containers.set(container.id, container);
  if (isEnabledInput(container)) warehouse.inputs.set(container.id, container);
}

/** 注销容器（完全拆除） */
export function unregisterContainer(warehouse: Warehouse, containerId: ContainerId): void {
  warehouse.containers.delete(containerId);
  warehouse.inputs.delete(containerId);
}

/** 重定 ID 迁移（双箱拆主半/合并：id 跟随幸存主坐标）——旧键删、新键插 */
export function rebaseContainer(warehouse: Warehouse, oldId: ContainerId, container: Container): void {
  warehouse.containers.delete(oldId);
  warehouse.inputs.delete(oldId);
  warehouse.containers.set(container.id, container);
  if (isEnabledInput(container)) warehouse.inputs.set(container.id, container);
}

/** 角色/启用变更后刷新该容器的 inputs 成员资格（漏斗强制 input 时 role 不变） */
export function refreshInputMembership(warehouse: Warehouse, container: Container): void {
  if (isEnabledInput(container)) warehouse.inputs.set(container.id, container);
  else warehouse.inputs.delete(container.id);
}
