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
//
// 玩家守卫:`origin.sourceEntity` 可能是模拟玩家(假人)或半初始化句柄,推迟到下一
// tick 后也可能已失效。故在**推迟回调内部**重新校验,并用守卫解析出名字传给
// handler——handler 不要再裸读 `player.name`(假人/半初始化实体的该字段可能抛错或为空)。
import { CustomCommandStatus, Player } from "@minecraft/server";
import type { CustomCommand, CustomCommandOrigin, CustomCommandRegistry, CustomCommandResult } from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { playerGuard } from "../util/playerGuard";
import { playerNameOf } from "../util/playerName";

/** 回调收到的上下文 */
export interface CommandContext<T extends Record<string, unknown> = Record<string, unknown>> {
  /** 命令原始来源 */
  origin: CustomCommandOrigin;
  /** 执行命令的玩家(已保证是可用玩家,且非假人) */
  player: Player;
  /** 守卫解析出的玩家名(name → playerName → nameTag 兜底),不要裸读 `player.name` */
  playerName: string;
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
    // 假人也能执行命令，但它们的属性/方法大量不实现（`getGameMode()` 直接抛错），
    // 进 handler 后裸读任何成员都可能 TypeError。在入口就失败并回显，
    // 而不是推迟后静默丢弃（玩家看不到任何反应，更难排查）。
    if (playerGuard.isSimulatedPlayer(entity)) {
      return { status: CustomCommandStatus.Failure, message: "该命令不能由模拟玩家执行" };
    }

    const params: Record<string, unknown> = {};
    for (let index = 0; index < args.length; index += 1) {
      const parameter = allParameters[index];
      if (parameter !== undefined) {
        params[parameter.name] = args[index];
      }
    }

    runSafeDetached(() => {
      // ⚠️ 推迟期间句柄可能已失效(玩家断线/维度切换/实体半初始化),回调内部必须重新校验。
      // 假人在入口已拦下,这里再判一次只是防御(句柄可能在推迟期间被替换)。
      if (!playerGuard.isUsablePlayer(entity)) return;
      if (playerGuard.isSimulatedPlayer(entity)) return;
      const playerName = playerNameOf(entity);
      if (playerName === undefined) return;
      handler({ origin, player: entity, playerName, params: params as T });
    });

    return { status: CustomCommandStatus.Success };
  });
}
