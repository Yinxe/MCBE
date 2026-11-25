// ─── 探针命令注册 ────────────────────────────────────────────────
//
// 与 DebugCommand.ts 的「绘图命令」分开:这里注册的全是**测量命令**,
// 只读或只画观察用形状,回执以「键 = 值」为主。
//
// 命令一览:
//   /apitest:debugshape  [秒数]     逐形状逐参数探属性(写入 / 读回)
//   /apitest:debugmotion            动态探:改属性会不会真的动
//   /apitest:debuglimits [数量]     规模上限:一次画 N 个看加到第几个失败
//   /apitest:debugcontext           受限上下文:命令回调里直接 addShape 会不会抛错
//   /apitest:debugstats             运行时与插件统计(内存、句柄)
//   /apitest:debugwatchdog <0|1>    开关看门狗卡顿告警
//   /apitest:debugall               能力总览(只跑统计类,不画形状)
//
// 全部沿用既有约定:GameDirectors、cheatsRequired: false、只用整数/浮点参数、
// 经 runSafeDetached 推迟到安全 tick、错误走 §c[API 探针] 提示。
//
// 唯一的例外是 `debugcontext`:它的实验本体**必须**在命令回调(受限上下文)
// 里同步执行,否则测的就不是受限上下文了。因此它只在回调里构造并尝试加入形状,
// 回执仍推迟到安全 tick。

import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  system,
  type CustomCommandOrigin,
} from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { errorText } from "./DebugProbeShared";
import {
  runMotionProbeCommand,
  runLimitsProbeCommand,
  attemptRestrictedAdd,
  reportContextProbe,
} from "./DebugMotionProbe";
import { runShapeProbeCommand } from "./DebugShapeProbe";
import { runStatsProbeCommand, runWatchdogProbeCommand, runAllProbesCommand } from "./DebugStatsProbe";

/** 命令名(必须带命名空间) */
export const DEBUG_SHAPE_COMMAND = "apitest:debugshape";
export const DEBUG_MOTION_COMMAND = "apitest:debugmotion";
export const DEBUG_LIMITS_COMMAND = "apitest:debuglimits";
export const DEBUG_CONTEXT_COMMAND = "apitest:debugcontext";
export const DEBUG_STATS_COMMAND = "apitest:debugstats";
export const DEBUG_WATCHDOG_COMMAND = "apitest:debugwatchdog";
export const DEBUG_ALL_COMMAND = "apitest:debugall";

/** 从命令来源取玩家;控制台/命令方块来源返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const entity = origin.sourceEntity ?? origin.initiator;
  return entity instanceof Player ? entity : undefined;
}

/** 统一处理「只能由玩家执行」 */
function requirePlayer(origin: CustomCommandOrigin): Player | { status: CustomCommandStatus; message: string } {
  const player = playerOf(origin);
  if (!player) {
    return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
  }
  return player;
}

/** 是不是取到了玩家 */
function isPlayer(value: Player | { status: CustomCommandStatus; message: string }): value is Player {
  return value instanceof Player;
}

/**
 * 把一个执行体推迟到安全 tick,并统一兜错。
 *
 * 玩家可能在推迟期间离线,因此执行前重新判一次 `isValid`。
 */
function deferToSafeTick(player: Player, body: () => void): void {
  runSafeDetached(
    () => {
      if (!player.isValid) return;
      body();
    },
    (error) => {
      if (player.isValid) {
        player.sendMessage(`§c[API 探针] 执行失败:${errorText(error)}`);
      }
    }
  );
}

/** 注册全部测量命令 */
export function registerDebugProbeCommands(): void {
  system.beforeEvents.startup.subscribe((event) => {
    // ── /apitest:debugshape [秒数] ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_SHAPE_COMMAND,
        description: "逐个形状逐项参数地探 debug-utilities:写入值、读回值、以及该看到什么",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        optionalParameters: [{ name: "seconds", type: CustomCommandParamType.Float }],
      },
      (origin, seconds?: number) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runShapeProbeCommand(target, seconds));
        return undefined;
      }
    );

    // ── /apitest:debugmotion ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_MOTION_COMMAND,
        description: "动态探针:改 location/bound/scale/color 之后形状会不会真的动",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
      },
      (origin) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runMotionProbeCommand(target));
        return undefined;
      }
    );

    // ── /apitest:debuglimits [数量] ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_LIMITS_COMMAND,
        description: "规模上限:一次画 N 个形状,看加到第几个失败、耗时多少",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        optionalParameters: [{ name: "count", type: CustomCommandParamType.Integer }],
      },
      (origin, count?: number) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runLimitsProbeCommand(target, count));
        return undefined;
      }
    );

    // ── /apitest:debugcontext ──
    // 注意:实验本体在回调里同步执行(回调即受限上下文),回执才推迟。
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_CONTEXT_COMMAND,
        description: "受限上下文探针:在命令回调里直接调 addShape,看是否抛错",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
      },
      (origin) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;

        // 实验本体:此刻就是受限上下文,直接尝试加入形状
        const view = target.getViewDirection();
        const head = target.getHeadLocation();
        const outcome = attemptRestrictedAdd({
          x: head.x + view.x * 4,
          y: head.y + 1,
          z: head.z + view.z * 4,
        });

        deferToSafeTick(target, () => reportContextProbe(target, outcome));
        return undefined;
      }
    );

    // ── /apitest:debugstats ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_STATS_COMMAND,
        description: "报告脚本运行时内存与各插件句柄统计(排查泄漏用)",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
      },
      (origin) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runStatsProbeCommand(target));
        return undefined;
      }
    );

    // ── /apitest:debugwatchdog <0|1> ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_WATCHDOG_COMMAND,
        description: "开关看门狗卡顿告警:1 关闭(压测用),0 恢复",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
        optionalParameters: [{ name: "disable", type: CustomCommandParamType.Integer }],
      },
      (origin, disable?: number) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runWatchdogProbeCommand(target, disable));
        return undefined;
      }
    );

    // ── /apitest:debugall ──
    event.customCommandRegistry.registerCommand(
      {
        name: DEBUG_ALL_COMMAND,
        description: "能力总览:哪些导出可用、本版有哪些形状类",
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: false,
      },
      (origin) => {
        const target = requirePlayer(origin);
        if (!isPlayer(target)) return target;
        deferToSafeTick(target, () => runAllProbesCommand(target));
        return undefined;
      }
    );
  });
}
