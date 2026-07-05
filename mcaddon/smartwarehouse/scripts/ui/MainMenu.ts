import { type Player } from "@minecraft/server";
import { ActionFormBuilder } from "./FormHelper";
import { showWarehouseCreateForm } from "./WarehouseCreateFlow";
import { showWarehouseManageMenu } from "./WarehouseManageMenu";
import { showSearchUI } from "./SearchUI";
import { showConfigUI } from "./ConfigUI";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { canManageWarehouse } from "../util/PlayerAuth";
import { filterNearbyOwnedWarehouses } from "../util/Vector";
import { WAREHOUSE_NEARBY_MARGIN } from "../types";

/**
 * 显示 SmartWarehouse 系统的主菜单界面。
 *
 * 按钮顺序：
 *   容器搜索 → 打开搜索界面
 *   管理仓库 → 智能定位附近且属于该玩家的仓库，直达设置页
 *   仓库列表 → 列出所有仓库
 *   创建仓库 → 开始创建流程
 *   配置     → 模组配置（仅管理员显示）
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
    .button("容器搜索", () => showSearchUI(player, repository, configStore))
    .button("管理仓库", async () => {
      const warehouses = repository.loadAll();
      const nearbyOwned = filterNearbyOwnedWarehouses(
        warehouses,
        player.dimension.id,
        { x: player.location.x, z: player.location.z },
        WAREHOUSE_NEARBY_MARGIN,
        player.id,
        isAdmin
      );

      if (nearbyOwned.length > 0) {
        await showWarehouseSettingsMenu(player, nearbyOwned[0].id, repository, service, configStore);
      } else {
        player.sendMessage("§7附近没有找到属于你的仓库，显示所有仓库列表");
        await showWarehouseManageMenu(player, repository, service, configStore);
      }
    })
    .button("仓库列表", () => showWarehouseManageMenu(player, repository, service))
    .button("创建仓库", () => showWarehouseCreateForm(player));

  if (isAdmin) {
    form.button("§e⚙ 设置", () => showConfigUI(player, configStore));
  }

  await form.show(player);
}
