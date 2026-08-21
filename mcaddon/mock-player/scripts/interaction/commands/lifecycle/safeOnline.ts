import { system, CommandPermissionLevel, CustomCommandParamType } from "@minecraft/server";
import { defineCommand } from "@yinxe/toolkit";
import { color } from "@yinxe/toolkit";
import { botRegistry, botStore } from "../../../bootstrap/context";
import { guardBotCommand } from "../auth";
import { safeOnline } from "../../../features/manage/onlineBot";
import { safeOffline } from "../../../features/manage/offlineBot";

export function registerSafeOnlineCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:safeonline",
      description: "安全上线（已合并至 online）：常加载走模拟4排队3秒，普通走2秒",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const targetName = params.name as string;
      if (!targetName) {
        player.sendMessage(`${color.error}请指定假人名字`);
        return;
      }
      const denied = guardBotCommand(player, targetName);
      if (denied) {
        player.sendMessage(`${color.error}${denied}`);
        return;
      }
      const record = botRegistry.get(targetName) ?? botStore.loadRecord(targetName);
      if (!record) {
        player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`);
        return;
      }
      if (record.online) {
        player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经在线`);
        return;
      }
      const isChunkload = (record.spawnMode ?? "normal") === "chunkload";
      player.sendMessage(`${color.muted}正在为 ${color.playerName}${record.name}${color.muted} ${isChunkload ? "申请模拟4并" : ""}安全上线${isChunkload ? "（排队中）" : "（2秒）"}...`);
      system.run(async () => {
        const result = await safeOnline(record);
        if (!result.ok) {
          player.sendMessage(`${color.error}${record.name} 安全上线失败: ${result.reason ?? "unknown"}`);
          return;
        }
        player.sendMessage(`${color.success}假人 ${color.playerName}${record.name}${color.success} 已安全上线${isChunkload ? "（模拟4已卸载，区块由假人继承）" : ""}`);
      });
    },
  );
}

export function registerSafeOfflineCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:safeoffline",
      description: "安全下线：常加载走模拟4排队3秒，普通走2秒",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "name", type: CustomCommandParamType.String }],
    },
    ({ player, params }) => {
      const targetName = params.name as string;
      if (!targetName) {
        player.sendMessage(`${color.error}请指定假人名字`);
        return;
      }
      const denied = guardBotCommand(player, targetName);
      if (denied) {
        player.sendMessage(`${color.error}${denied}`);
        return;
      }
      const record = botRegistry.get(targetName) ?? botStore.loadRecord(targetName);
      if (!record) {
        player.sendMessage(`${color.error}未找到假人 ${color.playerName}${targetName}${color.error} 的记录`);
        return;
      }
      if (!record.online) {
        player.sendMessage(`${color.playerName}假人 ${color.playerName}${targetName}${color.playerName} 已经离线`);
        return;
      }
      const isChunkload = (record.spawnMode ?? "normal") === "chunkload";
      player.sendMessage(`${color.muted}正在为 ${color.playerName}${record.name}${color.muted} ${isChunkload ? "申请模拟4并" : ""}安全下线${isChunkload ? "（排队中）" : "（2秒）"}...`);
      system.run(async () => {
        const result = await safeOffline(record);
        if (!result.ok) {
          player.sendMessage(`${color.error}${record.name} 安全下线失败: ${result.reason ?? "unknown"}`);
          return;
        }
        player.sendMessage(`${color.success}假人 ${color.playerName}${record.name}${color.success} 已安全下线${isChunkload ? "（模拟4已卸载）" : ""}`);
      });
    },
  );
}

export function registerTickingAreaCommand(registry: any): void {
  defineCommand(
    registry,
    {
      name: "mp:tickingarea",
      description: "模拟4常加载区域管理（tickingarea add circle 4 / remove）",
      cheatsRequired: false,
      permissionLevel: CommandPermissionLevel.Any,
      mandatoryParameters: [{ name: "action", type: CustomCommandParamType.String }],
      optionalParameters: [
        { name: "arg1", type: CustomCommandParamType.String },
        { name: "arg2", type: CustomCommandParamType.String },
        { name: "arg3", type: CustomCommandParamType.String },
        { name: "arg4", type: CustomCommandParamType.String },
      ],
    },
    ({ player, params }) => {
      const action = (params.action as string)?.toLowerCase();
      if (!action || (action !== "add" && action !== "remove" && action !== "list")) {
        player.sendMessage(`${color.error}用法: /mp:tickingarea add <x> <y> <z> <name>  或  /mp:tickingarea remove <name>  或  /mp:tickingarea list`);
        return;
      }
      system.run(async () => {
        try {
          const { world } = await import("@minecraft/server");
          if (action === "add") {
            const sx = params.arg1 as string | undefined;
            const sy = params.arg2 as string | undefined;
            const sz = params.arg3 as string | undefined;
            const areaName = params.arg4 as string | undefined;
            if (sx === undefined || sy === undefined || sz === undefined || !areaName) {
              player.sendMessage(`${color.error}用法: /mp:tickingarea add <x> <y> <z> <name>  （将创建模拟4圆形常加载，等价 tickingarea add circle <xyz> 4 <name>）`);
              return;
            }
            const x = Number(sx);
            const y = Number(sy);
            const z = Number(sz);
            if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
              player.sendMessage(`${color.error}坐标必须为数字: ${sx} ${sy} ${sz}`);
              return;
            }
            const { createSim4Area } = await import("../../../features/manage/tickingArea");
            const center = { x, y, z } as any;
            const dim = player.dimension;
            const res = await createSim4Area(center, dim, areaName);
            if (!res.ok) {
              player.sendMessage(`${color.error}创建常加载区域失败: ${res.reason}`);
              return;
            }
            player.sendMessage(`${color.success}已创建模拟4常加载区域 ${color.playerName}${areaName}${color.success} @ ${dim.id} ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} 半径4（等价 tickingarea add circle）`);
          } else if (action === "remove") {
            const areaName = (params.arg1 as string | undefined) ?? (params.arg4 as string | undefined);
            if (!areaName) {
              player.sendMessage(`${color.error}用法: /mp:tickingarea remove <name>  （等价 tickingarea remove <name>）`);
              return;
            }
            const { removeSim4Area } = await import("../../../features/manage/tickingArea");
            const res = removeSim4Area(areaName, player.dimension);
            if (!res.ok) {
              player.sendMessage(`${color.error}移除常加载区域失败: ${res.reason}`);
              return;
            }
            player.sendMessage(`${color.success}已移除常加载区域 ${color.playerName}${areaName}${color.success}（等价 tickingarea remove）`);
          } else if (action === "list") {
            const mgr = world.tickingAreaManager;
            const areas = mgr.getAllTickingAreas();
            if (areas.length === 0) {
              player.sendMessage(`${color.muted}当前无本模组常加载区域（仅显示本包 TickingAreaManager 区域）`);
              return;
            }
            const lines = areas.map((a: any) => `${color.playerName}${a.identifier}${color.muted} @ ${a.dimension.id} ${a.boundingBox.min.x},${a.boundingBox.min.z}~${a.boundingBox.max.x},${a.boundingBox.max.z} ${a.isFullyLoaded ? color.success + "已加载" : color.warn + "加载中"}`);
            player.sendMessage(`${color.success}本模组常加载区域 (${areas.length}):\n` + lines.join("\n"));
          }
        } catch (e: any) {
          player.sendMessage(`${color.error}常加载操作失败: ${e?.message ?? e}`);
        }
      });
    },
  );
}
