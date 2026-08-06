// ─── 成员管理：列表 + 添加/改角色/移除（owner 专属） ────────
// 权限由 WarehouseService（addMember/setMemberRole/removeMember）校验并落 meta；
// owner 角色不可被改变/移除（服务侧防护，UI 侧同样过滤 owner 之外的成员）。
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberRole } from "../../core/model/Warehouse";
import * as uiColor from "./uiColor";

/** 成员角色中文标签（dropdown 选项 + 列表展示） */
const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "owner",
  member: "member",
  visitor: "visitor",
};
/** 可新增/授予的角色（owner 只能通过转让设置，见 WarehouseService.addMember） */
const ASSIGNABLE_ROLES: MemberRole[] = ["member", "visitor"];

/** 玩家 ID 短显示（UUID 尾 8 位，v1 口径，聊天友好） */
function shortId(playerName: string): string {
  return playerName.length > 10 ? playerName.slice(-8) : playerName;
}

/**
 * 展示成员管理菜单（owner）：成员列表 + 添加/改角色/移除。
 *
 * @param player    - 操作玩家
 * @param deps      - 命令共享依赖门面
 * @param warehouse - 目标仓库
 */
export async function showMemberMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  // 按钮文字深色（ActionForm 浅灰按钮背景）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}成员管理 · ${warehouse.displayName}`)
    .body(
      `${uiColor.form.muted}成员：\n${warehouse.members.map((m) => `${uiColor.form.body}${shortId(m.playerName)} ${uiColor.form.muted}(${ROLE_LABELS[m.role]})`).join("\n")}`
    )
    .button(`${uiColor.btn.primary}添加成员`, () => void addMemberForm(player, deps, warehouse))
    .button(`${uiColor.btn.nav}调整角色`, () => void changeRoleForm(player, deps, warehouse))
    .button(`${uiColor.btn.danger}移除成员`, () => void removeMemberForm(player, deps, warehouse));
  await form.show(player);
}

/** 添加成员表单：输入玩家 ID + 选角色（member/visitor） */
async function addMemberForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}添加成员`)
    .textField("playerName", "玩家 ID", { defaultValue: "" })
    .dropdown("role", "角色", ASSIGNABLE_ROLES, { defaultValueIndex: 0 });
  const values = await form.show(player);
  if (!values) return;
  const pid = (values.playerName as string).trim();
  if (!pid) return;
  const role = ASSIGNABLE_ROLES[values.role as number] ?? "visitor";
  const err = deps.warehouses.addMember(warehouse, pid, role);
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}已添加 ${pid}`);
}

/** 调整角色表单：排除 owner，可选择任意新角色（含 owner→成员/visitor，visitor→member） */
async function changeRoleForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const nonOwner = warehouse.members.filter((m) => m.playerName !== warehouse.ownerName);
  if (nonOwner.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}暂无其他成员可调整`);
    return;
  }
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}调整角色`)
    .dropdown(
      "playerName",
      "成员",
      nonOwner.map((m) => m.playerName),
      { defaultValueIndex: 0 }
    )
    .dropdown("role", "新角色", Object.values(ROLE_LABELS), { defaultValueIndex: 1 });
  const values = await form.show(player);
  if (!values) return;
  const pid = nonOwner[values.playerName as number]?.playerName;
  if (!pid) return;
  const role = (Object.keys(ROLE_LABELS) as MemberRole[])[values.role as number] ?? "visitor";
  const err = deps.warehouses.setMemberRole(warehouse, pid, role);
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}${pid} 角色已设为 ${role}`);
}

/** 移除成员表单：排除 owner（owner 不可被移除，见 WarehouseService.removeMember） */
async function removeMemberForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const nonOwner = warehouse.members.filter((m) => m.playerName !== warehouse.ownerName);
  if (nonOwner.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}暂无其他成员可移除`);
    return;
  }
  const form = new ModalFormBuilder().title(`${uiColor.form.title}移除成员`).dropdown(
    "playerName",
    "成员",
    nonOwner.map((m) => m.playerName),
    { defaultValueIndex: 0 }
  );
  const values = await form.show(player);
  if (!values) return;
  const pid = nonOwner[values.playerName as number]?.playerName;
  if (!pid) return;
  const err = deps.warehouses.removeMember(warehouse, pid);
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}已移除 ${pid}`);
}
