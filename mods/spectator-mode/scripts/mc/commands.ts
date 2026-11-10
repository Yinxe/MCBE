// ── 自定义命令:/sp:soul 切换旁观 · /sp:soul menu 管理 ──
// 只注册一条命令,`menu` 作为可选参数在回调内判定,保持上游命令面不变。
//
// ⚠ 上下文约束:自定义命令回调运行在受限(只读)上下文,`Player.setGameMode`、
// `Player.teleport`、`Dimension.spawnParticle` 等写操作在其中会抛错(报错文案形如
// "cannot be called in read-only mode")。因此回调内**只做参数解析与鉴权**,
// 一切涉及世界/玩家状态的写操作都经 `@mc-toolchain/mod-common` 的
// `runSafeDetached` 推迟到下一个安全 tick(不在模组内手写 `system.run`)。
// 若在回调里直接调用切换逻辑,玩家会看到「无法进入旁观模式(游戏模式切换被拒绝)」。
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  Player,
  PlayerPermissionLevel,
  type CustomCommandRegistry,
  type CustomCommandOrigin,
  type CustomCommandResult,
} from "@minecraft/server";
import { runSafeDetached } from "@mc-toolchain/mod-common";
import { TOGGLE_COMMAND, type SoulController } from "./controller";
import { openAdminMenu } from "./menu";

/** 从命令来源解析执行玩家;非玩家来源返回 undefined */
function playerOf(origin: CustomCommandOrigin): Player | undefined {
  const source = origin.sourceEntity;
  if (!(source instanceof Player)) return undefined;
  // ⚠️ 假人守卫：模拟玩家也能执行命令，但它们不实现 `getGameMode()`（直接抛错），
  // 进 controller 后任何模式读写都会 TypeError。在入口就排除。
  try {
    if (source.getGameMode() === undefined) return undefined;
  } catch {
    return undefined;
  }
  return source;
}

/**
 * 注册旁观模式命令。
 * @param registry - 自定义命令注册表(`system.beforeEvents.startup` 内)
 * @param controller - 旁观控制器
 */
export function registerAllCommands(registry: CustomCommandRegistry, controller: SoulController): void {
  registry.registerCommand(
    {
      name: TOGGLE_COMMAND,
      description: "灵魂出窍:切换旁观状态;带 menu 参数打开管理表单",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false,
      optionalParameters: [{ name: "action", type: CustomCommandParamType.String }],
    },
    (origin: CustomCommandOrigin, action?: string): CustomCommandResult => {
      const player = playerOf(origin);
      if (player === undefined) {
        return { status: CustomCommandStatus.Failure, message: "该命令只能由玩家执行" };
      }

      const arg = (action ?? "").trim().toLowerCase();

      if (arg === "menu") {
        // 管理入口仅 OP:命令本身人人可执行,表单在此处二次鉴权
        if (player.playerPermissionLevel < PlayerPermissionLevel.Operator) {
          player.sendMessage("§c仅管理员可打开管理表单");
          return { status: CustomCommandStatus.Success };
        }
        // 表单必须在安全上下文打开(命令回调处于受限上下文)
        runSafeDetached(() => openAdminMenu(player, controller));
        return { status: CustomCommandStatus.Success };
      }

      if (arg !== "") {
        player.sendMessage(`§c未知参数 §f${arg}§c,用法:§f/${TOGGLE_COMMAND}§c 或 §f/${TOGGLE_COMMAND} menu`);
        return { status: CustomCommandStatus.Success };
      }

      // 未传参数 → 切换。必须推迟到安全上下文:切换会改游戏模式、写动态属性、生成粒子
      runSafeDetached(() => {
        // 推迟一 tick 后玩家可能已离线,重新校验对象可用性
        if (!player.isValid) return;
        const message = controller.toggle(player);
        if (message !== "") player.sendMessage(message);
      });
      return { status: CustomCommandStatus.Success };
    }
  );
}
