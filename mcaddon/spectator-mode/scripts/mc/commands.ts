// ── 命令注册：/sp:soul（唯一注册，menu 为子命令） ──
// 用法：
//   /sp:soul         → 切换旁观 / 回归本体
//   /sp:soul menu    → 管理菜单（仅 OP）
// 以可选 String 参数实现"子命令"，运行时若输入其它值则提示用法。
import {
  CommandPermissionLevel,
  CustomCommandParamType,
  type CustomCommandRegistry,
  type Player,
} from "@minecraft/server";
import { canManage, defineCommand } from "@yinxe/toolkit";
import { TOGGLE_COMMAND, type SoulController } from "./controller";
import { openAdminMenu } from "./menu";

/** 注册旁观模式唯一命令（Phase 3 startup 事件内调用） */
export function registerAllCommands(registry: CustomCommandRegistry, controller: SoulController): void {
  try {
    defineCommand(
      registry,
      {
        name: TOGGLE_COMMAND,
        description: "灵魂出窍：切换旁观/回归本体；menu 打开管理菜单",
        cheatsRequired: false,
        permissionLevel: CommandPermissionLevel.Any,
        optionalParameters: [{ name: "action", type: CustomCommandParamType.String }],
      },
      ({ player, params }) => {
        const action = params.action as string | undefined;
        if (action === "menu") {
          openAdminMenuIfOp(player, controller);
          return;
        }
        if (action !== undefined) {
          player.sendMessage(`§e用法：§f/${TOGGLE_COMMAND}§e 切换灵魂出窍 · §f/${TOGGLE_COMMAND} menu§e 管理`);
          return;
        }
        const message = controller.toggle(player);
        if (message) player.sendMessage(message);
      }
    );
  } catch (e) {
    console.warn(`[spectator-mode] 命令注册失败：/${TOGGLE_COMMAND}（${String(e)}）`);
  }
}

/** 打开管理菜单（仅 OP；非管理员只提醒，不拉起表单） */
function openAdminMenuIfOp(player: Player, controller: SoulController): void {
  if (!canManage(player)) {
    player.sendMessage("§c该菜单仅管理员（OP）可操作");
    return;
  }
  void openAdminMenu(player, controller);
}
