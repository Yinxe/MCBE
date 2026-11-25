// ─── 调试线框命令 ────────────────────────────────────────────────
//
// 三条命令,覆盖 `@minecraft/debug-utilities` 的可视化能力:
//   /apitest:debugbox   两角点框选,画出盒体 + 三色轴 + 尺寸文字
//   /apitest:debugshow  在玩家面前把该模块支持的全部形状各画一份
//   /apitest:debugclear 清掉本模组画出的全部形状
//
// 与 /apitest:box(粒子版)并存:两条命令画同一个盒子,用来横向对比两种渲染路径。
//
// 坐标参数用两个 Location(与 /apitest:box 一致):玩家既能敲坐标,也能「望准方块」
// 直接取点,还能用 ~ 相对坐标。运行时收到的是 `{ x, y, z }`(无维度、不保证整数),
// 取整由 BoxGeometry.boxFromCorners 内部完成。详见 CommandLocation.ts。

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
  type Vector3,
} from "@minecraft/server";
import {
  DebugArrow,
  DebugBox,
  DebugCircle,
  DebugLine,
  DebugSphere,
  DebugText,
  type DebugShape,
} from "@minecraft/debug-utilities";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { toNativeColor } from "./DebugColor";
import type { CommandLocation } from "./CommandLocation";
import { boxFromCorners, exceedsMaxEdge, MAX_BOX_EDGE } from "./BoxGeometry";
import { clearAllShapes, clearPlayerShapes, drawDebugBox, addShapes } from "./DebugRenderer";
import { DEFAULT_DURATION_SECONDS, MAX_DURATION_SECONDS, MAX_SIZE_SCALE, MIN_SIZE_SCALE } from "./DebugShapeBuilder";
import type { ColorComponents } from "./DebugColor";

/** 命令名(必须带命名空间) */
export const DEBUG_BOX_COMMAND = "apitest:debugbox";
export const DEBUG_SHOW_COMMAND = "apitest:debugshow";
export const DEBUG_CLEAR_COMMAND = "apitest:debugclear";

/** 从命令来源取玩家;控制台/命令方块来源返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/** 把任意抛出物转成一句可读文本 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 把秒数夹到合法区间 */
function clampSeconds(input?: number): number {
  return Math.min(Math.max(input ?? DEFAULT_DURATION_SECONDS, 1), MAX_DURATION_SECONDS);
}

/**
 * 命令的实际执行体:算盒子 → 画调试线框 → 回执。
 *
 * 已在安全上下文调用。所有失败都转成给玩家的提示,不抛异常。
 */
export function runDebugBoxCommand(
  player: Player,
  cornerA: CommandLocation,
  cornerB: CommandLocation,
  secondsInput?: number,
  scaleInput?: number
): void {
  const seconds = clampSeconds(secondsInput);
  const sizeScale = Math.min(Math.max(scaleInput ?? 1, MIN_SIZE_SCALE), MAX_SIZE_SCALE);
  const shape = boxFromCorners(cornerA, cornerB);

  if (exceedsMaxEdge(shape)) {
    player.sendMessage(
      `§c[API 探针] 框选单边超过 ${MAX_BOX_EDGE} 格(${shape.size.x}×${shape.size.y}×${shape.size.z}),拒绝绘制`
    );
    return;
  }

  const result = drawDebugBox(player.id, shape, { durationSeconds: seconds, sizeScale });
  if (!result.ok) {
    player.sendMessage(`§c[API 探针] ${result.reason}`);
    return;
  }

  const { min, max, size, volume } = shape;
  player.sendMessage(
    `§a[API 探针] 调试线框 ${size.x}×${size.y}×${size.z}(${volume} 格),` +
      `角点 ${min.x} ${min.y} ${min.z} → ${max.x} ${max.y} ${max.z},` +
      `§7${result.shapeCount} 个形状,${seconds} 秒后消失` +
      (sizeScale === 1 ? "" : `,尺寸系数 §e${sizeScale}§7`)
  );
}

/** 展示清单里的一项 */
interface ShowcaseEntry {
  /** 形状类名,同时用作回执里的短名 */
  name: string;
  /** 以 origin 为参照构造形状 */
  build: (origin: Vector3) => DebugShape;
  /** 颜色,缺省为白 */
  color: ColorComponents;
}

/**
 * 形状清单:全部以玩家前方的 base 点为参照向右排开,互不重叠。
 *
 * 这份清单同时是「该模块在当前版本提供哪些形状」的实证:类型定义里有的形状
 * 这里都出现一次,少一个就说明版本不匹配。
 *
 * `DebugSphere` / `DebugCircle` 没有半径属性,只能用 `scale`;
 * `DebugBox` 没有以角点构造的形式,只能给中心 + `bound`。
 */
