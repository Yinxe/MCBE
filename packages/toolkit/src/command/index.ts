// ─── 自定义命令封装 ──────────────────────────────────────────────
// 对 registry.registerCommand() 的轻量封装。
//
// 解决的问题：
//   1. args 按索引取值（args[0], args[1]）易出错 —— 转为对象解构
//   2. 每个命令都要写 !origin.sourceEntity 校验 —— 自动处理
//   3. 回调中调用 MC API 需要 system.run() 包裹 —— 自动处理
//
// 用法：
//   defineCommand(registry, {
//     name: "mp:create",
//     description: "创建一个模拟玩家",
//     cheatsRequired: false,
//     permissionLevel: CommandPermissionLevel.Any,
//     optionalParameters: [
//       { name: "name", type: CustomCommandParamType.String },
//     ],
//   }, ({ origin, player, params }) => {
//     // params.name 代替 args[0]
//     // player 已保证存在（自动校验）
//     // system.run 已应用，可以直接调用 MC API
//     player.sendMessage(`创建假人 ${params.name}`);
//   });

import { system } from "@minecraft/server";
import type {
  CommandOrigin,
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandParameter,
} from "@minecraft/server";
import { runSafeAsync } from "../ui/runSafe";

// ─── 类型 ───────────────────────────────────────────────────────

export interface CommandConfig {
  name: string;
  description: string;
  cheatsRequired?: boolean;
  permissionLevel?: CommandPermissionLevel;
  mandatoryParameters?: CustomCommandParameter[];
  optionalParameters?: CustomCommandParameter[];
}

export interface CommandContext<T extends Record<string, unknown>> {
  /** 命令原始来源 */
  origin: CommandOrigin;
  /** 执行命令的玩家（已保证非 null） */
  player: Player;
  /** 解析后的命名参数对象 */
  params: T;
}

type CommandHandler<T extends Record<string, unknown>> = (
  ctx: CommandContext<T>
) => { status: CustomCommandStatus; message: string } | void;

// ─── 注册函数 ───────────────────────────────────────────────────

const INVALID_PLAYER_MSG = "该命令只能由玩家执行";

/**
 * 注册自定义命令。
 *
 * @param registry - event.customCommandRegistry
 * @param config   - 命令配置（与原 registerCommand 的第一个参数相同）
 * @param handler  - 命令回调，接收 { origin, player, params }
 *
 * handler 特性：
 * - player 已自动校验，保证存在
 * - 回调在 system.run() 内执行，可安全调用 MC API
 * - positional args 已按参数名解构为 params 对象
 * - handler 的返回值会立即返回（synchronous status），
 *   如需延迟返回结果，用 player.sendMessage 替代
 */
export function defineCommand<T extends Record<string, unknown> = Record<string, unknown>>(
  registry: any,
  config: CommandConfig,
  handler: CommandHandler<T>
): void {
  const allParams = [
    ...(config.mandatoryParameters ?? []),
    ...(config.optionalParameters ?? []),
  ];

  registry.registerCommand(config, (origin: CommandOrigin, ...args: unknown[]) => {
    // 自动校验玩家
    if (!origin.sourceEntity || !((origin.sourceEntity as any)?.sendMessage)) {
      return { status: 1 /* CustomCommandStatus.Failure */, message: INVALID_PLAYER_MSG };
    }

    const player = origin.sourceEntity as Player;

    // 将 positional args 按参数名解构为对象
    const params: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      if (allParams[i]) {
        params[allParams[i].name] = args[i];
      }
    }

    // 在 system.run 中安全执行回调
    runSafeAsync(() => {
      handler({ origin, player, params: params as T });
    });

    // 同步返回：告知命令已被接受
    return { status: 0 /* CustomCommandStatus.Success */, message: undefined };
  });
}
