import { system, CommandPermissionLevel } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { getLatestDeathPoint } from "../teleporter/deathManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";

export function registerBackCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:back",
    description: "传送到最近的死亡点",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    system.run(() => {
      const deathPoint = getLatestDeathPoint(player.id);
      if (!deathPoint) {
        player.sendMessage("§c没有找到死亡记录");
        return;
      }
      const ok = teleportPlayerTo(player, deathPoint.location, deathPoint.dimensionId);
      if (ok) {
        player.sendMessage(`§a已传送到最近的死亡点 §6（${formatLocation(deathPoint.location, deathPoint.dimensionId)}§6）`);
      } else {
        player.sendMessage("§c传送失败，目标位置可能未加载");
      }
    });
  });
}
