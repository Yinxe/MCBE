import { CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit/command";
import {
  findWaypointByName,
  createWaypoint,
  deleteWaypoint,
  incrementTeleportCount,
} from "../teleporter/waypointManager";
import { teleportPlayerTo, formatLocation } from "../teleporter/teleportManager";
import { getBiomeName } from "../teleporter/detection";
import { showWarpSelector } from "../ui/warps";

export function registerWarpCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:warp",
    description: "传送到指定传送点（不带名称则打开选择界面）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    optionalParameters: [
      { name: "name", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const name = params.name as string | undefined;
    if (!name) {
      showWarpSelector(player);
      return;
    }
    const wp = findWaypointByName(player.id, name);
    if (!wp) {
      player.sendMessage(`§c未找到传送点 §e${name}§c，使用 §6/tpa:warps §c查看所有传送点`);
      return;
    }
    incrementTeleportCount(player.id, wp.id);
    const ok = teleportPlayerTo(player, wp.location, wp.dimensionId);
    if (ok) {
      player.sendMessage(`§a已传送到 §e${name} §6（${formatLocation(wp.location, wp.dimensionId)}§6）`);
    } else {
      player.sendMessage(`§c传送到 §e${name}§c 失败，目标位置可能未加载`);
    }
  });
}

export function registerSetWarpCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:setwarp",
    description: "设置传送点（当前位置）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
    mandatoryParameters: [
      { name: "name", type: CustomCommandParamType.String },
    ],
  }, ({ player, params }) => {
    const name = params.name as string;
    // 自动检测群系
    let biomeInfo: string | undefined;
    try {
      biomeInfo = getBiomeName(player.dimension, player.location) ?? undefined;
    } catch { /* ignore */ }

    const err = createWaypoint(
      player,
      name,
      "其他",
      biomeInfo ? `位于 ${biomeInfo}` : "",
      player.location,
      player.dimension.id,
      biomeInfo,
    );
    if (err) {
      player.sendMessage(err);
    } else {
      const loc = formatLocation(player.location, player.dimension.id);
      player.sendMessage(`§a已创建传送点 §e${name} §6（${loc}§6）`);
    }
  });
}

export function registerDelWarpCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:delwarp",
    description: "删除指定传送点",
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
    deleteWaypoint(player.id, wp.id);
    player.sendMessage(`§c已删除传送点 §e${name}`);
  });
}

export function registerWarpsCommand(registry: any): void {
  defineCommand(registry, {
    name: "tpa:warps",
    description: "打开传送点选择界面",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }) => {
    showWarpSelector(player);
  });
}
