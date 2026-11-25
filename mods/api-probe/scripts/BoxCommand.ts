// ─── 框选命令:/apitest:box <x1> <y1> <z1> <x2> <y2> <z2> [秒数] [尺寸系数] ─
//
// 与探针命令同样的约束:命令回调跑在受限上下文,因此「画粒子 + 发提示」
// 整体推迟到安全 tick。绘制本身只调 spawnParticle,不写世界。
//
// 参数用两个 Location(而不是六个 Integer):
//   · Location 让玩家既能敲坐标,也能「望准方块」直接取点,还能用 ~ 相对坐标;
//   · 三个分量一次收完,命令签名从 8 个参数降到 4 个,少敲一半。
//
// 运行时传给回调的是 `{ x, y, z }` 形状的对象(没有维度信息,也不保证是整数),
// 因此类型上按 `{ x, y, z }` 接收,取整交给 `BoxGeometry.boxFromCorners`
// —— 它在内部用 `Math.floor`,负坐标也正确。
//
// 维度跟随执行者:命令不带维度参数,画在执行者当前所在维度。
//
// 参数是「两个角点」而不是「中心 + 尺寸」:角点是玩家在游戏里唯一能直接读到
// 的量,而中心/尺寸要算一遍才得到。

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
} from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { boxFromCorners } from "./BoxGeometry";
import type { CommandLocation } from "./CommandLocation";
import { drawTimedBox } from "./BoxRenderer";

/** 命令名(必须带命名空间) */
export const BOX_COMMAND = "apitest:box";

/** 默认存活秒数 */
const DEFAULT_SECONDS = 10;

/** 存活秒数上限,防止误输入一个巨大数字把粒子留在世界上一整天 */
const MAX_SECONDS = 120;

/** 尺寸系数下限/上限,防止误输入把框缩成一条线或撑到看不见 */
const MIN_SCALE = 0.05;
const MAX_SCALE = 4;

/** 从命令来源取玩家;控制台/命令方块来源返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/** 把任意抛出物转成一句可读文本 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 命令的实际执行体:算盒子 → 画粒子 → 回执。
 *
 * 已在安全上下文调用。所有失败都转成给玩家的提示,不抛异常。
 */
export function runBoxCommand(
  player: Player,
  cornerA: CommandLocation,
  cornerB: CommandLocation,
  secondsInput?: number,
  scaleInput?: number
): void {
  const seconds = Math.min(Math.max(secondsInput ?? DEFAULT_SECONDS, 1), MAX_SECONDS);
  const sizeScale = Math.min(Math.max(scaleInput ?? 1, MIN_SCALE), MAX_SCALE);
  const shape = boxFromCorners(cornerA, cornerB);

  const result = drawTimedBox(player, player.dimension, shape, {
    durationSeconds: seconds,
    sizeScale,
  });
  if (!result.ok) {
    player.sendMessage(`§c[API 探针] ${result.reason}`);
    return;
  }

  const { min, max, size, volume } = shape;
  player.sendMessage(
    `§a[API 探针] 框选 ${size.x}×${size.y}×${size.z}(${volume} 格),` +
      `角点 ${min.x} ${min.y} ${min.z} → ${max.x} ${max.y} ${max.z},` +
      `§7${seconds} 秒后消失` +
      (sizeScale === 1 ? "" : `,尺寸系数 §e${sizeScale}§7`)
  );
}

/** 注册框选命令(startup 阶段挂到 customCommandRegistry) */
export function registerBoxCommand(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: BOX_COMMAND,
        description: "用粒子在指定两个方块角点之间画出 3D 框选线框(纯视觉,不改世界)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        mandatoryParameters: [
          { name: "corner1", type: CustomCommandParamType.Location },
          { name: "corner2", type: CustomCommandParamType.Location },
        ],
        optionalParameters: [
          { name: "seconds", type: CustomCommandParamType.Float },
          { name: "scale", type: CustomCommandParamType.Float },
        ],
      },
      (origin, corner1: CommandLocation, corner2: CommandLocation, seconds?: number, scale?: number) => {
        const player = playerOf(origin);
        if (!player) {
          return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        }
        // 命令回调是受限上下文:绘制与提示都要推迟到安全 tick。
        // 玩家可能在推迟期间离线,因此回调里重新取一次玩家句柄。
        runSafeDetached(
          () => {
            if (!player.isValid) return;
            runBoxCommand(player, corner1, corner2, seconds, scale);
          },
          (error) => {
            if (player.isValid) {
              player.sendMessage(`§c[API 探针] 执行失败:${errorText(error)}`);
            }
          }
        );
        return undefined;
      }
    );
  });
}
