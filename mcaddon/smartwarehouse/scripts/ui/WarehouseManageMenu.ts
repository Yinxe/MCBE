import type { Player } from "@minecraft/server";
import { ActionFormBuilder } from "./FormHelper";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { WarehouseService } from "../warehouse/WarehouseService";
import { showWarehouseSettingsMenu } from "./WarehouseSettingsMenu";
import { canManageWarehouse } from "../util/PlayerAuth";
import type { ModConfigStore } from "../storage/ModConfigStore";

export async function showWarehouseManageMenu(
  player: Player,
  repository: WarehouseRepository,
  service: WarehouseService,
  configStore?: ModConfigStore
): Promise<void> {
  const isAdmin = canManageWarehouse(player);
  let warehouses = repository.loadAll();

  if (warehouses.length === 0) {
    const form = new ActionFormBuilder().title("管理仓库").body("当前没有已创建的仓库。").button("返回");
    await form.show(player);
    return;
  }

  // 非 OP 只看自己的仓库；OP 看全部
  if (!isAdmin) {
    warehouses = warehouses.filter((w) => w.ownerId === player.id);
    if (warehouses.length === 0) {
      player.sendMessage("§7你还没有创建任何仓库");
      return;
    }
  }

  // 按名称排序
  warehouses.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const title = isAdmin ? "§e全服仓库列表 §7(管理员)" : "§a我的仓库";
  const form = new ActionFormBuilder().title("管理仓库").body(title);

  for (const warehouse of warehouses) {
    const label =
      isAdmin && warehouse.ownerId !== player.id
        ? `${warehouse.displayName} §7(§f${warehouse.ownerId.slice(-8)}§7)`
        : warehouse.displayName;
    form.button(label, () => showWarehouseSettingsMenu(player, warehouse.id, repository, service, configStore));
  }

  await form.show(player);
}
