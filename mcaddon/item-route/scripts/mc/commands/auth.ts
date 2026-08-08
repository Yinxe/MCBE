// ─── 命令权限封装（纯逻辑，可单测） ──────────────────────────
// 命令 → 所需最小角色的声明式映射（COMMAND_MIN_ROLE），配合 core MemberService
// 实现统一权限矩阵（design §3.3）。**OP（管理员）豁免**：isAdmin=true 直接放行任意角色
//（管理员无需成员身份也能执行 owner/member 级命令），其余玩家走成员矩阵。
// 用法：命令回调里 `requireRole(deps.members, warehouse, player.name, X, canManage(player))`；
// 或直接用 `canRunCommand(...)`（同样支持 isAdmin）。
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberRole } from "../../core/model/Warehouse";
import type { PlayerName } from "../../core/model/types";
import type { MemberService } from "../../core/services/MemberService";

/** 按显示名精确解析仓库；无匹配返回 undefined */
export function resolveWarehouseByName(warehouses: Warehouse[], name: string): Warehouse | undefined {
  return warehouses.find((w) => w.displayName === name);
}

/**
 * 玩家是否满足仓库所需最低角色（owner 隐式满足一切）。
 * `isAdmin`（OP）豁免：管理员无需成员身份，其命令权限对任何仓库成立。
 */
export function requireRole(
  members: MemberService,
  warehouse: Warehouse | undefined,
  playerName: PlayerName,
  role: MemberRole,
  isAdmin = false
): boolean {
  if (isAdmin) return true; // OP 全权限（管理员管理任意仓库）
  if (warehouse === undefined) return false;
  return members.can(warehouse, playerName, role);
}

/**
 * 权限矩阵：命令 → 最低角色；"any" = 任意玩家。
 * create/organize/help 任意；menu member+（无访客角色，成员即可进菜单）；rescan member+；
 * delete/resize owner。
 */
export type CommandAccess = MemberRole | "any";
export const COMMAND_MIN_ROLE: Record<string, CommandAccess> = {
  create: "any",
  resize: "owner",
  rescan: "member",
  rescan_preview: "member",
  delete: "owner",
  menu: "member",
  search: "member", // 容器搜索：仅仓库成员（就近需有权限），v1 语义
  organize: "any",
  help: "any",
};

/**
 * 玩家能否执行某命令（对本仓库）。
 * "any" → 无条件 true；否则 requireRole；`isAdmin`（OP）豁免：管理员任意命令可执行。
 */
export function canRunCommand(
  members: MemberService,
  warehouse: Warehouse | undefined,
  playerName: PlayerName,
  command: string,
  isAdmin = false
): boolean {
  const access = COMMAND_MIN_ROLE[command];
  if (access === undefined) return false;
  if (access === "any") return true;
  if (isAdmin) return true; // OP 全权限
  return requireRole(members, warehouse, playerName, access);
}
