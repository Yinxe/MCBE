import { system, CommandPermissionLevel, type CustomCommand } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import type { WarehouseService } from "../warehouse/WarehouseService";
import type { WarehouseRepository } from "../storage/WarehouseRepository";
import type { ModConfigStore } from "../storage/ModConfigStore";
import { showMainMenu } from "../ui/MainMenu";

export function registerMenu(registry: any, service: WarehouseService, repository: WarehouseRepository, configStore: ModConfigStore): void {
  defineCommand(registry, {
    name: "sw:menu", description: "打开 SmartWarehouse 主菜单",
    permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
    mandatoryParameters: [],
  }, ({ player }) => {
    system.runTimeout(() => { showMainMenu(player, repository, service, configStore).catch(() => {}); });
  });
}
