// ─── 仓库设置：设置表单 + 底部操作（按权限分级显示） ─────────
import { type Player } from "@minecraft/server";
import { ActionFormBuilder, ModalFormBuilder } from "@yinxe/toolkit";
import type { CommandDeps } from "../commands/deps";
import { requireRole } from "../commands/auth";
import { unregisterContainer } from "../../core/model/ContainerRegistry";
import type { Warehouse } from "../../core/model/Warehouse";
import { showContainerRoleMenu } from "./ContainerRoleMenu";
import { showMemberMenu } from "./MemberMenu";
import { showStatsUI } from "./StatsUI";
import * as uiColor from "./uiColor";

/** 处理速度可选项（tick 间隔）；默认 index 2 = 8 tick */
const SPEED_OPTIONS = [4, 8, 16, 20, 30, 40];

/**
 * 仓库设置主菜单：总览 + 设置表单 + 按权限分级操作（member：刷新容器；owner：成员/统计/删除）。
 * 先 ensureContainersLoaded（仓库可能未激活，容器数/后续操作需要）。
 *
 * @param player    - 操作玩家
 * @param deps      - 命令共享依赖门面
 * @param warehouse - 目标仓库
 */
export async function showWarehouseSettingsMenu(
  player: Player,
  deps: CommandDeps,
  warehouse: Warehouse
): Promise<void> {
  deps.ensureContainersLoaded(warehouse); // 仓库可能未激活 → 容器按需加载（显示容器数与后续操作）
  const isOwner = requireRole(deps.members, warehouse, player.name, "owner");
  const isMember = requireRole(deps.members, warehouse, player.name, "member");

  // 按钮文字一律深色（ActionForm 浅灰按钮背景，见 uiColor.btn）
  const form = new ActionFormBuilder()
    .title(`${uiColor.form.title}${warehouse.displayName}`)
    .body(
      `${uiColor.form.body}成员：${warehouse.members.map((m) => m.playerName).join("、") || "无"}\n容器：${warehouse.containers.size}`
    )
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

/** 设置表单：改名 / 仓库运转 / 自动整理 / 处理速度；保存即写 meta + 已激活仓立即重建 interval */
async function showSettingsForm(player: Player, deps: CommandDeps, warehouse: Warehouse): Promise<void> {
  const speedIndex = Math.max(0, SPEED_OPTIONS.indexOf(warehouse.settings.processingSpeed));
  const form = new ModalFormBuilder()
    .title(`${uiColor.form.title}仓库设置`)
    .textField("name", "名称", { defaultValue: warehouse.displayName })
    .toggle("routingEnabled", "仓库运转", { defaultValue: warehouse.settings.routingEnabled })
    .toggle("sortingEnabled", "自动整理", { defaultValue: warehouse.settings.sortingEnabled })
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
  const newSpeed = SPEED_OPTIONS[values.speed as number] ?? 8;
  deps.warehouses.updateSettings(warehouse, {
    routingEnabled: values.routingEnabled as boolean,
    sortingEnabled: values.sortingEnabled as boolean,
    processingSpeed: newSpeed,
  });
  deps.route.setProcessingSpeed(warehouse.id, newSpeed); // 已激活仓库立即按新速度重建 interval
  player.sendMessage(`${uiColor.chat.success}仓库设置已保存`);
}

/** 刷新容器：剔除几何为空的登记项（方块被拆/区位空置），清其键并同步索引 */
function refreshContainers(player: Player, deps: CommandDeps, warehouse: Warehouse): void {
  const before = warehouse.containers.size;
  const removed: string[] = [];
  for (const c of [...warehouse.containers.values()]) {
    if (c.occupiedLocations.length === 0) {
      unregisterContainer(warehouse, c.id);
      deps.resolveIndex(warehouse.id)?.onContainerRemoved(c);
      deps.stats.discard(c.id); // 容器移除 → 清其统计键（每容器一条）
      removed.push(c.id);
    }
  }
  // 最小单位：只清被移除容器的键 + 一次索引同步（其余容器键不动）
  for (const cid of removed) deps.removeContainer(warehouse, cid);
  deps.persistContainerIds(warehouse);
  player.sendMessage(`${uiColor.chat.success}容器刷新完成：${before} → ${warehouse.containers.size}`);
}

/** 删除确认：二次确认 → deleteWarehouse（副作用由 warehouseDeleted 事件订阅者清理） */
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
