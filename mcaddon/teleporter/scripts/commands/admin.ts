import { CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import { isAdmin } from "../teleporter/adminManager";
import { showAdminConfig } from "../ui/admin";
import { loadConfig } from "../teleporter/config";

export function registerAdminCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:admin",
    description: "传送模组管理配置（需要 OP 或 tag=op）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    if (!isAdmin(player)) {
      player.sendMessage("§c你没有权限执行此命令");
      return;
    }
    showAdminConfig(player);
  });
}

export function registerConfigCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:config",
    description: "查看当前模组配置",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    if (!isAdmin(player)) {
      player.sendMessage("§c你没有权限执行此命令");
      return;
    }
    const config = loadConfig();
    player.sendMessage("§b===== 传送模组配置 =====");
    player.sendMessage(`§6单人最大传送点: §f${config.maxWaypointsPerPlayer}`);
    player.sendMessage(`§6公共传送点: ${config.publicWaypointEnabled ? "§a启用" : "§c禁用"}`);
  });
}
