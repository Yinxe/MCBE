// ─── 成员权限服务：owner > member > visitor ────────────────
// 权限判定的唯一权威来源；命令/UI 一律经 `can()` 矩阵（替代 v1 的 OP 二元判断）。
// 矩阵：owner 满足一切；member 满足 member/visitor；visitor 仅 visitor；
// 非成员（getRole 返回 undefined）任何角色都 false。
// 命令→所需角色的映射见 mc/commands/auth.ts 的 COMMAND_MIN_ROLE。
import type { Warehouse } from "../model/Warehouse";
import type { MemberRole } from "../model/Warehouse";
import type { PlayerId } from "../model/types";

export class MemberService {
  getRole(warehouse: Warehouse, playerId: PlayerId): MemberRole | undefined {
    if (warehouse.ownerId === playerId) return "owner";
    return warehouse.members.find((m) => m.playerId === playerId)?.role;
  }

  /** 是否满足所需最低角色（owner 隐式满足 member/visitor） */
  can(warehouse: Warehouse, playerId: PlayerId, required: MemberRole): boolean {
    const role = this.getRole(warehouse, playerId);
    if (role === undefined) return false;
    if (role === "owner") return true;
    if (required === "owner") return false;
    if (role === "member") return true;
    return required === "visitor";
  }
}
