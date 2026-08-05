// ─── 命令权限封装（纯逻辑，可单测） ──────────────────────────
// 命令 → 所需最小角色的声明式映射（COMMAND_MIN_ROLE），配合 core MemberService
// 实现统一权限矩阵（design §3.3），替代 v1 的 OP 二元判断。
// 用法：命令回调里 `requireRole(deps.members, warehouse, player.id, X)`；
// 或直接用 `canRunCommand` 按命令名取权限（create/organize/help=any 等）。
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberRole } from "../../core/model/Warehouse";
import type { PlayerId } from "../../core/model/types";
import type { MemberService } from "../../core/services/MemberService";

/** 按显示名精确解析仓库；无匹配返回 undefined */
export function resolveWarehouseByName(warehouses: Warehouse[], name: string): Warehouse | undefined {
  return warehouses.find((w) => w.displayName === name);
}

/** 玩家是否满足仓库所需最低角色（owner 隐式满足一切） */
export function requireRole(
  members: MemberService,
  warehouse: Warehouse | undefined,
  playerId: PlayerId,
  role: MemberRole
): boolean {
  if (warehouse === undefined) return false;
  return members.can(warehouse, playerId, role);
}

/**
 * 权限矩阵（设计 §3.3）：命令 → 最低角色；"any" = 任意玩家。
 * create/organize/help 任意；menu/search visitor+；rescan/rescan_preview member+；
 * delete/resize owner。
 */
export type CommandAccess = MemberRole | "any";
export const COMMAND_MIN_ROLE: Record<string, CommandAccess> = {
  create: "any",
  resize: "owner",
  rescan: "member",
  rescan_preview: "member",
  delete: "owner",
  menu: "visitor",
  search: "visitor",
  organize: "any",
  help: "any",
};

/**
 * 玩家能否执行某命令（对本仓库）。
 * "any" → 无条件 true；否则 requireRole。
 */
export function canRunCommand(
  members: MemberService,
  warehouse: Warehouse | undefined,
  playerId: PlayerId,
  command: string
): boolean {
  const access = COMMAND_MIN_ROLE[command];
  if (access === undefined) return false;
  if (access === "any") return true;
  return requireRole(members, warehouse, playerId, access);
}