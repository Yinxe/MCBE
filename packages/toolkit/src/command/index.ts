import { system } from "@minecraft/server";
import type {
  Player,
  CustomCommandStatus,
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandParameter,
} from "@minecraft/server";
import { runSafeAsync } from "../ui/runSafe";

export interface CommandConfig {
  name: string;
  description: string;
  cheatsRequired?: boolean;
  permissionLevel?: CommandPermissionLevel;
  mandatoryParameters?: CustomCommandParameter[];
  optionalParameters?: CustomCommandParameter[];
}

export interface CommandContext<T extends Record<string, unknown>> {
  origin: any;
  player: Player;
  params: T;
}

type CommandHandler<T extends Record<string, unknown>> = (
  ctx: CommandContext<T>
) => void;

const INVALID_PLAYER_MSG = "该命令只能由玩家执行";

export function defineCommand<T extends Record<string, unknown> = Record<string, unknown>>(
  registry: any,
  config: CommandConfig,
  handler: CommandHandler<T>
): void {
  const allParams = [
    ...(config.mandatoryParameters ?? []),
    ...(config.optionalParameters ?? []),
  ];

  registry.registerCommand(config, (origin: any, ...args: unknown[]) => {
    if (!origin.sourceEntity || !((origin.sourceEntity as any)?.sendMessage)) {
      return { status: 1, message: INVALID_PLAYER_MSG };
    }

    const player = origin.sourceEntity as Player;
    const params: Record<string, unknown> = {};
    for (let i = 0; i < args.length; i++) {
      if (allParams[i]) {
        params[allParams[i].name] = args[i];
      }
    }

    runSafeAsync(() => {
      handler({ origin, player, params: params as T });
    });

    return { status: 0, message: undefined };
  });
}
