// ─── 自定义命令封装 ──────────────────────────────────────────────
// 对 registry.registerCommand() 的轻量封装。
//
// config 参数与原生 CustomCommand 接口完全一致，不做任何包装。
// 唯一改变的是回调：从 (origin, ...args) 改为 ({ origin, player, params })。
//
// 用法：
// ─── 命令注册入口（main.ts） ───
//   system.beforeEvents.startup.subscribe((event) => {
//     const registry = event.customCommandRegistry;
//     defineCommand(registry, {
//       name: "mp:create",
//       description: "创建一个模拟玩家",
//       cheatsRequired: false,
//       permissionLevel: CommandPermissionLevel.Any,
//       optionalParameters: [
//         { name: "name", type: CustomCommandParamType.String },
//       ],
//     }, ({ player, params }) => {
//       // params.name 代替 args[0]
//       // player 已保证存在（自动校验）
//       // system.run 已应用，可以直接调用 MC API
//       player.sendMessage(`创建假人 ${params.name}`);
//     });
//   });
//
// ─── 不依赖玩家的命令 ───
// 如果命令不需要玩家身份（如 /mp:tags 返回静态列表），
// 可以直接用原生 registerCommand，无需经过 defineCommand：
//   registry.registerCommand({ ... }, () => {
//     return { status: CustomCommandStatus.Success, message: "列表" };
//   });

import { system, Player } from "@minecraft/server";
import type {
  CustomCommand,
  CustomCommandOrigin,
  CustomCommandResult,
} from "@minecraft/server";
import { runSafeAsync } from "../ui/runSafe";

export interface CommandContext<T extends Record<string, unknown>> {
  /** 命令原始来源 */
  origin: CustomCommandOrigin;
  /** 执行命令的玩家（已保证非 null） */
  player: Player;
  /** 按参数名解构后的对象 */
  params: T;
}

type CommandHandler<T extends Record<string, unknown>> = (
  ctx: CommandContext<T>
) => void;

/**
 * 注册自定义命令。
 *
 * config 参数与原生 CustomCommand 接口完全相同，不做任何包装。
 * 回调改为接收 { origin, player, params } 对象解构。
 *
 * 自动特性：
 * - 自动校验 origin.sourceEntity 是否为玩家
 * - 回调在 system.run() 中安全执行
 * - args 按 mandatoryParameters + optionalParameters 的 name 解构为 params
 *
 * @param registry - event.customCommandRegistry
 * @param config   - 原生 CustomCommand 配置（与原 registerCommand 完全一致）
 * @param handler  - 回调，接收解构后的 { origin, player, params }
 */
export function defineCommand<T extends Record<string, unknown> = Record<string, unknown>>(
  registry: import("@minecraft/server").CustomCommandRegistry,
  config: CustomCommand,
  handler: CommandHandler<T>
): void {
  const allParams = [
    ...(config.mandatoryParameters ?? []),
    ...(config.optionalParameters ?? []),
  ];

  registry.registerCommand(config, (origin: CustomCommandOrigin, ...args: unknown[]) => {
    const entity = origin.sourceEntity ?? origin.initiator;
    if (!(entity instanceof Player)) {
      return { status: 1, message: "该命令只能由玩家执行" };
    }

    const player = entity;
    const params: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      if (allParams[i]) {
        params[allParams[i].name] = args[i];
      }
    }

    runSafeAsync(() => {
      handler({ origin, player, params: params as T });
    });

    return { status: 0, message: undefined } as CustomCommandResult;
  });
}
