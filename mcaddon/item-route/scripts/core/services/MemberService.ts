// ─── 成员权限服务：owner > member ──────────────────────────
// 权限判定的唯一权威来源；命令/UI 一律经 `can()` 判定。
// 模型：仓库只有 owner（创建者）/ member（成员）两类角色，无访客（v2 简化）。
// 非成员（getRole 返回 undefined）不满足任何角色请求。
// 命令→所需角色的映射见 mc/commands/auth.ts 的 COMMAND_MIN_ROLE。
import type { Warehouse } from "../model/Warehouse";
import type { MemberRole } from "../model/Warehouse";
import type { PlayerName } from "../model/types";

/**
 * 成员权限服务（无状态纯逻辑，可单测）：owner > member 的判定唯一权威。
 * 命令/UI 一律经 `can()` 判定；getRole 解析具体角色（owner 优先）。
 */
export class MemberService {
  getRole(warehouse: Warehouse, playerName: PlayerName): MemberRole | undefined {
    if (warehouse.ownerName === playerName) return "owner";
    return warehouse.members.find((m) => m.playerName === playerName)?.role;
  }

  /** 是否满足所需角色（owner 满足一切请求；member 仅满足 member；非成员一律 false） */
  can(warehouse: Warehouse, playerName: PlayerName, required: MemberRole): boolean {
    const role = this.getRole(warehouse, playerName);
    if (role === undefined) return false;
    if (role === "owner") return true;
    return required === "member"; // role === "member"
  }
}