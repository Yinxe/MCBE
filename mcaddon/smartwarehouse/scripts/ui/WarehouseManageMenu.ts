import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "./FormHelper";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";

/**
 * 显示仓库管理菜单。
 * 列出所有已注册的仓库，玩家点击后进入对应仓库的设置界面。
 *
 * @param player     - 操作的玩家
 * @param repository - 仓库数据持久化仓储
 * @param service    - 仓库服务实例
 */
export async function showWarehouseManageMenu(
  player: Player,
  repository: WarehouseRepository,
  service: WarehouseService
): Promise<void> {
  const warehouses = repository.loadAll();

  if (warehouses.length === 0) {
    const form = new ActionFormBuilder()
      .title("管理仓库")
      .body("当前没有已创建的仓库。")
      .button("back", "返回");
    const result = await form.show(player);
    if (result?.name === "back") return;
    return;
  }

  const form = new ActionFormBuilder()
    .title("管理仓库")
    .body("选择一个仓库进行设置");

  for (const warehouse of warehouses) {
    form.button(warehouse.id, warehouse.displayName);
  }

  const result = await form.show(player);
  if (!result) return;

  const selectedWarehouse = warehouses.find(w => w.id === result.name);
  if (!selectedWarehouse) return;

  await showWarehouseSettingsMenu(player, selectedWarehouse.id, repository, service);
}
