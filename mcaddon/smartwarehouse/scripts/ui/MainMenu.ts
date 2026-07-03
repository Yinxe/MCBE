import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "./FormHelper";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";
import { showWarehouseManageMenu } from "./WarehouseManageMenu";
import { showSearchUI } from "./SearchUI";
import { showConfigUI } from "./ConfigUI";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";

/**
 * 显示 SmartWarehouse 系统的主菜单界面。
 * 通过 ActionForm 向玩家提供仓库管理操作入口。
 *
 * @param player      - 要向其显示菜单的玩家
 * @param repository  - 仓库数据持久化仓储
 * @param service     - 仓库服务实例
 * @param configStore - 模组配置仓储
 */
export async function showMainMenu(
  player: Player,
  repository: WarehouseRepository,
  service: WarehouseService,
  configStore: ModConfigStore
): Promise<void> {
  const isAdmin = canManageWarehouse(player);

  const form = new ActionFormBuilder()
    .title("SmartWarehouse")
    .body("选择一个操作")
    .button("create", "创建仓库")
    .button("manage", "管理仓库")
    .button("search", "容器搜索");

  if (isAdmin) {
    form.button("config", "§e⚙ 配置");
  }

  const result = await form.show(player);
  if (!result) return;

  if (result.name === "create") {
    await showWarehouseCreateForm(player);
  } else if (result.name === "manage") {
    await showWarehouseManageMenu(player, repository, service);
  } else if (result.name === "search") {
    await showSearchUI(player, repository, configStore);
  } else if (result.name === "config") {
    await showConfigUI(player, configStore);
  }
}
