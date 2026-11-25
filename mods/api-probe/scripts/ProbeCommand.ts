// ─── 探针命令:/apitest:container <x> <y> <z> ─────────────────────
//
// 一个必填 Location 参数,维度跟随执行者。命令回调本身运行在受限上下文,
// 因此「读取容器 + 打开表单」整体推迟到安全上下文执行。
//
// 用 Location 而不是三个 Integer:玩家既能敲坐标,也能「望准方块」直接取点,
// 还能用 ~ 相对坐标。运行时收到 `{ x, y, z }`(无维度、不保证整数),
// 取整由 toBlockLocation 完成。详见 CommandLocation.ts。
//
// 权限等级取 GameDirectors(操作员/游戏导演),且 cheatsRequired: false
// —— 探针不应该逼开发者为了看一眼容器就开作弊。

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
} from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { readBlockContainer, toBlockLocation } from "./ContainerReader";
import { takeContainerSnapshot } from "./ContainerSnapshot";
import { showContainerOverview } from "./ContainerForm";
import type { CommandLocation } from "./CommandLocation";

/** 命令名(必须带命名空间) */
export const PROBE_COMMAND = "apitest:container";

/** 从命令来源取玩家;控制台/命令方块来源返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/**
 * 命令的实际执行体:读取容器 → 取快照 → 开概览表单。
 *
 * 已在安全上下文调用。所有失败都转成给玩家的提示,不抛异常。
 */
export function runProbe(player: Player, target: CommandLocation): void {
  const location = toBlockLocation(target);
  const dimension = player.dimension;

  const read = readBlockContainer(dimension, location);
  if (!read.ok) {
    player.sendMessage(`§c[API 探针] ${read.reason}`);
    return;
  }

  const snapshot = takeContainerSnapshot(read.container);
  void showContainerOverview(player, dimension, location, read.blockTypeId, snapshot).catch((error: unknown) => {
    player.sendMessage(`§c[API 探针] 打开表单失败:${String(error)}`);
  });
}

/** 注册探针命令(startup 阶段挂到 customCommandRegistry) */
export function registerProbeCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: PROBE_COMMAND,
        description: "读取指定坐标方块的容器,并用表单展示槽位与物品详情(开发期探针)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        mandatoryParameters: [{ name: "target", type: CustomCommandParamType.Location }],
      },
      (origin, location: CommandLocation) => {
        const player = playerOf(origin);
        if (!player) {
          return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        }
        // 命令回调是受限上下文:读取容器与开表单都要推迟到安全 tick。
        // 玩家可能在推迟期间离线,因此回调里重新取一次玩家句柄。
        // 传 onError:否则意外异常只会写入 console.warn,玩家看不到任何反馈。
        runSafeDetached(
          () => {
            if (!player.isValid) return;
            runProbe(player, location);
          },
          (error) => {
            if (player.isValid) {
              player.sendMessage(`§c[API 探针] 执行失败:${String(error)}`);
            }
          }
        );
        return undefined;
      }
    );
  });
}
