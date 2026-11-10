// ─── 玩家命令注册封装 ──────────────────────────────────────────
// 对 `registry.registerCommand()` 的薄封装:config 与原生 CustomCommand 完全一致,
// 唯一改变的是回调签名 —— 从 `(origin, ...args)` 改为 `({ origin, player, params })`。
//
// 自动完成三件事:
//   1. 校验 `origin.sourceEntity ?? origin.initiator` 是玩家,否则直接返回失败;
//   2. 按 `mandatoryParameters + optionalParameters` 的 name 顺序把 args 解包成 params;
//   3. 把回调推迟到安全上下文执行 —— 命令回调运行在只读上下文,在其中调用
//      `can't be called in read-only mode` 的成员会抛错。
//
// 推迟**只用** mod-common 的 `runSafeDetached`:执行助手已内含 `system.run`,
// 这里不得再包一层(见 mod-common 的规格与 runSafeCore.ts 注释)。
import { CustomCommandStatus, Player } from "@minecraft/server";
import type { CustomCommand, CustomCommandOrigin, CustomCommandRegistry, CustomCommandResult } from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";

/** 回调收到的上下文 */
export interface CommandContext<T extends Record<string, unknown> = Record<string, unknown>> {
  /** 命令原始来源 */
  origin: CustomCommandOrigin;
  /** 执行命令的玩家(已保证是 Player) */
  player: Player;
  /** 按参数名解包后的参数 */
  params: T;
}

type CommandHandler<T extends Record<string, unknown>> = (ctx: CommandContext<T>) => void;

/**
 * 注册一条玩家命令。
 *
 * @param registry - startup 事件提供的自定义命令注册表
 * @param config   - 原生 CustomCommand 配置(与 `registerCommand` 完全一致)
 * @param handler  - 回调,接收 `{ origin, player, params }`
 */
export function registerPlayerCommand<T extends Record<string, unknown> = Record<string, unknown>>(
  registry: CustomCommandRegistry,
  config: CustomCommand,
  handler: CommandHandler<T>
): void {
  const allParameters = [...(config.mandatoryParameters ?? []), ...(config.optionalParameters ?? [])];

  registry.registerCommand(config, (origin: CustomCommandOrigin, ...args: unknown[]): CustomCommandResult => {
    const entity = origin.sourceEntity ?? origin.initiator;
    if (!(entity instanceof Player)) {
      return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
    }

    const params: Record<string, unknown> = {};
    for (let index = 0; index < args.length; index += 1) {
      const parameter = allParameters[index];
      if (parameter !== undefined) {
        params[parameter.name] = args[index];
      }
    }

    runSafeDetached(() => {
      handler({ origin, player: entity, params: params as T });
    });

    return { status: CustomCommandStatus.Success };
  });
}
