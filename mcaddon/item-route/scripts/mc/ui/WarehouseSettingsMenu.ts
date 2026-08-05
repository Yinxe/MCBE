// ─── 仓库设置：设置表单 + 底部操作（按权限分级显示） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import type { Warehouse } from "../../core/model/Warehouse";
import { showContainerRoleMenu } from "./ContainerRoleMenu";
import { showMemberMenu } from "./MemberMenu";
import { showStatsUI } from "./StatsUI";
import * as uiColor from "./uiColor";

const SPEED_OPTIONS = [4, 8, 16, 20, 30, 40];

export async function showWarehouseSettingsMenu(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const isOwner = requireRole(deps.members, warehouse, player.id, "owner");
  const isMember = requireRole(deps.members, warehouse, player.id, "member");

  // 按钮文字一律深色（ActionForm 浅灰按钮背景，见 uiColor.btn）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}${warehouse.displayName}`)
    .body(`${uiColor.form.body}成员：${warehouse.members.map((m) => m.playerId).join("、") || "无"}\n容器：${warehouse.containers.size}`)
    .button(`${uiColor.btn.primary}仓库设置`, () => void showSettingsForm(player, deps, warehouse))
    .button(`${uiColor.btn.nav}容器角色`, () => void showContainerRoleMenu(player, deps, warehouse));

  if (isMember) {
    form.button(`${uiColor.btn.info}刷新容器`, () => void refreshContainers(player, deps, warehouse));
  }
  if (isOwner) {
    form.button(`${uiColor.btn.nav}成员管理`, () => void showMemberMenu(player, deps, warehouse));
    form.button(`${uiColor.btn.accent}统计`, () => void showStatsUI(player, deps, warehouse));
    form.button(`${uiColor.btn.danger}删除仓库`, () => void confirmDelete(player, deps, warehouse));
  }
  await form.show(player);
}

async function showSettingsForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(warehouse.settings.processingSpeed));
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}仓库设置`)
    .textField("name", "名称", { defaultValue: warehouse.displayName })
    .toggle("sortingEnabled", "自动分拣", { defaultValue: warehouse.settings.sortingEnabled })
    .dropdown(
      "speed",
      "处理速度（tick 间隔）",
      SPEED_OPTIONS.map((s) => `${s} tick`),
      { defaultValueIndex: speedIndex >= 0 ? speedIndex : 2 }
    );

  const values = await form.show(player);
  if (!values) return;
  const name = (values.name as string).trim();
  if (name.length > 0 && name !== warehouse.displayName) {
    deps.warehouses.rename(warehouse, name);
  }
  deps.warehouses.updateSettings(warehouse, {
    sortingEnabled: values.sortingEnabled as boolean,
    processingSpeed: SPEED_OPTIONS[values.speed as number] ?? 8,
  });
  player.sendMessage(`${uiColor.chat.success}仓库设置已保存`);
}

function refreshContainers(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  const before = warehouse.containers.size;
  for (const c of [...warehouse.containers.values()]) {
    if (c.occupiedLocations.length === 0) {
      warehouse.containers.delete(c.id);
      deps.index.onContainerRemoved(c);
    }
  }
  deps.persistContainers(warehouse);
  player.sendMessage(`${uiColor.chat.success}容器刷新完成：${before} → ${warehouse.containers.size}`);
}

async function confirmDelete(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.error}确认删除`)
    .body(`${uiColor.form.body}确定删除仓库 ${warehouse.displayName} 吗？此操作不可恢复。`)
    .button(`${uiColor.btn.danger}确认删除`, () => {
      deps.warehouses.deleteWarehouse(warehouse.id);
      player.sendMessage(`${uiColor.chat.success}仓库 ${warehouse.displayName} 已删除`);
    })
    .button(`${uiColor.btn.info}取消`, () => undefined);
  await form.show(player);
}