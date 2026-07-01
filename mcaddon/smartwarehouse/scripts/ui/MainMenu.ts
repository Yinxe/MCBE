import type { Player } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";
import { showWarehouseManageMenu } from "./WarehouseManageMenu";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";

/**
 * 显示 SmartWarehouse 系统的主菜单界面。
 * 通过 ActionForm 向玩家提供仓库管理操作入口。
 *
 * @param player     - 要向其显示菜单的玩家
 * @param repository - 仓库数据持久化仓储
 * @param service    - 仓库服务实例
 */
export async function showMainMenu(
  player: Player,
  repository: WarehouseRepository,
  service: WarehouseService
): Promise<void> {
  const form = new ActionFormData()
    .title("SmartWarehouse")
    .body("选择一个操作")
    .button("创建仓库")
    .button("管理仓库");

  const response = await form.show(player);
  if (response.canceled) return;

  if (response.selection === 0) {
    await showWarehouseCreateForm(player);
  } else if (response.selection === 1) {
    await showWarehouseManageMenu(player, repository, service);
  }
}
