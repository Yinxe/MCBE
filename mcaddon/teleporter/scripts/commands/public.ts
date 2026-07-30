import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { findWaypointByName, togglePublic } from "../teleporter/waypointManager";
import { showPublicWarpsList } from "../ui/publicWarps";

export function registerPublicCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:public",
    description: "切换传送点是否公开",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const name = params.name as string;
    const wp = findWaypointByName(player.id, name);
    if (!wp) {
      player.sendMessage(`§c未找到传送点 §e${name}`);
      return;
    }

    const result = togglePublic(player.id, wp.id);
    if (result === "denied") {
      player.sendMessage("§c公共传送点功能已被管理员关闭");
      return;
    }
    player.sendMessage(
      `§a§e${name} §a已${result ? "设为" : "取消"}公共传送点`,
    );
  });
}

export function registerPublicListCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:publiclist",
    description: "查看所有公共传送点",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    showPublicWarpsList(player);
  });
}