const SHOWCASE: readonly ShowcaseEntry[] = [
  {
    name: "DebugLine",
    color: { red: 1, green: 1, blue: 1 },
    build: (o) => new DebugLine({ x: o.x, y: o.y, z: o.z }, { x: o.x + 2, y: o.y + 1, z: o.z }),
  },
  {
    name: "DebugArrow",
    color: { red: 1, green: 0.6, blue: 0.1 },
    build: (o) => {
      const arrow = new DebugArrow({ x: o.x, y: o.y, z: o.z }, { x: o.x + 2, y: o.y + 1, z: o.z });
      arrow.headLength = 0.4;
      arrow.headRadius = 0.2;
      arrow.headSegments = 8;
      return arrow;
    },
  },
  {
    name: "DebugBox",
    color: { red: 0.3, green: 0.9, blue: 1 },
    build: (o) => {
      const box = new DebugBox(o);
      box.bound = { x: 1, y: 1, z: 1 };
      return box;
    },
  },
  {
    name: "DebugSphere",
    color: { red: 0.9, green: 0.4, blue: 1 },
    build: (o) => {
      const sphere = new DebugSphere(o);
      sphere.scale = 1;
      return sphere;
    },
  },
  {
    name: "DebugCircle",
    color: { red: 1, green: 1, blue: 0.3 },
    build: (o) => {
      const circle = new DebugCircle(o);
      circle.scale = 1;
      return circle;
    },
  },
  {
    name: "DebugText",
    color: { red: 1, green: 1, blue: 1 },
    build: (o) => new DebugText({ x: o.x, y: o.y + 0.6, z: o.z }, "DebugText"),
  },
];

/** 相邻两个展示形状之间的水平间距(格) */
const SHOWCASE_SPACING = 2.5;

/** 展示形状离玩家眼睛的水平距离(格) */
const SHOWCASE_DISTANCE = 3;

/**
 * 命令的实际执行体:在玩家面前把全部形状各画一份。
 *
 * 已在安全上下文调用。每个形状独立成败,单个失败不影响其余。
 */
export function runDebugShowCommand(player: Player, secondsInput?: number): void {
  const seconds = clampSeconds(secondsInput);
  clearPlayerShapes(player.id);

  const view = player.getViewDirection();
  const head = player.getHeadLocation();
  const base: Vector3 = {
    x: head.x + view.x * SHOWCASE_DISTANCE,
    y: head.y + 1,
    z: head.z + view.z * SHOWCASE_DISTANCE,
  };
  // 右手方向 = 视线在水平面上顺时针转 90°(y 分量丢弃,避免向上排开)
  const right: Vector3 = { x: -view.z, y: 0, z: view.x };

  // 先构造全部形状:构造失败的直接记进 failed,不进入待加入列表
  const pending: { shape: DebugShape; name: string }[] = [];
  const failed: string[] = [];
  SHOWCASE.forEach((entry, index) => {
    const origin: Vector3 = {
      x: base.x + right.x * index * SHOWCASE_SPACING,
      y: base.y,
      z: base.z + right.z * index * SHOWCASE_SPACING,
    };
    try {
      const shape = entry.build(origin);
      shape.color = toNativeColor({ ...entry.color });
      shape.timeLeft = seconds;
      pending.push({ shape, name: entry.name });
    } catch (error) {
      failed.push(`${entry.name}(${errorText(error)})`);
    }
  });

  // 再逐个加入:经 addShapes 登记,保证 /apitest:debugclear 能清掉它们
  const { drawn, failed: addFailed } = addShapes(player.id, pending, seconds);
  failed.push(...addFailed);

  if (drawn.length === 0) {
    player.sendMessage(`§c[API 探针] 没有任何形状绘制成功:${failed.join("、")}`);
    return;
  }

  player.sendMessage(
    `§a[API 探针] 已绘制 §e${drawn.length}§a 个调试形状:${drawn.join("、")},` +
      `§7${seconds} 秒后消失` +
      (failed.length > 0 ? `;§c失败 ${failed.join("、")}` : "")
  );
}

/** 命令的实际执行体:清掉本模组画的全部形状 */
export function runDebugClearCommand(player: Player): void {
  clearAllShapes();
  player.sendMessage("§a[API 探针] 已清除本模组绘制的全部调试形状");
}

/** 注册调试线框命令(startup 阶段挂到 customCommandRegistry) */
export function registerDebugCommands(): void {
  system.beforeEvents.startup.subscribe((event) => {
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_BOX_COMMAND,
        description: "用 debug-utilities 的线框在指定两个方块角点之间画 3D 框(纯客户端渲染,不改世界)",
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
        // 玩家可能在推迟期间离线,因此回调里重新判一次有效性。
        runSafeDetached(
          () => {
            if (!player.isValid) return;
            runDebugBoxCommand(player, corner1, corner2, seconds, scale);
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

    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_SHOW_COMMAND,
        description: "在玩家面前绘制 debug-utilities 支持的全部形状各一份(开发期探针)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        optionalParameters: [{ name: "seconds", type: CustomCommandParamType.Float }],
      },
      (origin, seconds?: number) => {
        const player = playerOf(origin);
        if (!player) {
          return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        }
        runSafeDetached(
          () => {
            if (!player.isValid) return;
            runDebugShowCommand(player, seconds);
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

    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_CLEAR_COMMAND,
        description: "清除本模组用 debug-utilities 绘制的全部线框形状",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
      },
      (origin) => {
        const player = playerOf(origin);
        if (!player) {
          return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
        }
        runSafeDetached(
          () => {
            if (!player.isValid) return;
            runDebugClearCommand(player);
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
