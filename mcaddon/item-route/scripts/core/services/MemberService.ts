// ─── 成员权限服务：owner > member > visitor ────────────────
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