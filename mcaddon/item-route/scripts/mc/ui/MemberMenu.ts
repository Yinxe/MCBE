// ─── 成员管理：列表 + 添加/改角色/移除（owner） ────────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import type { Warehouse } from "../../core/model/Warehouse";
import type { MemberRole } from "../../core/model/Warehouse";
import * as uiColor from "./uiColor";

const ROLE_OPTIONS = ["owner", "member", "visitor"];

/** 玩家 ID 短显示（UUID 尾 8 位，v1 口径，聊天友好） */
function shortId(playerId: string): string {
  return playerId.length > 10 ? playerId.slice(-8) : playerId;
}

export async function showMemberMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  // 按钮文字深色（ActionForm 浅灰按钮背景）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}成员管理 · ${warehouse.displayName}`)
    .body(
      `${uiColor.form.muted}成员：\n${warehouse.members.map((m) => `${uiColor.form.body}${shortId(m.playerId)} ${uiColor.form.muted}(${ROLE_OPTIONS[m.role === "owner" ? 0 : m.role === "member" ? 1 : 2]})`).join("\n")}`
    )
    .button(`${uiColor.btn.primary}添加成员`, () => void addMemberForm(player, deps, warehouse))
    .button(`${uiColor.btn.nav}调整角色`, () => void changeRoleForm(player, deps, warehouse))
    .button(`${uiColor.btn.danger}移除成员`, () => void removeMemberForm(player, deps, warehouse));
  await form.show(player);
}

async function addMemberForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}添加成员`)
    .textField("playerId", "玩家 ID", { defaultValue: "" })
    .dropdown("role", "角色", ["member", "visitor"], { defaultValueIndex: 0 });
  const values = await form.show(player);
  if (!values) return;
  const pid = (values.playerId as string).trim();
  if (!pid) return;
  const err = deps.warehouses.addMember(warehouse, pid, (values.role as number) === 0 ? "member" : "visitor");
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}已添加 ${pid}`);
}

async function changeRoleForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const nonOwner = warehouse.members.filter((m) => m.playerId !== warehouse.ownerId);
  if (nonOwner.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}暂无其他成员可调整`);
    return;
  }
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}调整角色`)
    .dropdown("playerId", "成员", nonOwner.map((m) => m.playerId), { defaultValueIndex: 0 })
    .dropdown("role", "新角色", ROLE_OPTIONS, { defaultValueIndex: 1 });
  const values = await form.show(player);
  if (!values) return;
  const pid = nonOwner[values.playerId as number]?.playerId;
  if (!pid) return;
  const role = ROLE_OPTIONS[values.role as number] as MemberRole;
  const err = deps.warehouses.setMemberRole(warehouse, pid, role);
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}${pid} 角色已设为 ${role}`);
}

async function removeMemberForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const nonOwner = warehouse.members.filter((m) => m.playerId !== warehouse.ownerId);
  if (nonOwner.length === 0) {
    player.sendMessage(`${uiColor.chat.muted}暂无其他成员可移除`);
    return;
  }
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}移除成员`)
    .dropdown("playerId", "成员", nonOwner.map((m) => m.playerId), { defaultValueIndex: 0 });
  const values = await form.show(player);
  if (!values) return;
  const pid = nonOwner[values.playerId as number]?.playerId;
  if (!pid) return;
  const err = deps.warehouses.removeMember(warehouse, pid);
  player.sendMessage(err ? `${uiColor.chat.error}${err}` : `${uiColor.chat.success}已移除 ${pid}`);
}