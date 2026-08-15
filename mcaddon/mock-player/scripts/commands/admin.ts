// ─── /mp:admin — 管理员菜单 ────────────────────────────
// 仅管理员（OP 或名单）可打开；非管理员提示无权。

import { CommandPermissionLevel, CustomCommandStatus } from "@minecraft/server";
import type { Player } from "@minecraft/server";
import { color } from "@yinxe/toolkit";

import { isAdmin } from "./auth";
import { showAdminMenu } from "../ui/adminMenu";

export function registerAdminCommand(registry: any): void {
  registry.registerCommand({
    name: "mp:admin",
    description: "打开管理员菜单（默认配额/逐玩家配额/管理员名单）",
    cheatsRequired: false,
    permissionLevel: CommandPermissionLevel.Any,
  }, ({ player }: { player?: Player }) => {
    if (!player) return { status: CustomCommandStatus.Success, message: `${color.error}该命令只能由玩家执行` };
    if (!isAdmin(player)) {
      player.sendMessage(`${color.error}只有管理员可以打开管理员菜单`);
      return { status: CustomCommandStatus.Success, message: "" };
    }
    showAdminMenu(player);
    return { status: CustomCommandStatus.Success, message: "" };
  });
}